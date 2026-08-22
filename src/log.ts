import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface RunEntry {
  prompt: string;
  result: unknown;
  costUsd?: number;
  durationMs: number;
  outcome: "ok" | "failed";
  error?: string;
}

/** One issue that has recorded runs on this machine. */
export interface RunIndexEntry {
  issue: number;
  runs: number;
  costUsd: number;
  lastTs: number;
  title?: string;
}

export interface RunDetail extends RunSummary {
  prompt: string;
  result: unknown;
}

export interface RunSummary {
  stage: string;
  ts: number;
  costUsd?: number;
  durationMs: number;
  outcome: "ok" | "failed";
  error?: string;
}

export class RunLogger {
  constructor(private runsDir: string) {}

  async log(issue: number, stage: string, entry: RunEntry): Promise<string> {
    const dir = join(this.runsDir, String(issue));
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${stage}-${Date.now()}.json`);
    await Bun.write(path, JSON.stringify(entry, null, 2));
    return path;
  }

  async list(issue: number): Promise<RunSummary[]> {
    const dir = join(this.runsDir, String(issue));
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const runs: RunSummary[] = [];
    for (const f of files.toSorted()) {
      const m = f.match(/^(.+)-(\d+)\.json$/);
      if (!m) continue;
      const entry = (await Bun.file(join(dir, f)).json()) as RunEntry;
      runs.push({
        stage: m[1]!,
        ts: Number(m[2]!),
        costUsd: entry.costUsd,
        durationMs: entry.durationMs,
        outcome: entry.outcome,
        error: entry.error,
      });
    }
    return runs;
  }

  /**
   * Read one recorded run by its `<stage>-<ts>` id. The id is matched against a
   * directory listing rather than joined into a path, so it cannot traverse.
   */
  async read(issue: number, id: string): Promise<RunDetail | null> {
    if (!Number.isSafeInteger(issue) || issue < 0) return null;
    const dir = join(this.runsDir, String(issue));
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return null;
    }
    const name = files.find((f) => f === `${id}.json`);
    if (!name) return null;
    const m = name.match(/^(.+)-(\d+)\.json$/);
    if (!m) return null;
    const entry = (await Bun.file(join(dir, name)).json()) as RunEntry;
    return {
      stage: m[1]!,
      ts: Number(m[2]!),
      costUsd: entry.costUsd,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
      error: entry.error,
      prompt: entry.prompt,
      result: entry.result,
    };
  }

  /**
   * Every issue with runs on disk — including ones no longer on the label board
   * (agent:done, closed, deleted). Titles are recovered from the recorded
   * prompts so archived issues stay browsable without any `gh` call.
   */
  async index(): Promise<RunIndexEntry[]> {
    let dirs: string[];
    try {
      dirs = await readdir(this.runsDir);
    } catch {
      return [];
    }
    const entries: RunIndexEntry[] = [];
    for (const name of dirs) {
      const issue = Number(name);
      if (!Number.isSafeInteger(issue) || issue <= 0) continue;
      let files: string[];
      try {
        files = await readdir(join(this.runsDir, name));
      } catch {
        continue;
      }
      let runs = 0;
      let costUsd = 0;
      let lastTs = 0;
      let title: string | undefined;
      for (const f of files.toSorted()) {
        const m = f.match(/^(.+)-(\d+)\.json$/);
        if (!m) continue;
        const entry = (await Bun.file(join(this.runsDir, name, f)).json()) as RunEntry;
        runs += 1;
        costUsd += entry.costUsd ?? 0;
        lastTs = Math.max(lastTs, Number(m[2]!));
        title ??= entry.prompt.match(/^Issue(?: #\d+)?: (.+)$/m)?.[1]?.trim();
      }
      if (runs > 0) entries.push({ issue, runs, costUsd, lastTs, title });
    }
    return entries.toSorted((a, b) => a.issue - b.issue);
  }

  async totalCost(issue: number): Promise<number> {
    const dir = join(this.runsDir, String(issue));
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return 0;
    }
    let total = 0;
    for (const f of files) {
      const entry = (await Bun.file(join(dir, f)).json()) as RunEntry;
      total += entry.costUsd ?? 0;
    }
    return total;
  }
}
