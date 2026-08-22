import { describe, expect, test } from 'bun:test';

import { currentPlatform, POSIX, scrubbedEnv, WINDOWS } from '@/platform';

describe('platform', () => {
  test('POSIX wraps gate commands in sh -c', () => {
    expect(POSIX.shell('bun test && bun run lint')).toEqual([
      'sh',
      '-c',
      'bun test && bun run lint',
    ]);
  });

  test('WINDOWS wraps gate commands in cmd /d /s /c', () => {
    expect(WINDOWS.shell('bun test && bun run lint')).toEqual([
      'cmd',
      '/d',
      '/s',
      '/c',
      'bun test && bun run lint',
    ]);
  });

  test('POSIX agent env allowlist keeps identity vars only — no provider credentials', () => {
    expect(POSIX.agentEnvAllowlist).toEqual(['PATH', 'HOME', 'SHELL', 'TERM', 'USER', 'TMPDIR']);
  });

  test('WINDOWS agent env allowlist carries the vars windows processes need to boot', () => {
    for (const key of [
      'PATH',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'SYSTEMROOT',
      'COMSPEC',
      'PATHEXT',
    ]) {
      expect(WINDOWS.agentEnvAllowlist).toContain(key);
    }
  });

  test('no allowlist ever includes the GitHub token or any provider API key', () => {
    for (const p of [POSIX, WINDOWS]) {
      expect(p.agentEnvAllowlist).not.toContain('GH_TOKEN');
      expect(p.agentEnvAllowlist).not.toContain('GITHUB_TOKEN');
      for (const key of p.agentEnvAllowlist) expect(key).not.toMatch(/API_KEY/);
    }
  });

  describe('scrubbedEnv', () => {
    const source = {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      GH_TOKEN: 'secret',
      ANTHROPIC_API_KEY: 'anthropic-key',
      OPENAI_API_KEY: 'openai-key',
      EMPTY: '',
    };

    test('keeps platform vars plus the adapter keys, drops everything else', () => {
      const env = scrubbedEnv(POSIX, ['OPENAI_API_KEY'], source);
      expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/dev', OPENAI_API_KEY: 'openai-key' });
    });

    test('never leaks another provider credential: adapter keys are the only extras', () => {
      const env = scrubbedEnv(POSIX, ['ANTHROPIC_API_KEY'], source);
      expect(env.ANTHROPIC_API_KEY).toBe('anthropic-key');
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.GH_TOKEN).toBeUndefined();
    });

    test('skips unset and empty values', () => {
      const env = scrubbedEnv(POSIX, ['EMPTY', 'MISSING'], source);
      expect('EMPTY' in env).toBe(false);
      expect('MISSING' in env).toBe(false);
    });
  });

  test('currentPlatform selects by process.platform', () => {
    expect(currentPlatform()).toBe(process.platform === 'win32' ? WINDOWS : POSIX);
  });
});
