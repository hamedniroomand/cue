/**
 * Board classification — pure, so the root test suite covers it directly.
 *
 * The label board and the on-disk run index are two independent sources that
 * arrive at different times: /api/state calls `gh`, /api/runs is a directory
 * read. Classification is only meaningful once BOTH are known, so every list
 * here is nullable and `null` means "still loading", never "empty".
 */

/**
 * The label columns /api/state always returns, in order — mirrors BOARD_LABELS
 * in src/server.ts (agent:done is deliberately absent: the board is not the run
 * archive). Duplicated here so the board skeleton can render real column
 * headers before the state lands; tests/board.test.ts guards the two against
 * drift.
 */
export const BOARD_LABELS = [
  "agent:ready",
  "agent:planned",
  "agent:approved",
  "agent:replan",
  "agent:in-dev",
  "agent:in-review",
  "agent:failed",
];

/** Labels `cue run` / Process now will pick up — mirrors ACTIONABLE_LABELS in src/action.ts. */
export const ACTIONABLE_LABELS = ["agent:ready", "agent:approved", "agent:replan"] as const;

const NEXT_ACTION: Record<(typeof ACTIONABLE_LABELS)[number], string> = {
  "agent:ready": "triage",
  "agent:approved": "dev",
  "agent:replan": "replan",
};

export interface BoardIssue {
  number: number;
  title: string;
  labels: string[];
  cost: number;
  tokens: number;
}

export interface DashboardState {
  repo: string;
  worktreeRoot: string;
  models: { triage: string; dev: string; review: string };
  busy: string | null;
  columns: Array<{ label: string; issues: BoardIssue[] }>;
}

/** One issue that has recorded runs on this machine. */
export interface RunIndexEntry {
  issue: number;
  runs: number;
  costUsd: number;
  tokens: number;
  lastTs: number;
  title?: string;
}

export interface IssueRow {
  number: number;
  title: string;
  cost: number;
  tokens: number;
  label: string;
}

export function shortLabel(label: string): string {
  return label.replace("agent:", "");
}

/**
 * Split every issue we know about into Active (still on the label board) and
 * Done (runs on disk but off the board — agent:done, closed, deleted).
 *
 * Both halves are `null` until the board state lands, because an absent state
 * is indistinguishable from an empty board: treating it as empty is what made
 * the tabs read "0 active / N done" for a beat before flipping back.
 */
export function splitIssues(
  state: DashboardState | null,
  index: RunIndexEntry[] | null,
): { active: IssueRow[] | null; done: IssueRow[] | null } {
  if (!state) return { active: null, done: null };

  // An issue can transiently carry two agent:* labels (a failed dev run used
  // to keep its in-dev claim) and would render one row per column. Dedupe by
  // number; the later column wins, since columns are ordered by progress.
  const byNumber = new Map<number, IssueRow>();
  for (const c of state.columns) {
    for (const i of c.issues) {
      byNumber.set(i.number, {
        number: i.number,
        title: i.title,
        cost: i.cost,
        tokens: i.tokens,
        label: shortLabel(c.label),
      });
    }
  }
  const board = [...byNumber.values()];
  const active = board.toSorted((a, b) => a.number - b.number);
  if (!index) return { active, done: null };

  const onBoard = new Set(board.map((i) => i.number));
  const done = index
    .filter((e) => !onBoard.has(e.issue))
    .map((e) => ({
      number: e.issue,
      title: e.title ?? `Issue #${e.issue}`,
      cost: e.costUsd,
      tokens: e.tokens,
      label: "done",
    }))
    .toSorted((a, b) => b.number - a.number);

  return { active, done };
}

/**
 * Every issue that could have runs on disk: the union of the run index and the
 * board. `null` means neither source has landed yet — an empty array means both
 * have, and there is genuinely nothing recorded. Callers depend on that
 * distinction to stop rendering skeletons.
 *
 * Either source alone is enough to start fetching: a board issue with no
 * recorded run contributes nothing, and one with runs is already in the index.
 */
export interface ActionableIssue {
  number: number;
  title: string;
  label: string;
  action: string;
}

export type ProcessTarget = { kind: "poll" } | { kind: "run"; issue: number };

/**
 * Issues the header picker can start — the same set `cue run` lists.
 * Newest first so the dropdown matches the CLI select. `null` state is []
 * (nothing to pick), not unknown: the button still says Process now.
 */
export function actionableIssues(state: DashboardState | null): ActionableIssue[] {
  if (!state) return [];
  const rows: ActionableIssue[] = [];
  for (const column of state.columns) {
    if (!isActionable(column.label)) continue;
    for (const issue of column.issues) {
      rows.push({
        number: issue.number,
        title: issue.title,
        label: shortLabel(column.label),
        action: NEXT_ACTION[column.label],
      });
    }
  }
  return rows.toSorted((a, b) => b.number - a.number);
}

function isActionable(label: string): label is (typeof ACTIONABLE_LABELS)[number] {
  return (ACTIONABLE_LABELS as readonly string[]).includes(label);
}

/** A vanished selection (issue left the queue) is a poll, not a stale run. */
export function resolveProcessTarget(
  selected: number | null,
  issues: ActionableIssue[],
): ProcessTarget {
  if (selected != null && issues.some((issue) => issue.number === selected)) {
    return { kind: "run", issue: selected };
  }
  return { kind: "poll" };
}

export function processButtonLabel(target: ProcessTarget): string {
  return target.kind === "run" ? `Run #${target.issue}` : "Process now";
}

export function runIssueSet(
  state: DashboardState | null,
  index: RunIndexEntry[] | null,
): number[] | null {
  if (!state && !index) return null;
  return [
    ...new Set([
      ...(index ?? []).map((e) => e.issue),
      ...(state?.columns ?? []).flatMap((c) => c.issues.map((i) => i.number)),
    ]),
  ].toSorted((a, b) => a - b);
}
