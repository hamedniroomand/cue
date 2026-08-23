/**
 * Client-side view of the cue API (src/server.ts).
 *
 * Every fetch falls back to the bundled fixtures in app/fixtures so the
 * dashboard is reviewable without a cue process running.
 *
 * Transcript normalization lives in ./transcript and board classification in
 * ./board — both pure, both covered by the root test suite — and both are
 * re-exported here so the routes have a single import.
 */

import type { DashboardState, RunIndexEntry } from "./board";
import { formatTokens, type TokenUsage } from "./transcript";

export * from "./board";
export * from "./transcript";

export interface CueEvent {
  ts: number;
  issue: number;
  stage: string;
  kind: "start" | "progress" | "done" | "error";
  message: string;
}

export interface RunSummary {
  stage: string;
  ts: number;
  costUsd?: number;
  usage?: TokenUsage;
  durationMs: number;
  outcome: "ok" | "failed";
  error?: string;
}

export interface RunDetail extends RunSummary {
  prompt: string;
  result: unknown;
}

export const STAGES = [
  "triage",
  "replan",
  "dev",
  "fix",
  "review",
  "review-fix",
  "revise",
  "learnings",
] as const;

export function formatUsd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Cost and tokens are different facts, not alternatives: claude reports both,
 * codex and antigravity only tokens. Showing whichever exists — and both when
 * both do — is what keeps claude runs from hiding their token counts behind a
 * dollar figure.
 */
export function formatUsage(costUsd: number | undefined, tokens: number | undefined): string {
  const parts: string[] = [];
  if (costUsd) parts.push(formatUsd(costUsd));
  if (tokens) parts.push(`${formatTokens(tokens)} tok`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/* ---------------------------------------------------------------- fetching */

async function fixtures() {
  return (await import("~/fixtures")).default;
}

async function get<T>(path: string, fallback: () => Promise<T>): Promise<T> {
  try {
    const res = await fetch(path);
    if (!res.ok) return await fallback();
    return (await res.json()) as T;
  } catch {
    return await fallback();
  }
}

export async function fetchState(): Promise<DashboardState> {
  return get("/api/state", async () => (await fixtures()).state);
}

/**
 * Issues with recorded runs, read from disk. This is the source of truth for the
 * explorer: the label board only holds issues still in flight, so anything that
 * reached agent:done would otherwise be invisible.
 */
export async function fetchRunIndex(): Promise<RunIndexEntry[]> {
  return get("/api/runs", async () => (await fixtures()).index ?? []);
}

export async function fetchRuns(issue: number): Promise<RunSummary[]> {
  return get(`/api/runs/${issue}`, async () => (await fixtures()).runs[issue] ?? []);
}

export async function fetchRun(issue: number, run: string): Promise<RunDetail | null> {
  return get(`/api/runs/${issue}/${run}`, async () => {
    const all = (await fixtures()).details[issue] ?? [];
    return all.find((d) => `${d.stage}-${d.ts}` === run) ?? null;
  });
}

export async function poll(): Promise<void> {
  await fetch("/api/poll", { method: "POST" });
}

export async function runIssue(issue: number): Promise<void> {
  await fetch(`/api/run/${issue}`, { method: "POST" });
}

/** One-click plan approval: agent:planned → agent:approved, then run. */
export async function approveIssue(issue: number): Promise<void> {
  await fetch(`/api/approve/${issue}`, { method: "POST" });
}

/** Request a revised plan: post the feedback comment, agent:planned → agent:replan, then run. */
export async function replanIssue(issue: number, feedback: string): Promise<void> {
  await fetch(`/api/replan/${issue}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });
}

/** Re-queue a failed issue: replan if pending, dev if a plan exists, else triage. */
export async function retryIssue(issue: number): Promise<void> {
  await fetch(`/api/retry/${issue}`, { method: "POST" });
}
