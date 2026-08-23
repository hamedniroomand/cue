import { nextAction } from '@/action';
import { runCleanup } from '@/cleanup';
import type { Issue } from '@/github';
import type { StageContext } from '@/stages/context';
import { runDev } from '@/stages/dev';
import { runReplan } from '@/stages/replan';
import { runReview } from '@/stages/review';
import { runTriage } from '@/stages/triage';

export type { Action } from '@/action';
export { nextAction };

export type Outcome = 'done' | 'failed' | 'skip';

export async function runIssue(ctx: StageContext, issue: Issue): Promise<Outcome> {
  const action = nextAction(issue.labels);
  if (action === 'skip') return 'skip';
  const emit = (kind: 'start' | 'done' | 'error', message: string) =>
    ctx.onEvent({ ts: Date.now(), issue: issue.number, stage: action, kind, message });
  emit('start', issue.title);
  try {
    if (action === 'triage') {
      await runTriage(ctx, issue);
    } else if (action === 'replan') {
      await runReplan(ctx, issue);
    } else {
      await runDev(ctx, issue);
      await runReview(ctx, issue);
    }
    emit('done', `${action} finished`);
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('error', message);
    await ctx.github.comment(
      issue.number,
      `⚠️ cue ${action} failed: ${message.slice(0, 1500)}\n\nSee \`.cue/runs/${issue.number}/\` on the runner machine for transcripts. Reset the label to retry.`,
    );
    // A failed dev must not keep its claim: in-dev + failed renders as two
    // board columns, and a lingering claim would eventually be stale-reclaimed
    // back to agent:approved — silently re-running a failed issue.
    if (action === 'dev') {
      try {
        await ctx.github.removeLabel(issue.number, 'agent:in-dev');
      } catch {
        // The claim may never have been applied (the swap itself failed).
      }
    }
    await ctx.github.addLabel(issue.number, 'agent:failed');
    return 'failed';
  }
}

export async function poll(ctx: StageContext): Promise<void> {
  const emit = (kind: 'start' | 'progress' | 'done', message: string) =>
    ctx.onEvent({ ts: Date.now(), issue: 0, stage: 'poll', kind, message });
  emit('start', `scanning ${ctx.config.repo} for actionable issues`);
  await runCleanup(ctx);
  const queue = await ctx.github.listActionable();
  if (queue.length === 0) {
    emit('done', 'nothing to do — no issues labeled agent:ready, agent:approved, or agent:replan');
    return;
  }
  const triage = queue.filter((i) => nextAction(i.labels) === 'triage').length;
  const dev = queue.filter((i) => nextAction(i.labels) === 'dev').length;
  const replan = queue.filter((i) => nextAction(i.labels) === 'replan').length;
  emit('progress', `${queue.length} actionable: ${triage} triage, ${dev} dev, ${replan} replan`);
  let failed = 0;
  for (const issue of queue) {
    if ((await runIssue(ctx, issue)) === 'failed') failed++;
  }
  const summary = `poll finished: ${queue.length} processed${failed ? `, ${failed} failed` : ''}`;
  emit('done', summary);
}
