import { describe, expect, test } from 'bun:test';

import { CodexAdapter } from '@/adapters/codex';
import type { AgentRunOptions } from '@/adapters/types';
import { POSIX, WINDOWS } from '@/platform';

import { makeEnvSpy } from './helpers/envSpy';
import { makeFakeExec } from './helpers/fakeExec';

// Codex emits item.started AND item.completed for the same item; progress
// must not report it twice.
const STREAM =
  [
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
    JSON.stringify({
      type: 'item.started',
      item: { type: 'command_execution', command: 'bun test' },
    }),
    JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'bun test', exit_code: 0 },
    }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'The plan.' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 25 } }),
  ].join('\n') + '\n';

const OPTS: AgentRunOptions = {
  prompt: 'do the thing',
  cwd: '/tmp/work',
  model: 'gpt-5.3-codex',
  maxTurns: 15,
  access: 'read-only',
  timeoutMs: 60_000,
};

describe('CodexAdapter', () => {
  test('builds a JSONL, read-only Codex command and parses its final message', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['codex', 'exec'], result: { stdout: STREAM } },
    ]);
    const res = await new CodexAdapter(exec).run(OPTS);
    expect(res.text).toBe('The plan.');
    expect(Array.isArray(res.raw)).toBe(true);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['--json', '--sandbox', 'read-only', '--model', 'gpt-5.3-codex']),
    );
    expect(calls[0]).not.toContain('--search');
  });

  test('counts turns from turn.completed events', async () => {
    const { exec } = makeFakeExec([{ match: ['codex', 'exec'], result: { stdout: STREAM } }]);
    const res = await new CodexAdapter(exec).run(OPTS);
    expect(res.turns).toBe(1);
    // Codex JSONL reports token usage but no dollar cost — leave it unknown
    // rather than inventing one.
    expect(res.costUsd).toBeUndefined();
  });

  test('uses a writable sandbox when the stage has write access', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['codex', 'exec'], result: { stdout: STREAM } },
    ]);
    await new CodexAdapter(exec).run({ ...OPTS, access: 'write' });
    expect(calls[0]).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write']));
  });

  test('enables web search with the global --search flag, before the exec subcommand', async () => {
    // codex rejects `codex exec --search`; the flag must precede `exec`.
    const { exec, calls } = makeFakeExec([
      { match: ['codex', '--search', 'exec'], result: { stdout: STREAM } },
    ]);
    await new CodexAdapter(exec).run({ ...OPTS, webSearch: true });
    const cmd = calls[0]!;
    expect(cmd.indexOf('--search')).toBeGreaterThan(-1);
    expect(cmd.indexOf('--search')).toBeLessThan(cmd.indexOf('exec'));
  });

  test('reports each command and agent message exactly once', async () => {
    const { exec } = makeFakeExec([{ match: ['codex', 'exec'], result: { stdout: STREAM } }]);
    const progress: string[] = [];
    await new CodexAdapter(exec).run({ ...OPTS, onProgress: (m) => progress.push(m) });
    expect(progress.filter((m) => m.includes('bun test'))).toHaveLength(1);
    expect(progress.filter((m) => m.includes('The plan.'))).toHaveLength(1);
  });

  test('throws when Codex emits no final agent message', async () => {
    const { exec } = makeFakeExec([
      { match: ['codex', 'exec'], result: { stdout: '{"type":"turn.completed"}\n' } },
    ]);
    await expect(new CodexAdapter(exec).run(OPTS)).rejects.toThrow('no final agent message');
  });

  test('falls back to a stdout excerpt when a killed process leaves stderr empty', async () => {
    const { exec } = makeFakeExec([
      { match: ['codex', 'exec'], result: { code: 143, stdout: 'was running bun test' } },
    ]);
    await expect(new CodexAdapter(exec).run(OPTS)).rejects.toThrow('was running bun test');
  });

  test('scrubs the environment: own keys kept, other providers and GH_TOKEN dropped', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.HOME = process.env.HOME ?? '/tmp';
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    const { exec, env } = makeEnvSpy(STREAM);
    await new CodexAdapter(exec, POSIX).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().HOME).toBeDefined();
    expect(env().OPENAI_API_KEY).toBe('openai-key');
    expect(env().ANTHROPIC_API_KEY).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('scrubs the environment down to the windows allowlist', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.USERPROFILE = 'C:\\Users\\dev';
    const { exec, env } = makeEnvSpy(STREAM);
    await new CodexAdapter(exec, WINDOWS).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().USERPROFILE).toBe('C:\\Users\\dev');
    expect(env().HOME).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.USERPROFILE;
  });
});
