import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONFIG_SCHEMA_URL } from '@/config';
import { readRawConfig, scaffold } from '@/scaffold';

async function tmpRepo(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'cue-scaffold-'));
}

const readConfig = async (cwd: string) => await Bun.file(join(cwd, '.cue', 'config.json')).json();

describe('scaffold', () => {
  test('fresh repo: writes a config with $schema, the prompts dir, and the gitignore entry', async () => {
    const cwd = await tmpRepo();
    const done = await scaffold(cwd);

    expect(await readConfig(cwd)).toEqual({
      $schema: CONFIG_SCHEMA_URL,
      gate: { test: 'bun test' },
    });
    expect(existsSync(join(cwd, '.cue', 'prompts'))).toBe(true);
    expect(await Bun.file(join(cwd, '.gitignore')).text()).toContain('.cue/runs/\n');
    expect(done.join('\n')).toContain('.cue/config.json');
  });

  test('$schema is the first key so editors pick it up without scrolling', async () => {
    const cwd = await tmpRepo();
    await scaffold(cwd);
    const text = await Bun.file(join(cwd, '.cue', 'config.json')).text();
    expect(Object.keys(JSON.parse(text))[0]).toBe('$schema');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('existing config without $schema: adds it and keeps every other field', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    await Bun.write(
      join(cwd, '.cue', 'config.json'),
      JSON.stringify({ adapter: 'claude', gate: { test: 'npm test' } }),
    );

    const done = await scaffold(cwd);

    expect(await readConfig(cwd)).toEqual({
      $schema: CONFIG_SCHEMA_URL,
      adapter: 'claude',
      gate: { test: 'npm test' },
    });
    expect(done.join('\n')).toContain('$schema');
  });

  test('existing config with $schema is left byte-for-byte alone', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    const original = `{"$schema":"${CONFIG_SCHEMA_URL}","adapter":"codex"}`;
    await Bun.write(join(cwd, '.cue', 'config.json'), original);

    const done = await scaffold(cwd);

    expect(await Bun.file(join(cwd, '.cue', 'config.json')).text()).toBe(original);
    expect(done.join('\n')).not.toContain('config.json');
  });

  test('unparseable config is reported, never overwritten', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    await Bun.write(join(cwd, '.cue', 'config.json'), '{ not json');

    await expect(scaffold(cwd)).rejects.toThrow(/config\.json/);
    expect(await Bun.file(join(cwd, '.cue', 'config.json')).text()).toBe('{ not json');
  });

  test('idempotent: a second run adds no duplicate gitignore entry', async () => {
    const cwd = await tmpRepo();
    await Bun.write(join(cwd, '.gitignore'), 'node_modules\n');
    await scaffold(cwd);
    await scaffold(cwd);
    const text = await Bun.file(join(cwd, '.gitignore')).text();
    expect(text.match(/\.cue\/runs\//g)).toHaveLength(1);
    expect(text).toContain('node_modules\n');
  });

  test('given answers on a fresh repo, writes them with $schema first', async () => {
    const cwd = await tmpRepo();
    await scaffold(cwd, { adapter: 'claude', gate: { test: 'npm test' } });
    const text = await Bun.file(join(cwd, '.cue', 'config.json')).text();
    expect(Object.keys(JSON.parse(text))[0]).toBe('$schema');
    expect(JSON.parse(text)).toEqual({
      $schema: CONFIG_SCHEMA_URL,
      adapter: 'claude',
      gate: { test: 'npm test' },
    });
  });

  test('answers identical to disk are not rewritten — accepting defaults is a no-op', async () => {
    const cwd = await tmpRepo();
    await scaffold(cwd, { adapter: 'codex', gate: { test: 'bun test' } });
    const before = await Bun.file(join(cwd, '.cue', 'config.json')).text();

    const done = await scaffold(cwd, { adapter: 'codex', gate: { test: 'bun test' } });

    expect(await Bun.file(join(cwd, '.cue', 'config.json')).text()).toBe(before);
    expect(done.join('\n')).not.toContain('config.json');
  });

  test('changed answers replace the file and say so', async () => {
    const cwd = await tmpRepo();
    await scaffold(cwd, { adapter: 'codex', gate: { test: 'bun test' } });
    const done = await scaffold(cwd, { adapter: 'claude', gate: { test: 'bun test' } });
    expect((await readConfig(cwd)).adapter).toBe('claude');
    expect(done.join('\n')).toContain('.cue/config.json');
  });

  test('a stale $schema url is refreshed to the current one', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    await Bun.write(
      join(cwd, '.cue', 'config.json'),
      JSON.stringify({ $schema: 'https://old.example/schema.json', adapter: 'codex' }),
    );
    await scaffold(cwd, { $schema: 'https://old.example/schema.json', adapter: 'codex' });
    expect((await readConfig(cwd)).$schema).toBe(CONFIG_SCHEMA_URL);
  });
});

describe('readRawConfig', () => {
  test('returns an empty object when there is no config yet', async () => {
    expect(await readRawConfig(await tmpRepo())).toEqual({});
  });

  test('returns the file as-is, unvalidated — the wizard pre-fills from it', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    await Bun.write(join(cwd, '.cue', 'config.json'), JSON.stringify({ adapter: 'agy', odd: 1 }));
    expect(await readRawConfig(cwd)).toEqual({ adapter: 'agy', odd: 1 });
  });

  test('an unparseable config is an error, not a silent empty object', async () => {
    const cwd = await tmpRepo();
    await mkdir(join(cwd, '.cue'), { recursive: true });
    await Bun.write(join(cwd, '.cue', 'config.json'), '{ not json');
    await expect(readRawConfig(cwd)).rejects.toThrow(/config\.json/);
  });
});
