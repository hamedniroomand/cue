import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Issue } from "../src/github";
import { GitHub } from "../src/github";
import { RunLogger } from "../src/log";
import { WorktreeManager } from "../src/worktree";
import { PLAN_MARKER, runTriage } from "../src/stages/triage";
import type { StageContext } from "../src/stages/context";
import { makeFakeAdapter } from "./helpers/fakeAdapter";
import { makeFakeExec, type ExpectedCall } from "./helpers/fakeExec";

const ISSUE: Issue = { number: 7, title: "Fix login", body: "It breaks", labels: ["agent:ready"] };

export async function makeCtx(
  ghCalls: ExpectedCall[],
  adapterResponses: string[],
): Promise<{
  ctx: StageContext;
  calls: string[][];
  runs: ReturnType<typeof makeFakeAdapter>["runs"];
}> {
  const { exec, calls } = makeFakeExec(ghCalls);
  const { adapter, runs } = makeFakeAdapter(adapterResponses);
  const runsDir = await mkdtemp(join(tmpdir(), "conductor-test-"));
  const config = {
    repo: "acme/widgets",
    repoPath: "/repos/widgets",
    adapter: "claude" as const,
    models: { triage: "haiku", dev: "sonnet", review: "sonnet" },
    maxTurns: { triage: 15, dev: 60, review: 25 },
    reviewFixIterations: 2,
    gate: { test: "bun test" },
    worktreeRoot: "/wt",
    baseBranch: "main",
    staleClaimMinutes: 90,
  };
  const ctx: StageContext = {
    config,
    github: new GitHub(exec, config.repo),
    adapter,
    logger: new RunLogger(runsDir),
    exec,
    worktrees: new WorktreeManager(exec, config),
    promptsDirs: ["prompts"],
  };
  return { ctx, calls, runs };
}

const GOOD_PLAN =
  "## Problem\nx\n## Approach\ny\n## Files likely touched\n- a\n## Acceptance criteria\n- [ ] works\n## Risk\nlow";

describe("runTriage", () => {
  test("claims, plans read-only, comments with marker, labels planned", async () => {
    const { ctx, calls, runs } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--remove-label", "agent:ready"] },
        { match: ["gh", "issue", "comment", "7"] },
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--add-label", "agent:planned"] },
      ],
      [GOOD_PLAN],
    );
    await runTriage(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.model).toBe("haiku");
    expect(run.cwd).toBe("/repos/widgets");
    expect(run.allowedTools).toEqual(["Read", "Grep", "Glob"]);
    expect(run.prompt).toContain("Fix login");
    const commentCall = calls[1]!;
    expect(commentCall.join(" ")).toContain(PLAN_MARKER);
  });

  test("throws when the plan is missing required sections", async () => {
    const { ctx } = await makeCtx(
      [{ match: ["gh", "issue", "edit", "7"] }],
      ["I refuse to use the template"],
    );
    await expect(runTriage(ctx, ISSUE)).rejects.toThrow("missing required sections");
  });
});
