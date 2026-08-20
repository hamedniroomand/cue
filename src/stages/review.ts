import * as v from "valibot";
import { runGate } from "../gates";
import type { Issue } from "../github";
import { loadPrompt, renderPrompt } from "../prompt";
import type { StageContext } from "./context";
import { devTools } from "./dev";
import { PLAN_MARKER } from "./triage";

const VerdictSchema = v.object({
  approve: v.boolean(),
  findings: v.array(
    v.object({
      file: v.string(),
      line: v.optional(v.number()),
      severity: v.picklist(["low", "medium", "high"]),
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

async function reviewOnce(ctx: StageContext, issue: Issue, plan: string): Promise<Verdict> {
  const diff = await ctx.worktrees.diff(issue.number);
  const template = await loadPrompt(ctx.promptsDirs, "review");
  let prompt = renderPrompt(template, { plan, diff });
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Date.now();
    const res = await ctx.adapter.run({
      prompt,
      cwd: ctx.worktrees.path(issue.number),
      model: ctx.config.models.review,
      maxTurns: ctx.config.maxTurns.review,
      allowedTools: ["Read", "Grep", "Glob"],
      timeoutMs: REVIEW_TIMEOUT_MS,
      onProgress: (m) => console.log(`[review #${issue.number}] ${m}`),
    });
    await ctx.logger.log(issue.number, "review", {
      prompt,
      result: res.raw,
      costUsd: res.costUsd,
      durationMs: Date.now() - start,
      outcome: "ok",
    });
    const verdict = parseVerdict(res.text);
    if (verdict) return verdict;
    prompt = `${prompt}\n\nRespond with only the JSON object.`;
  }
  throw new Error("review returned unparseable verdict");
}

async function fixFindings(ctx: StageContext, issue: Issue, verdict: Verdict): Promise<void> {
  const template = await loadPrompt(ctx.promptsDirs, "fix");
  const prompt = renderPrompt(template, {
    failure_output: `Code review rejected the change. Findings:\n${JSON.stringify(verdict.findings, null, 2)}`,
  });
  const cwd = ctx.worktrees.path(issue.number);
  const start = Date.now();
  const res = await ctx.adapter.run({
    prompt,
    cwd,
    model: ctx.config.models.dev,
    maxTurns: ctx.config.maxTurns.dev,
    allowedTools: devTools(ctx.config),
    timeoutMs: REVIEW_TIMEOUT_MS,
    onProgress: (m) => console.log(`[review-fix #${issue.number}] ${m}`),
  });
  await ctx.logger.log(issue.number, "review-fix", {
    prompt,
    result: res.raw,
    costUsd: res.costUsd,
    durationMs: Date.now() - start,
    outcome: "ok",
  });
  const gate = await runGate(ctx.exec, cwd, ctx.config.gate);
  if (!gate.ok) throw new Error(`gate failed after review fix:\n${gate.output}`);
  await ctx.worktrees.commitAll(issue.number, "fix: address review findings");
  await ctx.worktrees.push(issue.number);
}

function verdictComment(verdict: Verdict): string {
  const header = verdict.approve
    ? "✅ conductor review: approve"
    : "⚠️ conductor review: changes still needed";
  const findings = verdict.findings
    .map((f) => `- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ""}\` — ${f.note}`)
    .join("\n");
  return `${header}\n\n${findings || "No findings."}\n\n_A human must review and merge this PR._`;
}

export async function runReview(ctx: StageContext, issue: Issue): Promise<Verdict> {
  const plan = (await ctx.github.findComment(issue.number, PLAN_MARKER)) ?? "(no plan found)";
  let verdict = await reviewOnce(ctx, issue, plan);
  for (let i = 0; i < ctx.config.reviewFixIterations && !verdict.approve; i++) {
    await fixFindings(ctx, issue, verdict);
    verdict = await reviewOnce(ctx, issue, plan);
  }
  await ctx.github.prComment(ctx.worktrees.branch(issue.number), verdictComment(verdict));
  return verdict;
}
