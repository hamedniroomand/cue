import * as v from 'valibot';

import { runGate } from '@/gates';
import type { Issue } from '@/github';
import { loadPrompt, renderPrompt } from '@/prompt';
import {
  appendLearnings,
  extractLessons,
  readLearnings,
  resolveSpecsDir,
  specsReviewGuidance,
} from '@/specs';
import type { StageContext } from '@/stages/context';
import { loggedRun } from '@/stages/run';
import { PLAN_MARKER } from '@/stages/triage';

const VerdictSchema = v.object({
  approve: v.boolean(),
  findings: v.array(
    v.object({
      file: v.string(),
      line: v.optional(v.number()),
      severity: v.picklist(['low', 'medium', 'high']),
      note: v.string(),
    }),
  ),
});

export type Verdict = v.InferOutput<typeof VerdictSchema>;

const REVIEW_TIMEOUT_MS = 30 * 60_000;

export function parseVerdict(text: string): Verdict | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return v.parse(VerdictSchema, JSON.parse(match[0]));
  } catch {
    return null;
  }
}

async function reviewOnce(
  ctx: StageContext,
  issue: Issue,
  plan: string,
  specsGuidance: string,
): Promise<Verdict> {
  const diff = await ctx.worktrees.diff(issue.number);
  const template = await loadPrompt(ctx.promptsDirs, 'review');
  let prompt = renderPrompt(template, { plan, diff, specs_guidance: specsGuidance });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await loggedRun(ctx, issue.number, 'review', {
      prompt,
      cwd: ctx.worktrees.path(issue.number),
      model: ctx.config.models.review,
      maxTurns: ctx.config.maxTurns.review,
      access: 'read-only',
      timeoutMs: REVIEW_TIMEOUT_MS,
      onProgress: (m) =>
        ctx.onEvent({
          ts: Date.now(),
          issue: issue.number,
          stage: 'review',
          kind: 'progress',
          message: m,
        }),
    });
    const verdict = parseVerdict(res.text);
    if (verdict) return verdict;
    prompt = `${prompt}\n\nRespond with only the JSON object.`;
  }
  throw new Error('review returned unparseable verdict');
}

async function fixFindings(ctx: StageContext, issue: Issue, verdict: Verdict): Promise<void> {
  const template = await loadPrompt(ctx.promptsDirs, 'fix');
  const prompt = renderPrompt(template, {
    failure_output: `Code review rejected the change. Findings:\n${JSON.stringify(verdict.findings, null, 2)}`,
  });
  const cwd = ctx.worktrees.path(issue.number);
  await loggedRun(ctx, issue.number, 'review-fix', {
    prompt,
    cwd,
    model: ctx.config.models.dev,
    maxTurns: ctx.config.maxTurns.dev,
    access: 'write',
    bashAllowlist: ctx.config.devBashAllowlist,
    timeoutMs: REVIEW_TIMEOUT_MS,
    onProgress: (m) =>
      ctx.onEvent({
        ts: Date.now(),
        issue: issue.number,
        stage: 'review-fix',
        kind: 'progress',
        message: m,
      }),
  });
  const gate = await runGate(ctx.exec, cwd, ctx.config.gate, ctx.platform);
  if (!gate.ok) throw new Error(`gate failed after review fix:\n${gate.output}`);
  await ctx.worktrees.commitAll(issue.number, 'fix: address review findings');
  await ctx.worktrees.push(issue.number);
}

// Low findings are notes for the human merging the PR, not grounds for another
// costly fix+gate+re-review cycle — only medium/high block.
function hasBlockingFindings(verdict: Verdict): boolean {
  return verdict.findings.some((f) => f.severity !== 'low');
}

function verdictComment(verdict: Verdict): string {
  const header = verdict.approve
    ? '✅ cue review: approve'
    : hasBlockingFindings(verdict)
      ? '⚠️ cue review: changes still needed'
      : '✅ cue review: no blocking findings — low-severity notes left for the human';
  const findings = verdict.findings
    .map((f) => `- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ''}\` — ${f.note}`)
    .join('\n');
  return `${header}\n\n${findings || 'No findings.'}\n\n_A human must review and merge this PR._`;
}

const LEARNINGS_TIMEOUT_MS = 10 * 60_000;

/**
 * Distill the findings that forced fix iterations into `.cue/learnings.md` —
 * the reactive half of the knowledge layer, riding the same PR as the change.
 * Opt-in by the file existing in the repo, and best-effort by contract: a
 * finished review never fails on a bad retrospective.
 */
async function recordLearnings(
  ctx: StageContext,
  issue: Issue,
  findings: Verdict['findings'],
): Promise<void> {
  if (findings.length === 0) return;
  const cwd = ctx.worktrees.path(issue.number);
  const existing = await readLearnings(cwd);
  if (existing === null) return;
  try {
    const template = await loadPrompt(ctx.promptsDirs, 'learnings');
    const prompt = renderPrompt(template, {
      existing: existing || '(nothing recorded yet)',
      findings: JSON.stringify(findings, null, 2),
    });
    const res = await loggedRun(ctx, issue.number, 'learnings', {
      prompt,
      cwd,
      model: ctx.config.models.review,
      maxTurns: ctx.config.maxTurns.review,
      access: 'read-only',
      timeoutMs: LEARNINGS_TIMEOUT_MS,
      onProgress: (m) =>
        ctx.onEvent({
          ts: Date.now(),
          issue: issue.number,
          stage: 'learnings',
          kind: 'progress',
          message: m,
        }),
    });
    const lessons = extractLessons(res.text);
    if (lessons.length === 0) return;
    await appendLearnings(cwd, lessons);
    await ctx.worktrees.commitAll(
      issue.number,
      `docs: record review learnings for #${issue.number}`,
    );
    await ctx.worktrees.push(issue.number);
  } catch {
    // Best-effort: the verdict is already on the PR; learnings never block it.
  }
}

export async function runReview(ctx: StageContext, issue: Issue): Promise<Verdict> {
  const plan = (await ctx.github.findComment(issue.number, PLAN_MARKER)) ?? '(no plan found)';
  const specsDir = await resolveSpecsDir(ctx.worktrees.path(issue.number));
  const specsGuidance = specsDir ? specsReviewGuidance(specsDir) : '';
  let verdict = await reviewOnce(ctx, issue, plan, specsGuidance);
  const fixedFindings: Verdict['findings'] = [];
  for (
    let i = 0;
    i < ctx.config.reviewFixIterations && !verdict.approve && hasBlockingFindings(verdict);
    i++
  ) {
    fixedFindings.push(...verdict.findings);
    await fixFindings(ctx, issue, verdict);
    verdict = await reviewOnce(ctx, issue, plan, specsGuidance);
  }
  await ctx.github.prComment(ctx.worktrees.branch(issue.number), verdictComment(verdict));
  await recordLearnings(ctx, issue, fixedFindings);
  return verdict;
}
