import { describe, expect, test } from 'bun:test';

import { AntigravityAdapter } from '@/adapters/antigravity';
import { AdapterError } from '@/adapters/base';
import type { AgentRunOptions } from '@/adapters/types';
import { POSIX, WINDOWS } from '@/platform';

import { makeEnvSpy } from './helpers/envSpy';
import { makeFakeExec } from './helpers/fakeExec';

const STREAM =
  [
    JSON.stringify({
      event: 'init',
      conversation_id: 'conv-123',
      init: { cwd: '/tmp/work', model: 'gemini-3.7-flash-high', tools: ['view_file'] },
    }),
    JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'conv-123',
        step_index: 1,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'grep_search',
        tool_info: {
          name: 'grep_search',
          parameters: { Query: 'ClaudeAdapter', SearchPath: 'src' },
        },
      },
    }),
    JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: 'conv-123',
        step_index: 2,
        state: 'ACTIVE',
        step_type: 'agent_response',
        text_delta: 'Here is the plan for Antigravity.',
      },
    }),
    JSON.stringify({
      event: 'result',
      result: {
        conversation_id: 'conv-123',
        status: 'SUCCESS',
        response: 'Here is the plan for Antigravity.',
        duration_seconds: 3.5,
        num_turns: 4,
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          total_tokens: 1200,
          cost_usd: 0.015,
        },
      },
    }),
  ].join('\n') + '\n';

const OPTS: AgentRunOptions = {
  prompt: 'implement the feature',
  cwd: '/tmp/work',
  model: 'gemini-3.7-flash-high',
  maxTurns: 15,
  access: 'read-only',
  timeoutMs: 60_000,
};

describe('AntigravityAdapter', () => {
  test('builds the streaming headless command and parses the result event', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: STREAM } }]);
    const res = await new AntigravityAdapter(exec).run(OPTS);
    expect(res.text).toBe('Here is the plan for Antigravity.');
    expect(res.costUsd).toBe(0.015);
    expect(res.turns).toBe(4);
    expect(Array.isArray(res.raw)).toBe(true);

    const cmd = calls[0]!;
    expect(cmd).toEqual(
      expect.arrayContaining([
        'agy',
        '-p',
        'implement the feature',
        '--output-format',
        'stream-json',
        '--mode',
        'plan',
        '--dangerously-skip-permissions',
        '--model',
        'gemini-3.7-flash-high',
        '--print-timeout',
        '60s',
      ]),
    );
  });

  test('surfaces that agy cannot guarantee web search instead of silently dropping it', async () => {
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: STREAM } }]);
    const progress: string[] = [];
    await new AntigravityAdapter(exec).run({
      ...OPTS,
      webSearch: true,
      onProgress: (m) => progress.push(m),
    });
    expect(progress.some((m) => m.includes('web search'))).toBe(true);
  });

  test('uses accept-edits mode when the stage has write access', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: STREAM } }]);
    await new AntigravityAdapter(exec).run({ ...OPTS, access: 'write' });
    expect(calls[0]).toEqual(expect.arrayContaining(['--mode', 'accept-edits']));
  });

  test('picks the LAST result event, not an earlier result-shaped one', async () => {
    // A mid-stream event carrying a result-shaped payload must not shadow the
    // terminal result of an append-only stream.
    const noisy =
      [
        JSON.stringify({ event: 'step_update', result: { status: 'PARTIAL' } }),
        JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'Final answer.' },
        }),
      ].join('\n') + '\n';
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: noisy } }]);
    const res = await new AntigravityAdapter(exec).run(OPTS);
    expect(res.text).toBe('Final answer.');
  });

  test('reports live progress for tool uses and text snippets', async () => {
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: STREAM } }]);
    const progress: string[] = [];
    await new AntigravityAdapter(exec).run({ ...OPTS, onProgress: (m) => progress.push(m) });
    expect(progress.some((m) => m.includes('session started (gemini-3.7-flash-high)'))).toBe(true);
    expect(progress.some((m) => m.includes('grep_search') && m.includes('ClaudeAdapter'))).toBe(
      true,
    );
    expect(progress.some((m) => m.includes('Here is the plan'))).toBe(true);
  });

  test('throws when the stream contains no result event', async () => {
    const { exec } = makeFakeExec([
      { match: ['agy', '-p'], result: { stdout: '{"event":"init","init":{}}\n' } },
    ]);
    await expect(new AntigravityAdapter(exec).run(OPTS)).rejects.toThrow('no result event');
  });

  test('throws when result event status is ERROR', async () => {
    const errStream =
      JSON.stringify({
        event: 'result',
        result: {
          status: 'ERROR',
          error: 'model quota exceeded',
        },
      }) + '\n';
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: errStream } }]);
    await expect(new AntigravityAdapter(exec).run(OPTS)).rejects.toThrow('model quota exceeded');
  });

  test('an extraction failure carries the parsed transcript on the error', async () => {
    const stream =
      JSON.stringify({ event: 'step_update', step_update: { text_delta: 'working…' } }) +
      '\n' +
      JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'bad tool call' } }) +
      '\n';
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: stream } }]);
    const err = await new AntigravityAdapter(exec).run(OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).events).toHaveLength(2);
  });

  test('throws when a top-level result event reports an error', async () => {
    const errStream =
      JSON.stringify({ event: 'result', status: 'ERROR', error: 'rate limited' }) + '\n';
    const { exec } = makeFakeExec([{ match: ['agy', '-p'], result: { stdout: errStream } }]);
    await expect(new AntigravityAdapter(exec).run(OPTS)).rejects.toThrow('rate limited');
  });

  test('throws with stderr excerpt on non-zero exit', async () => {
    const { exec } = makeFakeExec([
      { match: ['agy', '-p'], result: { code: 1, stderr: 'unauthenticated' } },
    ]);
    await expect(new AntigravityAdapter(exec).run(OPTS)).rejects.toThrow('unauthenticated');
  });

  test('scrubs the environment: own keys kept, other providers and GH_TOKEN dropped', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.HOME = process.env.HOME ?? '/tmp';
    process.env.GEMINI_API_KEY = 'gemini-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    const { exec, env } = makeEnvSpy(STREAM);
    await new AntigravityAdapter(exec, POSIX).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().HOME).toBeDefined();
    expect(env().GEMINI_API_KEY).toBe('gemini-key');
    expect(env().ANTHROPIC_API_KEY).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  test('scrubs the environment down to the windows allowlist', async () => {
    process.env.GH_TOKEN = 'secret-token';
    process.env.USERPROFILE = 'C:\\Users\\dev';
    process.env.SYSTEMROOT = 'C:\\Windows';
    process.env.ANTIGRAVITY_API_KEY = 'agy-key';
    const { exec, env } = makeEnvSpy(STREAM);
    await new AntigravityAdapter(exec, WINDOWS).run(OPTS);
    expect(env().GH_TOKEN).toBeUndefined();
    expect(env().USERPROFILE).toBe('C:\\Users\\dev');
    expect(env().SYSTEMROOT).toBe('C:\\Windows');
    expect(env().ANTIGRAVITY_API_KEY).toBe('agy-key');
    // posix-only vars must not leak through the windows personality
    expect(env().HOME).toBeUndefined();
    expect(env().SHELL).toBeUndefined();
    delete process.env.GH_TOKEN;
    delete process.env.USERPROFILE;
    delete process.env.SYSTEMROOT;
    delete process.env.ANTIGRAVITY_API_KEY;
  });
});
