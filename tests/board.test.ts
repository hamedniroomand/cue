import { describe, expect, test } from 'bun:test';

// The dashboard's issue classifier lives in the ui package but is pure TS with
// no ui-only imports, so the root suite covers it directly.
// oxlint-disable-next-line import/no-relative-parent-imports -- ui/ is outside the @/ alias root on purpose
import { splitIssues } from '../ui/app/lib/board';
// oxlint-disable-next-line import/no-relative-parent-imports -- see above
import type { DashboardState, RunIndexEntry } from '../ui/app/lib/board';

const state = (...numbers: number[]): DashboardState => ({
  repo: 'o/r',
  worktreeRoot: '/w',
  models: { triage: 't', dev: 'd', review: 'r' },
  busy: null,
  columns: [
    {
      label: 'agent:ready',
      issues: numbers.map((n) => ({ number: n, title: `Issue ${n}`, labels: [], cost: 1 })),
    },
  ],
});

const index = (...issues: number[]): RunIndexEntry[] =>
  issues.map((issue) => ({ issue, runs: 1, costUsd: 2, lastTs: issue, title: `Issue ${issue}` }));

describe('splitIssues', () => {
  test('classifies board issues as active and index-only issues as done', () => {
    const { active, done } = splitIssues(state(2, 1), index(1, 2, 3));
    expect(active?.map((i) => i.number)).toEqual([1, 2]);
    expect(done?.map((i) => i.number)).toEqual([3]);
  });

  // The regression: /api/state hits `gh` and resolves well after /api/runs, so a
  // null state must NOT be read as "the board is empty" — that flips every
  // recorded issue into Done for a beat, then back to Active when state lands.
  test('reports both lists as unknown while the board state is still loading', () => {
    const { active, done } = splitIssues(null, index(1, 2, 3));
    expect(active).toBeNull();
    expect(done).toBeNull();
  });

  test('reports done as unknown while the run index is still loading', () => {
    const { active, done } = splitIssues(state(1), null);
    expect(active?.map((i) => i.number)).toEqual([1]);
    expect(done).toBeNull();
  });

  test('carries the board label and cost onto active rows', () => {
    const { active } = splitIssues(state(7), index());
    expect(active?.[0]).toMatchObject({ number: 7, title: 'Issue 7', cost: 1, label: 'ready' });
  });

  test('falls back to a placeholder title for an index entry with none', () => {
    const [entry] = index(4);
    const { done } = splitIssues(state(), [{ ...entry!, title: undefined }]);
    expect(done?.[0]).toMatchObject({ number: 4, title: 'Issue #4', cost: 2, label: 'done' });
  });

  test('orders active ascending and done newest-issue first', () => {
    const { active, done } = splitIssues(state(5, 3, 4), index(1, 2, 3, 4, 5));
    expect(active?.map((i) => i.number)).toEqual([3, 4, 5]);
    expect(done?.map((i) => i.number)).toEqual([2, 1]);
  });
});
