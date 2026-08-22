import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github";
import { nextAction, runIssue } from "../src/pipeline";
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
