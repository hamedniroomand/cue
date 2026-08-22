import type { Issue } from '@/github';
import { loadPrompt, renderPrompt } from '@/prompt';
import type { StageContext } from '@/stages/context';
import { PLAN_MARKER } from '@/stages/triage';

const REPLAN_TIMEOUT_MS = 20 * 60_000;

export async function runReplan(ctx: StageContext, issue: Issue): Promise<void> {
  await ctx.github.removeLabel(issue.number, 'agent:replan');
  const comments = await ctx.github.comments(issue.number);
  const planIdx = comments.findLastIndex((c) => c.body.includes(PLAN_MARKER));
  if (planIdx === -1) throw new Error('no plan comment found to revise');
  const previousPlan = comments[planIdx]!.body;
  const feedback =
    comments
      .slice(planIdx + 1)
      .filter((c) => !c.body.includes(PLAN_MARKER) && !c.body.includes('⚠️ cue'))
      .map((c) => `@${c.author}: ${c.body}`)
      .join('\n\n') ||
    '(no explicit feedback was left — the human simply wants a better plan than the previous one)';

  const template = await loadPrompt(ctx.promptsDirs, 'replan');
  const prompt = renderPrompt(template, {
    issue_number: String(issue.number),
    issue_title: issue.title,
    issue_body: issue.body,
    previous_plan: previousPlan,
    feedback,
  });
  const start = Date.now();
  const res = await ctx.adapter.run({
    prompt,
    cwd: ctx.config.repoPath,
    model: ctx.config.models.triage,
    maxTurns: ctx.config.maxTurns.triage,
    access: 'read-only',
    webSearch: true,
    timeoutMs: REPLAN_TIMEOUT_MS,
    onProgress: (m) =>
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'replan',
        kind: 'progress',
        message: m,
      }),
  });
  await ctx.logger.log(issue.number, 'replan', {
    prompt,
    result: res.raw,
    costUsd: res.costUsd,
    durationMs: Date.now() - start,
    outcome: 'ok',
  });
  if (!res.text.includes('## Acceptance criteria'))
    throw new Error('replan output missing required sections');
  await ctx.github.comment(issue.number, `${PLAN_MARKER}\n${res.text}`);
  await ctx.github.addLabel(issue.number, 'agent:planned');
  await ctx.notify({
    event: 'planned',
    issue: issue.number,
    title: issue.title,
    repo: ctx.config.repo,
    url: `https://github.com/${ctx.config.repo}/issues/${issue.number}`,
    text: `📋 cue: revised plan ready for #${issue.number} "${issue.title}" — awaiting approval (agent:approved)`,
  });
}
