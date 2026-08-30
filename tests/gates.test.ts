import { describe, expect, test } from 'bun:test';

import { runGate, runSetup } from '@/gates';
import { POSIX, WINDOWS } from '@/platform';

import { makeFakeExec } from './helpers/fakeExec';

describe('runGate', () => {
  test('passes when all commands exit zero', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['sh', '-c', 'bun test'] },
      { match: ['sh', '-c', 'bunx eslint .'] },
    ]);
    const r = await runGate(
      exec,
      '/wt/issue-7',
      { test: 'bun test', lint: 'bunx eslint .' },
      POSIX,
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test('fails fast and captures the failing command output', async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ['sh', '-c', 'bun test'],
        result: { code: 1, stdout: '1 fail', stderr: 'assertion error' },
      },
    ]);
    const r = await runGate(
      exec,
      '/wt/issue-7',
      { test: 'bun test', lint: 'bunx eslint .' },
      POSIX,
    );
    expect(r.ok).toBe(false);
    expect(r.output).toContain('$ bun test');
    expect(r.output).toContain('assertion error');
    expect(calls).toHaveLength(1);
  });

  test('skips lint when not configured', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['sh', '-c', 'bun test'] }]);
    const r = await runGate(exec, '/wt', { test: 'bun test' }, POSIX);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('runs gate commands through cmd on windows', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['cmd', '/d', '/s', '/c', 'bun test'] },
      { match: ['cmd', '/d', '/s', '/c', 'bunx eslint .'] },
    ]);
    const r = await runGate(
      exec,
      'C:\\wt\\issue-7',
      { test: 'bun test', lint: 'bunx eslint .' },
      WINDOWS,
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('runSetup', () => {
  test('runs the setup command through the OS shell', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['sh', '-c', 'bun install'] }]);
    await runSetup(exec, '/wt/issue-7', 'bun install', POSIX);
    expect(calls).toHaveLength(1);
  });

  test('throws with the command output when setup fails', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['sh', '-c', 'bun install'],
        result: { code: 1, stderr: 'registry unreachable' },
      },
    ]);
    await expect(runSetup(exec, '/wt/issue-7', 'bun install', POSIX)).rejects.toThrow(
      'registry unreachable',
    );
  });
});
