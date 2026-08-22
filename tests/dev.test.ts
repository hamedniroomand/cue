import { describe, expect, test } from "bun:test";
import type { Issue } from "../src/github";
import { devTools, runDev } from "../src/stages/dev";
import { makeCtx } from "./triage.test";

describe("devTools", () => {
  test("allows unrestricted Bash by default", async () => {
    const { ctx } = await makeCtx([], []);
    expect(devTools(ctx.config)).toContain("Bash");
  });

  test("scopes Bash to configured patterns when devBashAllowlist is set", async () => {
    const { ctx } = await makeCtx([], []);
    const tools = devTools({ ...ctx.config, devBashAllowlist: ["bun *", "git status"] });
    expect(tools).not.toContain("Bash");
    expect(tools).toContain("Bash(bun *)");
    expect(tools).toContain("Bash(git status)");
    expect(tools).toContain("Edit"); // core tools unaffected
  });
});

const ISSUE: Issue = {
  number: 7,
  title: "Fix login",
  body: "It breaks",
  labels: ["agent:approved"],
};
const PLAN_COMMENT = "<!-- cue:plan -->\n## Approach\ndo it\n## Acceptance criteria\n- [ ] works";

function planViewResult() {
  return { stdout: JSON.stringify({ comments: [{ body: PLAN_COMMENT }] }) };
}

describe("runDev", () => {
  test("happy path: claim, implement, gate, commit, push, draft PR, in-review", async () => {
    const { ctx, calls, runs } = await makeCtx(
      [
        {
          match: [
            "gh",
            "issue",
            "edit",
            "7",
            "--repo",
            "*",
            "--remove-label",
            "agent:approved",
            "--add-label",
            "agent:in-dev",
          ],
        },
        { match: ["gh", "issue", "view", "7"], result: planViewResult() },
        { match: ["git", "-C", "/repos/widgets", "fetch"] },
        { match: ["git", "-C", "/repos/widgets", "worktree", "add"] },
        { match: ["sh", "-c", "bun test"] },
        { match: ["git", "-C", "/wt/issue-7", "add", "-A"] },
        { match: ["git", "-C", "/wt/issue-7", "commit", "-m"] },
        { match: ["git", "-C", "/wt/issue-7", "push", "-u", "origin", "agent/issue-7"] },
        {
          match: ["gh", "pr", "create"],
          result: { stdout: "https://github.com/acme/widgets/pull/9" },
        },
        {
          match: [
            "gh",
            "issue",
            "edit",
            "7",
            "--repo",
            "*",
            "--remove-label",
            "agent:in-dev",
            "--add-label",
            "agent:in-review",
          ],
        },
      ],
      ["implemented the feature"],
    );
    await runDev(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.cwd).toBe("/wt/issue-7");
    expect(run.model).toBe("sonnet");
    expect(run.allowedTools).toContain("Bash");
    expect(run.prompt).toContain("## Approach");
    expect(calls.some((c) => c.includes("--draft"))).toBe(true);
  });

  test("gate failure triggers one fix run, then succeeds", async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7"] },
        { match: ["gh", "issue", "view", "7"], result: planViewResult() },
        { match: ["git", "-C", "/repos/widgets", "fetch"] },
        { match: ["git", "-C", "/repos/widgets", "worktree", "add"] },
        { match: ["sh", "-c", "bun test"], result: { code: 1, stderr: "2 tests failed" } },
        { match: ["sh", "-c", "bun test"] },
        { match: ["git", "-C", "/wt/issue-7", "add", "-A"] },
        { match: ["git", "-C", "/wt/issue-7", "commit", "-m"] },
        { match: ["git", "-C", "/wt/issue-7", "push"] },
        { match: ["gh", "pr", "create"], result: { stdout: "url" } },
        { match: ["gh", "issue", "edit", "7"] },
      ],
      ["implemented", "fixed the tests"],
    );
    await runDev(ctx, ISSUE);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.prompt).toContain("2 tests failed");
  });

  test("gate failure after fix throws", async () => {
    const { ctx } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7"] },
        { match: ["gh", "issue", "view", "7"], result: planViewResult() },
        { match: ["git", "-C", "/repos/widgets", "fetch"] },
        { match: ["git", "-C", "/repos/widgets", "worktree", "add"] },
        { match: ["sh", "-c", "bun test"], result: { code: 1, stderr: "fail" } },
        { match: ["sh", "-c", "bun test"], result: { code: 1, stderr: "still failing" } },
      ],
      ["implemented", "tried to fix"],
    );
    await expect(runDev(ctx, ISSUE)).rejects.toThrow("gate failed");
  });

  test("missing plan comment throws before any worktree work", async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7"] },
        { match: ["gh", "issue", "view", "7"], result: { stdout: '{"comments":[]}' } },
      ],
      [],
    );
    await expect(runDev(ctx, ISSUE)).rejects.toThrow("no plan comment found");
    expect(calls.some((c) => c.includes("worktree"))).toBe(false);
  });
});
