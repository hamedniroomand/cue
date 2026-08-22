/**
 * Board classification — pure, so the root test suite covers it directly.
 *
 * The label board and the on-disk run index are two independent sources that
 * arrive at different times: /api/state calls `gh`, /api/runs is a directory
 * read. Classification is only meaningful once BOTH are known, so every list
 * here is nullable and `null` means "still loading", never "empty".
 */

export interface BoardIssue {
  number: number;
  title: string;
  labels: string[];
  cost: number;
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
  lastTs: number;
  title?: string;
}

export interface IssueRow {
  number: number;
  title: string;
  cost: number;
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

  const board: IssueRow[] = state.columns.flatMap((c) =>
    c.issues.map((i) => ({
      number: i.number,
      title: i.title,
      cost: i.cost,
      label: shortLabel(c.label),
    })),
  );
  const active = board.toSorted((a, b) => a.number - b.number);
  if (!index) return { active, done: null };

  const onBoard = new Set(board.map((i) => i.number));
  const done = index
    .filter((e) => !onBoard.has(e.issue))
    .map((e) => ({
      number: e.issue,
      title: e.title ?? `Issue #${e.issue}`,
      cost: e.costUsd,
      label: "done",
    }))
    .toSorted((a, b) => b.number - a.number);

  return { active, done };
}
