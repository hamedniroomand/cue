/**
 * The two OS personalities Cue runs under. Darwin and Linux are identical for
 * everything Cue cares about, so the axis is POSIX vs Windows — not one
 * variant per OS. Selected once at startup (cli.ts) and injected through
 * StageContext, so tests can exercise either personality on any host.
 */
export interface Platform {
  name: 'posix' | 'windows';
  /** Wrap a user-authored gate command for the OS shell (gates.ts). */
  shell(command: string): string[];
  /** OS vars the scrubbed agent subprocess env may carry (see scrubbedEnv).
   *  Credentials never live here: each adapter names its own provider keys,
   *  so a codex run never sees ANTHROPIC_API_KEY and vice versa. GH_TOKEN
   *  above all is dropped. */
  agentEnvAllowlist: string[];
}

export const POSIX: Platform = {
  name: 'posix',
  shell: (command) => ['sh', '-c', command],
  agentEnvAllowlist: ['PATH', 'HOME', 'SHELL', 'TERM', 'USER', 'TMPDIR'],
};

export const WINDOWS: Platform = {
  name: 'windows',
  // /d skips AutoRun registry commands, /s preserves quoting, /c runs and exits.
  shell: (command) => ['cmd', '/d', '/s', '/c', command],
  // Windows processes need system vars (SYSTEMROOT, COMSPEC, PATHEXT) to load
  // DLLs and resolve executables, and profile vars (USERPROFILE, APPDATA,
  // LOCALAPPDATA, TEMP/TMP) to find their own config and credentials.
  agentEnvAllowlist: [
    'PATH',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'SYSTEMROOT',
    'COMSPEC',
    'PATHEXT',
    'USERNAME',
  ],
};

/**
 * The credential boundary for every agent subprocess: platform OS vars plus
 * the adapter's own provider keys, nothing else. Empty values are dropped.
 */
export function scrubbedEnv(
  platform: Platform,
  adapterEnvKeys: string[],
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [...platform.agentEnvAllowlist, ...adapterEnvKeys]) {
    const value = source[key];
    if (value) env[key] = value;
  }
  return env;
}

export function currentPlatform(): Platform {
  return process.platform === 'win32' ? WINDOWS : POSIX;
}
