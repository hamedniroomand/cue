export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

export type Exec = (cmd: string[], opts?: ExecOptions) => Promise<ExecResult>;

async function drainStdout(
  stream: ReadableStream<Uint8Array>,
  onLine?: (line: string) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let all = '';
  let pending = '';
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    if (!onLine) continue;
    pending += text;
    let nl: number;
    while ((nl = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      if (line.trim()) onLine(line);
    }
  }
  if (onLine && pending.trim()) onLine(pending);
  return all;
}

export const realExec: Exec = async (cmd, opts = {}) => {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ?? (process.env as Record<string, string>),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const killer = opts.timeoutMs ? setTimeout(() => proc.kill(), opts.timeoutMs) : null;
  const [stdout, stderr, code] = await Promise.all([
    drainStdout(proc.stdout, opts.onLine),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (killer) clearTimeout(killer);
  return { code, stdout, stderr };
};
