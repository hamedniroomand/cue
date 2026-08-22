import { describe, expect, test } from 'bun:test';

import { ClaudeAdapter } from '@/adapters/claude';
import type { AgentRunOptions } from '@/adapters/types';
import { POSIX, WINDOWS } from '@/platform';

import { makeEnvSpy } from './helpers/envSpy';
import { makeFakeExec } from './helpers/fakeExec';

const STREAM =
  [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet' }),
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me look at the server file first.' },
          { type: 'tool_use', name: 'Bash', input: { command: 'bun add hono' } },
        ],
      },
    }),
    JSON.stringify({
      type: 'result',
      result: 'Here is the plan.',
      total_cost_usd: 0.042,
      num_turns: 6,
    }),
  ].join('\n') + '\n';

const OPTS: AgentRunOptions = {
  prompt: 'do the thing',
  cwd: '/tmp/work',
  model: 'sonnet',
  maxTurns: 15,
  access: 'read-only',
  timeoutMs: 60_000,
};

function toolsOf(cmd: string[]): string[] {
  const i = cmd.indexOf('--allowedTools');
  return i === -1 ? [] : cmd[i + 1]!.split(',');
}

describe('ClaudeAdapter', () => {
  test('builds the streaming headless command and parses the result event', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    const res = await new ClaudeAdapter(exec).run(OPTS);
    expect(res.text).toBe('Here is the plan.');
    expect(res.costUsd).toBe(0.042);
    expect(res.turns).toBe(6);
    expect(Array.isArray(res.raw)).toBe(true);
    const cmd = calls[0]!;
    expect(cmd).toEqual(
      expect.arrayContaining([
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        'sonnet',
        '--max-turns',
        '15',
        '--allowedTools',
        'Read,Grep,Glob',
      ]),
    );
  });

  test('read-only access grants inspection tools only', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    await new ClaudeAdapter(exec).run(OPTS);
    expect(toolsOf(calls[0]!)).toEqual(['Read', 'Grep', 'Glob']);
  });

  test('webSearch adds the WebSearch tool', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    await new ClaudeAdapter(exec).run({ ...OPTS, webSearch: true });
    expect(toolsOf(calls[0]!)).toEqual(['Read', 'Grep', 'Glob', 'WebSearch']);
  });

  test('write access grants edit tools and unrestricted Bash by default', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    await new ClaudeAdapter(exec).run({ ...OPTS, access: 'write' });
    expect(toolsOf(calls[0]!)).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']);
  });

  test('write access scopes Bash to the allowlist when one is set', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    await new ClaudeAdapter(exec).run({
      ...OPTS,
      access: 'write',
      bashAllowlist: ['bun *', 'git status'],
    });
    expect(toolsOf(calls[0]!)).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Write',
      'Edit',
      'Bash(bun *)',
      'Bash(git status)',
    ]);
  });

  test('reports live progress for tool uses and text snippets', async () => {
    const { exec } = makeFakeExec([{ match: ['claude', '-p'], result: { stdout: STREAM } }]);
    const progress: string[] = [];
    await new ClaudeAdapter(exec).run({ ...OPTS, onProgress: (m) => progress.push(m) });
    expect(progress.some((m) => m.includes('Bash') && m.includes('bun add hono'))).toBe(true);
    expect(progress.some((m) => m.includes('Let me look at the server file'))).toBe(true);
  });

  test('throws when the stream contains no result event', async () => {
    const { exec } = makeFakeExec([
      { match: ['claude', '-p'], result: { stdout: '{"type":"system","subtype":"init"}\n' } },
    ]);
    await expect(new ClaudeAdapter(exec).run(OPTS)).rejects.toThrow('no result event');
  });

  test('throws with stderr excerpt on non-zero exit', async () => {
    const { exec } = makeFakeExec([
      { match: ['claude', '-p'], result: { code: 1, stderr: 'invalid api key' } },
    ]);
    await expect(new ClaudeAdapter(exec).run(OPTS)).rejects.toThrow('invalid api key');
  });

  test('falls back to a stdout excerpt when a killed process leaves stderr empty', async () => {
    const { exec } = makeFakeExec([
      { match: ['claude', '-p'], result: { code: 143, stdout: 'last output before kill' } },
    ]);
    await expect(new ClaudeAdapter(exec).run(OPTS)).rejects.toThrow('last output before kill');
  });

  test('scrubs the environment: own key kept, other providers and GH_TOKEN dropped', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.HOME = process.env.HOME ?? '/tmp';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    process.env.OPENAI_API_KEY = 'openai-key';
    const { exec, env } = makeEnvSpy(STREAM);
    await new ClaudeAdapter(exec, POSIX).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().HOME).toBeDefined();
    expect(env().ANTHROPIC_API_KEY).toBe('anthropic-key');
    expect(env().OPENAI_API_KEY).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  test('scrubs the environment down to the windows allowlist', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.USERPROFILE = 'C:\\Users\\dev';
    process.env.SYSTEMROOT = 'C:\\Windows';
    const { exec, env } = makeEnvSpy(STREAM);
    await new ClaudeAdapter(exec, WINDOWS).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().USERPROFILE).toBe('C:\\Users\\dev');
    expect(env().SYSTEMROOT).toBe('C:\\Windows');
    // posix-only vars must not leak through the windows personality
    expect(env().HOME).toBeUndefined();
    expect(env().SHELL).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.USERPROFILE;
    delete process.env.SYSTEMROOT;
  });
});
