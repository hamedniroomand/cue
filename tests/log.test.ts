import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger } from "../src/log";

describe("RunLogger", () => {
  test("writes one JSON file per invocation and sums costs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    const logger = new RunLogger(dir);
    const p1 = await logger.log(42, "triage", {
      prompt: "p",
      result: { ok: 1 },
      costUsd: 0.03,
      durationMs: 900,
      outcome: "ok",
    });
    await logger.log(42, "dev", {
      prompt: "p2",
      result: null,
      costUsd: 1.2,
      durationMs: 5000,
      outcome: "failed",
      error: "boom",
    });
    expect(p1).toContain(join(dir, "42", "triage-"));
    const written = await Bun.file(p1).json();
    expect(written.costUsd).toBe(0.03);
    expect(await logger.totalCost(42)).toBeCloseTo(1.23);
    expect(await logger.totalCost(999)).toBe(0);
  });

  test("list returns per-run summaries without prompt or result payloads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    const logger = new RunLogger(dir);
    await logger.log(7, "triage", {
      prompt: "big prompt",
      result: { huge: true },
      costUsd: 0.05,
      durationMs: 1200,
      outcome: "ok",
    });
    await logger.log(7, "dev", {
      prompt: "p",
      result: null,
      durationMs: 9000,
      outcome: "failed",
      error: "boom",
    });
    const runs = await logger.list(7);
    expect(runs).toHaveLength(2);
    const triage = runs.find((r) => r.stage === "triage")!;
    expect(triage.costUsd).toBe(0.05);
    expect(triage.outcome).toBe("ok");
    expect(triage.ts).toBeGreaterThan(0);
    expect("prompt" in triage).toBe(false);
    expect(await logger.list(999)).toEqual([]);
  });

  test("read returns the full entry for one run id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    const logger = new RunLogger(dir);
    const path = await logger.log(5, "triage", {
      prompt: "the exact prompt",
      result: [{ type: "result", result: "done" }],
      costUsd: 0.02,
      durationMs: 1500,
      outcome: "ok",
    });
    const id = path.split(/[\\/]/).pop()!.replace(".json", "");
    const detail = await logger.read(5, id);
    expect(detail).not.toBeNull();
    expect(detail!.stage).toBe("triage");
    expect(detail!.prompt).toBe("the exact prompt");
    expect(detail!.costUsd).toBe(0.02);
    expect(Array.isArray(detail!.result)).toBe(true);
  });

  test("read returns null for unknown issues, unknown ids, and traversal attempts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    const logger = new RunLogger(dir);
    await logger.log(5, "triage", {
      prompt: "p",
      result: null,
      durationMs: 10,
      outcome: "ok",
    });
    await Bun.write(join(dir, "secret.json"), JSON.stringify({ prompt: "leaked" }));

    expect(await logger.read(999, "triage-1")).toBeNull();
    expect(await logger.read(5, "nope-1")).toBeNull();
    // The id is matched against a directory listing, never joined into a path.
    expect(await logger.read(5, "../secret")).toBeNull();
    expect(await logger.read(Number.NaN, "triage-1")).toBeNull();
  });

  test("index lists every issue with recorded runs, recovering titles from prompts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    const logger = new RunLogger(dir);
    await logger.log(4, "triage", {
      prompt: "You are the triage agent.\n\nIssue #4: Configure Bun and linter\n\nbody",
      result: null,
      costUsd: 0.1,
      durationMs: 100,
      outcome: "ok",
    });
    await logger.log(4, "dev", {
      prompt: "no issue header here",
      result: null,
      costUsd: 0.4,
      durationMs: 200,
      outcome: "ok",
    });
    await logger.log(9, "triage", {
      prompt: "no header",
      result: null,
      durationMs: 50,
      outcome: "ok",
    });
    // The dev prompt omits the issue number: `Issue: <title>`.
    await logger.log(11, "dev", {
      prompt: "You are the dev agent.\n\n---\n\nIssue: Implement /about-us page\n\nbody",
      result: null,
      durationMs: 60,
      outcome: "ok",
    });

    const index = await logger.index();
    expect(index.map((e) => e.issue)).toEqual([4, 9, 11]);
    expect(index[2]!.title).toBe("Implement /about-us page");

    const four = index[0]!;
    expect(four.runs).toBe(2);
    expect(four.costUsd).toBeCloseTo(0.5);
    // Title is recovered from the recorded prompt, so archived/closed issues
    // stay browsable without any gh call.
    expect(four.title).toBe("Configure Bun and linter");
    expect(four.lastTs).toBeGreaterThan(0);

    // No recoverable title is fine — the issue still shows up.
    // Prose mentioning "the issue body" must not be mistaken for a header.
    expect(index[1]!.issue).toBe(9);
    expect(index[1]!.title).toBeUndefined();
  });

  test("index returns an empty list when nothing has been recorded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cue-runs-"));
    expect(await new RunLogger(dir).index()).toEqual([]);
    expect(await new RunLogger(join(dir, "missing")).index()).toEqual([]);
  });
});
