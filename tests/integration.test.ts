import { describe, expect, test } from "bun:test";
import { runIssue } from "../src/pipeline";
import { makeCtx } from "./triage.test";
import { wt } from "./helpers/paths";

const PLAN =
  "## Problem\np\n## Approach\na\n## Files likely touched\n- f\n## Acceptance criteria\n- [ ] c\n## Risk\nlow";
const PLAN_VIEW = {
  stdout: JSON.stringify({ comments: [{ body: `<!-- cue:plan -->\n${PLAN}` }] }),
};
const APPROVE = JSON.stringify({ approve: true, findings: [] });

describe("full lifecycle", () => {
  test("ready → triage → (human approves) → dev → review → in-review", async () => {
    // Phase 1: triage
    const t = await makeCtx(
      [
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--remove-label", "agent:ready"] },
        { match: ["gh", "issue", "comment", "7"] },
        { match: ["gh", "issue", "edit", "7", "--repo", "*", "--add-label", "agent:planned"] },
      ],
      [PLAN],
    );
    await runIssue(t.ctx, { number: 7, title: "Fix login", body: "b", labels: ["agent:ready"] });
    expect(t.calls.at(-1)!).toContain("agent:planned");

    // Phase 2: human applied agent:approved; dev + review run
    const d = await makeCtx(
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
        { match: ["gh", "issue", "view", "7"], result: PLAN_VIEW },
        { match: ["git", "-C", "/repos/widgets", "fetch"] },
        { match: ["git", "-C", "/repos/widgets", "worktree", "add"] },
        { match: ["sh", "-c", "bun test"] },
        { match: ["git", "-C", wt(7), "add", "-A"] },
        { match: ["git", "-C", wt(7), "commit", "-m"] },
        { match: ["git", "-C", wt(7), "push"] },
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
        { match: ["gh", "issue", "view", "7"], result: PLAN_VIEW },
        { match: ["git", "-C", wt(7), "diff"], result: { stdout: "+ fix" } },
        { match: ["gh", "pr", "comment", "agent/issue-7"] },
      ],
      ["implemented per plan", APPROVE],
    );
    await runIssue(d.ctx, { number: 7, title: "Fix login", body: "b", labels: ["agent:approved"] });
    const prComment = d.calls.at(-1)!.join(" ");
    expect(prComment).toContain("approve");
    expect(prComment).toContain("human must review");
  });
});
