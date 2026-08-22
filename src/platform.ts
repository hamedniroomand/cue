/**
 * The two OS personalities Cue runs under. Darwin and Linux are identical for
 * everything Cue cares about, so the axis is POSIX vs Windows — not one
 * variant per OS. Selected once at startup (cli.ts) and injected through
 * StageContext, so tests can exercise either personality on any host.
 */
export interface Platform {
  name: "posix" | "windows";
  /** Wrap a user-authored gate command for the OS shell (gates.ts). */
  shell(command: string): string[];
  /** Env vars the scrubbed agent subprocess env may carry (adapters/claude.ts).
   *  Everything else — GH_TOKEN above all — is dropped. */
  agentEnvAllowlist: string[];
}

export const POSIX: Platform = {
  name: "posix",
  shell: (command) => ["sh", "-c", command],
  agentEnvAllowlist: ["PATH", "HOME", "SHELL", "TERM", "USER", "TMPDIR", "ANTHROPIC_API_KEY"],
};

export const WINDOWS: Platform = {
  name: "windows",
  // /d skips AutoRun registry commands, /s preserves quoting, /c runs and exits.
  shell: (command) => ["cmd", "/d", "/s", "/c", command],
  // Windows processes need system vars (SYSTEMROOT, COMSPEC, PATHEXT) to load
  // DLLs and resolve executables, and profile vars (USERPROFILE, APPDATA,
  // LOCALAPPDATA, TEMP/TMP) to find their own config and credentials.
  agentEnvAllowlist: [
    "PATH",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "SYSTEMROOT",
    "COMSPEC",
    "PATHEXT",
    "USERNAME",
    "ANTHROPIC_API_KEY",
  ],
};

export function currentPlatform(): Platform {
  return process.platform === "win32" ? WINDOWS : POSIX;
}
