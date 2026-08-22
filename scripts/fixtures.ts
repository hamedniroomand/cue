#!/usr/bin/env bun
/**
 * Snapshot the local .cue run logs into ui/app/fixtures/data.json so the
 * dashboard renders without a cue process. Run: bun run fixtures
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const RUNS_DIR = process.env.CUE_RUNS_DIR ?? '.runs';
const OUT = 'ui/app/fixtures/data.json';

const BOARD_LABELS = [
  'agent:ready',
  'agent:planned',
  'agent:approved',
  'agent:replan',
  'agent:in-dev',
  'agent:in-review',
  'agent:failed',
];

interface Summary {
  stage: string;
  ts: number;
  costUsd?: number;
  durationMs: number;
  outcome: string;
  error?: string;
}

const runs: Record<string, Summary[]> = {};
const details: Record<string, Array<Summary & { prompt: string; result: unknown }>> = {};
const titles: Record<string, string> = {};
const labels: Record<string, string> = {};

let issueDirs: string[] = [];
try {
  issueDirs = await readdir(RUNS_DIR);
} catch {
  console.error(`no ${RUNS_DIR} directory — nothing to snapshot`);
  process.exit(1);
}

for (const issue of issueDirs.toSorted()) {
  const dir = join(RUNS_DIR, issue);
  const issueRuns: Summary[] = [];
  const issueDetails: Array<Summary & { prompt: string; result: unknown }> = [];
  for (const f of (await readdir(dir)).toSorted()) {
    const m = f.match(/^(.+)-(\d+)\.json$/);
    if (!m?.[1] || !m[2]) continue;
    const entry = await Bun.file(join(dir, f)).json();
    const summary: Summary = {
      stage: m[1],
      ts: Number(m[2]),
      costUsd: entry.costUsd,
      durationMs: entry.durationMs,
      outcome: entry.outcome,
      ...(entry.error ? { error: entry.error } : {}),
    };
    issueRuns.push(summary);
    issueDetails.push({ ...summary, prompt: entry.prompt, result: entry.result });
    // Recover the issue title from the triage/replan prompt header.
    const title = String(entry.prompt).match(/^Issue(?: #\d+)?: (.+)$/m)?.[1];
    if (title) titles[issue] = title.trim();
  }
  runs[issue] = issueRuns;
  details[issue] = issueDetails;
  // Best guess at board position: a reviewed issue is in review, else planned.
  labels[issue] = issueRuns.some((r) => r.stage === 'review') ? 'agent:in-review' : 'agent:planned';
}

const cost = (issue: string) => (runs[issue] ?? []).reduce((t, r) => t + (r.costUsd ?? 0), 0);

const state = {
  repo: process.env.CUE_FIXTURE_REPO ?? 'cue/pilot',
  worktreeRoot: '~/.cue/worktrees/cue-pilot',
  models: { triage: 'haiku', dev: 'sonnet', review: 'sonnet' },
  busy: null,
  columns: BOARD_LABELS.map((label) => ({
    label,
    issues: Object.keys(runs)
      .filter((n) => labels[n] === label)
      .map((n) => ({
        number: Number(n),
        title: titles[n] ?? `Issue #${n}`,
        labels: [label],
        cost: cost(n),
      })),
  })),
};

const index = Object.entries(runs)
  .map(([n, rs]) => ({
    issue: Number(n),
    runs: rs.length,
    costUsd: cost(n),
    lastTs: Math.max(...rs.map((r) => r.ts)),
    ...(titles[n] ? { title: titles[n] } : {}),
  }))
  .toSorted((a, b) => a.issue - b.issue);

// The snapshot ships in a public repo: scrub machine-identifying home paths
// from the raw transcripts (they appear inside string values only).
const json = JSON.stringify({ state, index, runs, details }).replaceAll(
  /\/(?:Users|home)\/[A-Za-z0-9._-]+/g,
  '~',
);
await Bun.write(OUT, json);
const kb = (Bun.file(OUT).size / 1024).toFixed(0);
console.log(
  `wrote ${OUT} (${kb}K) — ${Object.keys(runs).length} issues, ${Object.values(runs).flat().length} runs`,
);
