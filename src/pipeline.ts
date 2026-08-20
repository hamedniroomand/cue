import { runCleanup } from "./cleanup";
import type { Issue } from "./github";
import type { StageContext } from "./stages/context";
import { runDev } from "./stages/dev";
import { runReplan } from "./stages/replan";
import { runReview } from "./stages/review";
import { runTriage } from "./stages/triage";

export type Action = "triage" | "dev" | "replan" | "skip";

export function nextAction(labels: string[]): Action {
  if (labels.includes("agent:stop")) return "skip";
  if (labels.includes("agent:replan")) return "replan";
  if (labels.includes("agent:ready")) return "triage";
  if (labels.includes("agent:approved")) return "dev";
  return "skip";
}

export async function runIssue(ctx: StageContext, issue: Issue): Promise<void> {
  const action = nextAction(issue.labels);
  if (action === "skip") return;
  try {
    if (action === "triage") {
      await runTriage(ctx, issue);
    } else if (action === "replan") {
      await runReplan(ctx, issue);
    } else {
      await runDev(ctx, issue);
      await runReview(ctx, issue);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.github.comment(
      issue.number,
      `⚠️ conductor ${action} failed: ${message.slice(0, 1500)}\n\nSee \`.conductor/runs/${issue.number}/\` on the runner machine for transcripts. Reset the label to retry.`,
    );
    await ctx.github.addLabel(issue.number, "agent:failed");
  }
}

export async function poll(ctx: StageContext): Promise<void> {
  await runCleanup(ctx);
  const ready = await ctx.github.listIssues("agent:ready");
  const approved = await ctx.github.listIssues("agent:approved");
  const replans = await ctx.github.listIssues("agent:replan");
  for (const issue of [...ready, ...approved, ...replans]) {
    await runIssue(ctx, issue);
  }
}
