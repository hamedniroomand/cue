import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger } from "../src/log";

describe("RunLogger", () => {
  test("writes one JSON file per invocation and sums costs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conductor-runs-"));
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
    expect(p1).toContain(`${dir}/42/triage-`);
    const written = await Bun.file(p1).json();
    expect(written.costUsd).toBe(0.03);
    expect(await logger.totalCost(42)).toBeCloseTo(1.23);
    expect(await logger.totalCost(999)).toBe(0);
  });
});
