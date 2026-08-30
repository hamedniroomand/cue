import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRepoFromRemote, resolveConfig } from '@/config';

import { makeFakeExec } from './helpers/fakeExec';

async function tmpRepo(config?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cue-cfg-'));
  if (config !== undefined) {
    await mkdir(`${dir}/.cue`, { recursive: true });
    await Bun.write(`${dir}/.cue/config.json`, JSON.stringify(config));
  }
  return dir;
}

function originExec(url: string) {
  return makeFakeExec([
    { match: ['git', '-C', '*', 'remote', 'get-url', 'origin'], result: { stdout: `${url}\n` } },
  ]).exec;
}

describe('parseRepoFromRemote', () => {
  test('parses ssh, https, and no-suffix remote URLs', () => {
    expect(parseRepoFromRemote('git@github.com:acme/widgets.git')).toBe('acme/widgets');
    expect(parseRepoFromRemote('https://github.com/acme/widgets.git')).toBe('acme/widgets');
    expect(parseRepoFromRemote('https://github.com/acme/widgets')).toBe('acme/widgets');
    expect(parseRepoFromRemote('not a url')).toBeNull();
  });
});

describe('resolveConfig', () => {
  test('no config file at all: full defaults + auto-detected repo + cwd as repoPath', async () => {
    const cwd = await tmpRepo();
    const cfg = await resolveConfig(originExec('git@github.com:acme/widgets.git'), cwd);
    expect(cfg.repo).toBe('acme/widgets');
    expect(cfg.repoPath).toBe(cwd);
    expect(cfg.adapter).toBe('codex');
    expect(cfg.models).toEqual({
      triage: 'gpt-5.3-codex',
      dev: 'gpt-5.3-codex',
      review: 'gpt-5.3-codex',
    });
    expect(cfg.maxTurns).toEqual({ triage: 15, dev: 60, review: 25 });
    expect(cfg.gate).toEqual({ test: 'bun test' });
    expect(cfg.reviewFixIterations).toBe(2);
    expect(cfg.baseBranch).toBe('main');
    expect(cfg.worktreeRoot).toBe(join(homedir(), '.cue', 'worktrees', 'acme-widgets'));
    expect(cfg.devBashAllowlist).toBeUndefined(); // default: Bash unrestricted
  });

  test('accepts an optional worktree setup command', async () => {
    const cwd = await tmpRepo({ repo: 'acme/widgets', setup: 'bun install' });
    const cfg = await resolveConfig(makeFakeExec([]).exec, cwd);
    expect(cfg.setup).toBe('bun install');
  });

  test('the $schema key editors use is ignored by the parser, not rejected', async () => {
    const cwd = await tmpRepo({
      $schema: 'https://hamedniroomand.github.io/cue/schema/config.json',
      adapter: 'claude',
    });
    const cfg = await resolveConfig(originExec('git@github.com:acme/widgets.git'), cwd);
    expect(cfg.adapter).toBe('claude');
    expect('$schema' in cfg).toBe(false);
  });

  test('config file fields override defaults, explicit repo skips detection', async () => {
    const cwd = await tmpRepo({
      repo: 'acme/other',
      adapter: 'claude',
      models: { triage: 'haiku', dev: 'opus', review: 'sonnet' },
      gate: { test: 'npm test', lint: 'npx eslint .' },
      baseBranch: 'develop',
    });
    const { exec, calls } = makeFakeExec([]); // detection must not run
    const cfg = await resolveConfig(exec, cwd);
    expect(cfg.repo).toBe('acme/other');
    expect(cfg.models.dev).toBe('opus');
    expect(cfg.gate.lint).toBe('npx eslint .');
    expect(cfg.baseBranch).toBe('develop');
    expect(calls).toHaveLength(0);
  });

  test('selects Codex models when Codex is the configured adapter', async () => {
    const cwd = await tmpRepo({ repo: 'acme/other', adapter: 'codex' });
    const { exec } = makeFakeExec([]);
    const cfg = await resolveConfig(exec, cwd);
    expect(cfg.models).toEqual({
      triage: 'gpt-5.3-codex',
      dev: 'gpt-5.3-codex',
      review: 'gpt-5.3-codex',
    });
  });

  test('selects Antigravity models when Antigravity is the configured adapter', async () => {
    const cwd = await tmpRepo({ repo: 'acme/other', adapter: 'antigravity' });
    const { exec } = makeFakeExec([]);
    const cfg = await resolveConfig(exec, cwd);
    expect(cfg.adapter).toBe('antigravity');
    expect(cfg.models).toEqual({
      triage: 'gemini-3.7-flash-medium',
      dev: 'gemini-3.7-flash-high',
      review: 'gemini-3.7-flash-high',
    });
  });

  test('normalizes the agy alias to antigravity so downstream code sees one name', async () => {
    const cwd = await tmpRepo({ repo: 'acme/other', adapter: 'agy' });
    const { exec } = makeFakeExec([]);
    const cfg = await resolveConfig(exec, cwd);
    expect(cfg.adapter).toBe('antigravity');
    expect(cfg.models).toEqual({
      triage: 'gemini-3.7-flash-medium',
      dev: 'gemini-3.7-flash-high',
      review: 'gemini-3.7-flash-high',
    });
  });

  test('rejects explicit models without an explicit adapter (the default changed)', async () => {
    const cwd = await tmpRepo({
      repo: 'acme/other',
      models: { triage: 'haiku', dev: 'sonnet', review: 'sonnet' },
    });
    const { exec } = makeFakeExec([]);
    await expect(resolveConfig(exec, cwd)).rejects.toThrow('set "adapter" explicitly');
  });

  test('keeps the Claude defaults when Claude is configured explicitly', async () => {
    const cwd = await tmpRepo({ repo: 'acme/other', adapter: 'claude' });
    const { exec } = makeFakeExec([]);
    const cfg = await resolveConfig(exec, cwd);
    expect(cfg.models).toEqual({ triage: 'haiku', dev: 'sonnet', review: 'sonnet' });
  });

  test('throws a clear error when repo cannot be determined', async () => {
    const cwd = await tmpRepo();
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', '*', 'remote', 'get-url', 'origin'],
        result: { code: 2, stderr: 'error: No such remote' },
      },
    ]);
    await expect(resolveConfig(exec, cwd)).rejects.toThrow('cannot determine repo');
  });

  test('rejects an invalid repo value in the config file', async () => {
    const cwd = await tmpRepo({ repo: 'not-a-repo' });
    const { exec } = makeFakeExec([]);
    await expect(resolveConfig(exec, cwd)).rejects.toThrow();
  });
});
