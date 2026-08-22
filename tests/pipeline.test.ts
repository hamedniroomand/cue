import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github";
import { nextAction, poll, runIssue } from "../src/pipeline";
import { makeCtx } from "./triage.test";

describe("nextAction", () => {
  test("routes by label with stop winning over everything", () => {
    expect(nextAction(["agent:ready"])).toBe("triage");
    expect(nextAction(["agent:approved", "bug"])).toBe("dev");
    expect(nextAction(["agent:planned", "agent:replan"])).toBe("replan");
    expect(nextAction(["agent:replan", "agent:stop"])).toBe("skip");
    expect(nextAction(["agent:ready", "agent:stop"])).toBe("skip");
    expect(nextAction(["agent:planned"])).toBe("skip");
    expect(nextAction([])).toBe("skip");
  });
});

describe("runIssue failure handling", () => {
  test("a stage error becomes an issue comment + agent:failed, not a crash", async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--remove-label", "agent:ready"] },
        { match: ["gh", "issue", "comment", "7"] },
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--add-label", "agent:failed"] },
      ],
      ["garbage output"],
    );
    const issue: Issue = { number: 7, title: "t", body: "b", labels: ["agent:ready"] };
    await runIssue(ctx, issue);
    const comment = calls[1]!.join(" ");
    expect(comment).toContain("cue triage failed");
    expect(comment).toContain("missing required sections");
  });

  test("returns failed so poll can count outcomes", async () => {
    const { ctx } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7"] },
        { match: ["gh", "issue", "comment", "7"] },
        { match: ["gh", "issue", "edit", "7"] },
      ],
      ["garbage output"],
    );
    const issue: Issue = { number: 7, title: "t", body: "b", labels: ["agent:ready"] };
    expect(await runIssue(ctx, issue)).toBe("failed");
  });

  test("skip labels do nothing", async () => {
    const { ctx, calls } = await makeCtx([], []);
    await runIssue(ctx, {
      number: 7,
      title: "t",
      body: "b",
      labels: ["agent:stop", "agent:ready"],
    });
    expect(calls).toHaveLength(0);
  });
});

const emptyList = (label: string) => ({
  match: ["gh", "issue", "list", "--repo", "*", "--label", label],
  result: { stdout: "[]" },
});

describe("poll reporting", () => {
  test("says so when no issues are actionable instead of exiting silently", async () => {
    const { ctx, events } = await makeCtx(
      [
        emptyList("agent:in-review"),
        emptyList("agent:ready"),
        emptyList("agent:approved"),
        emptyList("agent:replan"),
      ],
      [],
    );
    await poll(ctx);
    const pollEvents = events.filter((e) => e.stage === "poll");
    expect(pollEvents[0]).toMatchObject({ kind: "start", issue: 0 });
    expect(pollEvents.at(-1)).toMatchObject({ kind: "done" });
    expect(pollEvents.at(-1)!.message).toContain("nothing to do");
  });

  test("reports the actionable count and the failure count", async () => {
    const READY = JSON.stringify([
      { number: 7, title: "t", body: "b", labels: [{ name: "agent:ready" }] },
    ]);
    const { ctx, events } = await makeCtx(
      [
        emptyList("agent:in-review"),
        {
          match: ["gh", "issue", "list", "--repo", "*", "--label", "agent:ready"],
          result: { stdout: READY },
        },
        emptyList("agent:approved"),
        emptyList("agent:replan"),
        { match: ["gh", "issue", "edit", "7"] },
        { match: ["gh", "issue", "comment", "7"] },
        { match: ["gh", "issue", "edit", "7"] },
      ],
      ["garbage output"],
    );
    await poll(ctx);
    const pollEvents = events.filter((e) => e.stage === "poll");
    expect(pollEvents.map((e) => e.kind)).toEqual(["start", "progress", "done"]);
    expect(pollEvents[1]!.message).toContain("1 actionable");
    expect(pollEvents.at(-1)!.message).toContain("1 failed");
  });
});
