import type { Issue } from '@/github';
import { loadPrompt, renderPrompt } from '@/prompt';
import type { StageContext } from '@/stages/context';

export const PLAN_MARKER = '<!-- cue:plan -->';
const TRIAGE_TIMEOUT_MS = 15 * 60_000;

export async function runTriage(ctx: StageContext, issue: Issue): Promise<void> {
  await ctx.github.removeLabel(issue.number, 'agent:ready');
  const template = await loadPrompt(ctx.promptsDirs, 'triage');
  const prompt = renderPrompt(template, {
    issue_number: String(issue.number),
    issue_title: issue.title,
    issue_body: issue.body,
  });
  const start = Date.now();
  const res = await ctx.adapter.run({
    prompt,
    cwd: ctx.config.repoPath,
    model: ctx.config.models.triage,
    maxTurns: ctx.config.maxTurns.triage,
    allowedTools: ['Read', 'Grep', 'Glob'],
    timeoutMs: TRIAGE_TIMEOUT_MS,
    onProgress: (m) =>
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'triage',
        kind: 'progress',
        message: m,
      }),
  });
  await ctx.logger.log(issue.number, 'triage', {
    prompt,
    result: res.raw,
    costUsd: res.costUsd,
    durationMs: Date.now() - start,
    outcome: 'ok',
  });
  if (!res.text.includes('## Acceptance criteria'))
    throw new Error('triage output missing required sections');
  await ctx.github.comment(issue.number, `${PLAN_MARKER}\n${res.text}`);
  await ctx.github.addLabel(issue.number, 'agent:planned');
}
