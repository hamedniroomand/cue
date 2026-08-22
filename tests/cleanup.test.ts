import { describe, expect, test } from "bun:test";
import { runCleanup } from "../src/cleanup";
import { poll } from "../src/pipeline";
import { makeCtx } from "./triage.test";
import { wt } from "./helpers/paths";

const IN_REVIEW = JSON.stringify([
  { number: 7, title: "Fix login", body: "b", labels: [{ name: "agent:in-review" }] },
]);

describe("runCleanup", () => {
  test("merged PR: label → agent:done, worktree and branch removed", async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            "gh",
            "issue",
            "list",
            "--repo",
            "*",
            "--label",
            "agent:in-review",
            "--state",
            "all",
          ],
          result: { stdout: IN_REVIEW },
        },
        { match: ["gh", "pr", "view", "agent/issue-7"], result: { stdout: '{"state":"MERGED"}' } },
        {
          match: [
            "gh",
            "issue",
            "edit",
            "7",
            "--repo",
            "*",
            "--remove-label",
            "agent:in-review",
            "--add-label",
            "agent:done",
          ],
        },
        { match: ["git", "-C", "/repos/widgets", "worktree", "remove", "--force", wt(7)] },
        { match: ["git", "-C", "/repos/widgets", "branch", "-D", "agent/issue-7"] },
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(5);
  });

  test("PR closed without merge: label → agent:failed", async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ["gh", "issue", "list"], result: { stdout: IN_REVIEW } },
        { match: ["gh", "pr", "view", "agent/issue-7"], result: { stdout: '{"state":"CLOSED"}' } },
        {
          match: [
            "gh",
            "issue",
            "edit",
            "7",
            "--repo",
            "*",
            "--remove-label",
            "agent:in-review",
            "--add-label",
            "agent:failed",
          ],
        },
        { match: ["git", "*", "*", "worktree", "remove"] },
        { match: ["git", "*", "*", "branch", "-D"] },
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(5);
  });

  test("open PR is left untouched", async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ["gh", "issue", "list"], result: { stdout: IN_REVIEW } },
        { match: ["gh", "pr", "view", "agent/issue-7"], result: { stdout: '{"state":"OPEN"}' } },
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(2);
  });

  test("tolerates a missing PR and a missing worktree on this machine", async () => {
    const { ctx } = await makeCtx(
      [
        { match: ["gh", "issue", "list"], result: { stdout: IN_REVIEW } },
        { match: ["gh", "pr", "view"], result: { code: 1, stderr: "no pull requests found" } },
      ],
      [],
    );
    await runCleanup(ctx); // must not throw
  });

  test("merged cleanup survives worktree-remove failures (worktree lives on another machine)", async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ["gh", "issue", "list"], result: { stdout: IN_REVIEW } },
        { match: ["gh", "pr", "view"], result: { stdout: '{"state":"MERGED"}' } },
        { match: ["gh", "issue", "edit", "7"] },
        {
          match: ["git", "*", "*", "worktree", "remove"],
          result: { code: 128, stderr: "not a working tree" },
        },
        {
          match: ["git", "*", "*", "branch", "-D"],
          result: { code: 1, stderr: "branch not found" },
        },
      ],
      [],
    );
    await runCleanup(ctx); // must not throw
    expect(calls).toHaveLength(5);
  });
});

describe("poll runs cleanup first", () => {
  test("the in-review sweep happens before ready/approved listing", async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            "gh",
            "issue",
            "list",
            "--repo",
            "*",
            "--label",
            "agent:in-review",
            "--state",
            "all",
          ],
          result: { stdout: "[]" },
        },
        {
          match: ["gh", "issue", "list", "--repo", "*", "--label", "agent:ready"],
          result: { stdout: "[]" },
        },
        {
          match: ["gh", "issue", "list", "--repo", "*", "--label", "agent:approved"],
          result: { stdout: "[]" },
        },
        {
          match: ["gh", "issue", "list", "--repo", "*", "--label", "agent:replan"],
          result: { stdout: "[]" },
        },
      ],
      [],
    );
    await poll(ctx);
    expect(calls[0]).toContain("agent:in-review");
  });
});
