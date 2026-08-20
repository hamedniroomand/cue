import type { Exec, ExecResult } from "../../src/exec";

export interface ExpectedCall {
  match: string[];
  result?: Partial<ExecResult>;
}

export function makeFakeExec(expected: ExpectedCall[]): { exec: Exec; calls: string[][] } {
  const queue = [...expected];
  const calls: string[][] = [];
  const exec: Exec = async (cmd, opts) => {
    calls.push(cmd);
    const next = queue.shift();
    if (!next) throw new Error(`unexpected exec: ${cmd.join(" ")}`);
    next.match.forEach((tok, i) => {
      if (tok !== "*" && cmd[i] !== tok)
        throw new Error(`expected [${next.match.join(" ")}], got [${cmd.join(" ")}]`);
    });
    const res = { code: 0, stdout: "", stderr: "", ...next.result };
    if (opts?.onLine) {
      for (const line of res.stdout.split("\n")) if (line.trim()) opts.onLine(line);
    }
    return res;
  };
  return { exec, calls };
}
