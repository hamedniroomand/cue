import type { Exec } from '@/exec';

/** An Exec that records the env it was handed and replays a fixed stdout. */
export function makeEnvSpy(stdout: string): { exec: Exec; env: () => Record<string, string> } {
  let seenEnv: Record<string, string> = {};
  const exec: Exec = async (_cmd, opts) => {
    seenEnv = opts?.env ?? {};
    return { code: 0, stdout, stderr: '' };
  };
  return { exec, env: () => seenEnv };
}
