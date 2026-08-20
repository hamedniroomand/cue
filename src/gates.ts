import type { Exec } from "./exec";

export interface GateResult {
  ok: boolean;
  output: string;
}

const GATE_TIMEOUT_MS = 10 * 60_000;

export async function runGate(
  exec: Exec,
  cwd: string,
  gate: { test: string; lint?: string },
): Promise<GateResult> {
  const commands = [gate.test, ...(gate.lint ? [gate.lint] : [])];
  for (const command of commands) {
    const r = await exec(["sh", "-c", command], { cwd, timeoutMs: GATE_TIMEOUT_MS });
    if (r.code !== 0) {
      return { ok: false, output: `$ ${command}\n${r.stdout}\n${r.stderr}`.slice(-8000) };
    }
  }
  return { ok: true, output: "all gates passed" };
}
