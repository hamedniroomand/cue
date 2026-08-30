import { runGate, runSetup } from '@/gates';
import type { Issue } from '@/github';
import { loadPrompt, renderPrompt } from '@/prompt';
import { knowledgeVars, specsDevGuidance } from '@/specs';
import type { StageContext } from '@/stages/context';
import { pushWithRepair, runFix } from '@/stages/dev';
import { loggedRun } from '@/stages/run';
import { PLAN_MARKER } from '@/stages/triage';

const REVISE_TIMEOUT_MS = 60 * 60_000;

/** Cue's own PR comments (review verdicts, failure/no-change notes) are not human feedback. */
const isCueComment = (body: string) =>
  body.includes('cue review:') || body.includes('⚠️ cue') || body.includes('ℹ️ cue');

export async function runRevise(ctx: StageContext, issue: Issue): Promise<void> {
  await ctx.github.swapLabel(issue.number, 'agent:revise', 'agent:in-dev');
  const plan = (await ctx.github.findComment(issue.number, PLAN_MARKER)) ?? '(no plan found)';
  const branch = ctx.worktrees.branch(issue.number);
  const pr = await ctx.github.prFeedback(branch);
  const feedback =
    pr.items
      .filter((i) => !isCueComment(i.body))
      .map(
        (i) =>
          `@${i.author}${i.path ? ` (${i.path}${i.line ? `:${i.line}` : ''})` : ''}: ${i.body}`,
      )
      .join('\n\n') ||
    '(no PR feedback found — re-read the plan and the current code, and improve the change where it clearly falls short)';

  const wt = await ctx.worktrees.ensure(issue.number);
  if (ctx.config.setup) {
    ctx.onEvent({
      ts: Date.now(),
      issue: issue.number,
      stage: 'revise',
      kind: 'progress',
      message: `worktree setup: ${ctx.config.setup}`,
    });
    await runSetup(ctx.exec, wt.path, ctx.config.setup, ctx.platform);
  }
  const template = await loadPrompt(ctx.promptsDirs, 'revise');
  const prompt = renderPrompt(template, {
    issue_title: issue.title,
    plan,
    feedback,
    ...(await knowledgeVars(wt.path, specsDevGuidance)),
  });
  await loggedRun(ctx, issue.number, 'revise', {
    prompt,
    cwd: wt.path,
    model: ctx.config.models.dev,
    maxTurns: ctx.config.maxTurns.dev,
    access: 'write',
    bashAllowlist: ctx.config.devBashAllowlist,
    timeoutMs: REVISE_TIMEOUT_MS,
    onProgress: (m) =>
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'revise',
        kind: 'progress',
        message: m,
      }),
  });

  let gate = await runGate(ctx.exec, wt.path, ctx.config.gate, ctx.platform);
  if (!gate.ok) {
    await runFix(ctx, wt.path, issue.number, gate.output);
    gate = await runGate(ctx.exec, wt.path, ctx.config.gate, ctx.platform);
    if (!gate.ok) throw new Error(`gate failed after repair:\n${gate.output}`);
  }

  const committed = await ctx.worktrees.commitAll(
    issue.number,
    `fix: address PR feedback on #${issue.number}`,
  );
  if (committed) {
    await pushWithRepair(ctx, wt.path, issue.number);
  } else {
    // A revise that changes nothing is a legitimate outcome (feedback already
    // addressed) — say so on the PR instead of failing the stage.
    await ctx.github.prComment(
      branch,
      'ℹ️ cue revise: the agent made no code changes for this feedback — see the fresh review verdict below.',
    );
  }
  await ctx.github.swapLabel(issue.number, 'agent:in-dev', 'agent:in-review');
  const url = `https://github.com/${ctx.config.repo}/pull/${pr.number}`;
  await ctx.notify({
    event: 'revised',
    issue: issue.number,
    title: issue.title,
    repo: ctx.config.repo,
    url,
    text: `🔁 cue: PR for #${issue.number} "${issue.title}" revised after feedback — awaiting review and merge: ${url}`,
  });
}
