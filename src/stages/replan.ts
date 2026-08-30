import type { Issue } from '@/github';
import { fenceUntrusted, loadPrompt, renderPrompt } from '@/prompt';
import { knowledgeVars, specsPlanGuidance } from '@/specs';
import type { StageContext } from '@/stages/context';
import { loggedRun } from '@/stages/run';
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
  // The feedback is deliberately NOT fenced: a human read the thread and
  // applied agent:replan — that label is the gate that makes it instructions.
  const prompt = renderPrompt(
    template,
    {
      issue_number: String(issue.number),
      issue_title: fenceUntrusted(issue.title),
      issue_body: fenceUntrusted(issue.body),
      previous_plan: previousPlan,
      feedback,
      ...(await knowledgeVars(ctx.config.repoPath, specsPlanGuidance)),
    },
    ['previous_plan', 'feedback'],
  );
  const res = await loggedRun(ctx, issue.number, 'replan', {
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
