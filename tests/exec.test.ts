import { describe, expect, test } from 'bun:test';

import { realExec } from '@/exec';

import { makeFakeExec } from './helpers/fakeExec';

describe('realExec', () => {
  test('captures stdout and exit code', async () => {
    const r = await realExec(['bun', '-e', "console.log('hello')"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('hello');
  });

  test('streams stdout lines to onLine while still returning full output', async () => {
    const lines: string[] = [];
    const r = await realExec(['bun', '-e', "console.log('one'); console.log('two')"], {
      onLine: (l) => lines.push(l),
    });
    expect(lines).toEqual(['one', 'two']);
    expect(r.stdout).toBe('one\ntwo\n');
  });

  test('reports non-zero exit without throwing', async () => {
    const r = await realExec(['bun', '-e', "console.error('boom'); process.exit(3)"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain('boom');
  });
});

describe('makeFakeExec', () => {
  test('returns scripted results and records calls', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['gh', 'issue', 'list'], result: { stdout: '[]' } },
    ]);
    const r = await exec(['gh', 'issue', 'list', '--repo', 'a/b']);
    expect(r.stdout).toBe('[]');
    expect(calls[0]).toEqual(['gh', 'issue', 'list', '--repo', 'a/b']);
  });

  test('replays scripted stdout through onLine to simulate streaming', async () => {
    const { exec } = makeFakeExec([{ match: ['claude'], result: { stdout: 'l1\nl2\n' } }]);
    const lines: string[] = [];
    await exec(['claude'], { onLine: (l) => lines.push(l) });
    expect(lines).toEqual(['l1', 'l2']);
  });

  test('throws on an unexpected command', async () => {
    const { exec } = makeFakeExec([]);
    await expect(exec(['rm', '-rf', '/'])).rejects.toThrow('unexpected exec');
  });
});
