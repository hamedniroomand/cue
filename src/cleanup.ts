import type { StageContext } from '@/stages/context';

// Reconcile agent:in-review issues with what the humans did to their PRs
// (merged → agent:done, closed-without-merge → agent:failed, open → wait),
// then reclaim agent:in-dev issues whose runner crashed mid-run.
export async function runCleanup(ctx: StageContext): Promise<void> {
  const inReview = await ctx.github.listIssues('agent:in-review', 'all');
  for (const issue of inReview) {
    const state = await ctx.github.prState(ctx.worktrees.branch(issue.number));
    if (state === 'MERGED') {
      await ctx.github.swapLabel(issue.number, 'agent:in-review', 'agent:done');
      await ctx.worktrees.remove(issue.number);
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'cleanup',
        kind: 'done',
        message: 'merged → agent:done, worktree cleaned',
      });
    } else if (state === 'CLOSED') {
      await ctx.github.swapLabel(issue.number, 'agent:in-review', 'agent:failed');
      await ctx.worktrees.remove(issue.number);
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'cleanup',
        kind: 'error',
        message: 'PR closed without merge → agent:failed',
      });
    }
  }

  // A crashed or rebooted runner leaves agent:in-dev behind with nothing
  // finishing the job. The claim's age lives on GitHub (the label event), so
  // any machine can reclaim it once staleClaimMinutes have passed. An
  // unreadable timeline means "cannot tell", never "stale" — leave it be.
  const inDev = await ctx.github.listIssues('agent:in-dev');
  for (const issue of inDev) {
    const claimedAt = await ctx.github.labelAddedAt(issue.number, 'agent:in-dev');
    if (claimedAt === null) continue;
    if (Date.now() - claimedAt < ctx.config.staleClaimMinutes * 60_000) continue;
    await ctx.worktrees.remove(issue.number);
    await ctx.github.swapLabel(issue.number, 'agent:in-dev', 'agent:approved');
    await ctx.github.comment(
      issue.number,
      `♻️ cue: the agent:in-dev claim looked stale (older than ${ctx.config.staleClaimMinutes} minutes with no run finishing it), so the issue was reset to agent:approved for a fresh dev run.`,
    );
    ctx.onEvent({
      ts: Date.now(),
      issue: issue.number,
      stage: 'cleanup',
      kind: 'done',
      message: 'stale agent:in-dev claim → agent:approved',
    });
  }
}
