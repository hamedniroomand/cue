import type { Issue } from '@/github';
import { loadPrompt, renderPrompt } from '@/prompt';
import type { StageContext } from '@/stages/context';
import { loggedRun } from '@/stages/run';

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
  const res = await loggedRun(ctx, issue.number, 'triage', {
    prompt,
    cwd: ctx.config.repoPath,
    model: ctx.config.models.triage,
    maxTurns: ctx.config.maxTurns.triage,
    access: 'read-only',
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
  if (!res.text.includes('## Acceptance criteria'))
    throw new Error('triage output missing required sections');
  await ctx.github.comment(issue.number, `${PLAN_MARKER}\n${res.text}`);
  await ctx.github.addLabel(issue.number, 'agent:planned');
  await ctx.notify({
    event: 'planned',
    issue: issue.number,
    title: issue.title,
    repo: ctx.config.repo,
    url: `https://github.com/${ctx.config.repo}/issues/${issue.number}`,
    text: `📋 cue: plan ready for #${issue.number} "${issue.title}" — awaiting approval (agent:approved)`,
  });
}
