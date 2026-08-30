import type { Exec } from '@/exec';
import type { Platform } from '@/platform';

export interface GateResult {
  ok: boolean;
  output: string;
}

const GATE_TIMEOUT_MS = 10 * 60_000;
const SETUP_TIMEOUT_MS = 15 * 60_000;

/**
 * The worktree bootstrap (config "setup"): dependency install and similar
 * one-shot commands, run deterministically before the agent so it never has
 * to discover a bare worktree by chasing "Cannot find package" errors.
 */
export async function runSetup(
  exec: Exec,
  cwd: string,
  setup: string,
  platform: Platform,
): Promise<void> {
  const r = await exec(platform.shell(setup), { cwd, timeoutMs: SETUP_TIMEOUT_MS });
  if (r.code !== 0) {
    const output = `$ ${setup}\n${r.stdout}\n${r.stderr}`.slice(-8000);
    throw new Error(`worktree setup failed:\n${output}`);
  }
}

export async function runGate(
  exec: Exec,
  cwd: string,
  gate: { test: string; lint?: string },
  platform: Platform,
): Promise<GateResult> {
  const commands = [gate.test, ...(gate.lint ? [gate.lint] : [])];
  for (const command of commands) {
    const r = await exec(platform.shell(command), { cwd, timeoutMs: GATE_TIMEOUT_MS });
    if (r.code !== 0) {
      return { ok: false, output: `$ ${command}\n${r.stdout}\n${r.stderr}`.slice(-8000) };
    }
  }
  return { ok: true, output: 'all gates passed' };
}
