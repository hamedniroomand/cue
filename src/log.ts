import { mkdir, readdir } from "node:fs/promises";

export interface RunEntry {
  prompt: string;
  result: unknown;
  costUsd?: number;
  durationMs: number;
  outcome: "ok" | "failed";
  error?: string;
}

export class RunLogger {
  constructor(private runsDir: string) {}

  async log(issue: number, stage: string, entry: RunEntry): Promise<string> {
    const dir = `${this.runsDir}/${issue}`;
    await mkdir(dir, { recursive: true });
    const path = `${dir}/${stage}-${Date.now()}.json`;
    await Bun.write(path, JSON.stringify(entry, null, 2));
    return path;
  }

  async totalCost(issue: number): Promise<number> {
    const dir = `${this.runsDir}/${issue}`;
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return 0;
    }
    let total = 0;
    for (const f of files) {
      const entry = (await Bun.file(`${dir}/${f}`).json()) as RunEntry;
      total += entry.costUsd ?? 0;
    }
    return total;
  }
}
