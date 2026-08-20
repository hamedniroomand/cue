import type { StageContext } from "./stages/context";

// Reconcile agent:in-review issues with what the humans did to their PRs:
// merged → agent:done, closed-without-merge → agent:failed, open → wait.
export async function runCleanup(ctx: StageContext): Promise<void> {
  const inReview = await ctx.github.listIssues("agent:in-review", "all");
  for (const issue of inReview) {
    const state = await ctx.github.prState(ctx.worktrees.branch(issue.number));
    if (state === "MERGED") {
      await ctx.github.swapLabel(issue.number, "agent:in-review", "agent:done");
      await ctx.worktrees.remove(issue.number);
      console.log(`#${issue.number} merged → agent:done, worktree cleaned`);
    } else if (state === "CLOSED") {
      await ctx.github.swapLabel(issue.number, "agent:in-review", "agent:failed");
      await ctx.worktrees.remove(issue.number);
      console.log(`#${issue.number} PR closed without merge → agent:failed`);
    }
  }
}
