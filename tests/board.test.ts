import { describe, expect, test } from 'bun:test';

import { BOARD_LABELS } from '@/server';

// The dashboard's issue classifier lives in the ui package but is pure TS with
// no ui-only imports, so the root suite covers it directly.
// oxlint-disable-next-line import/no-relative-parent-imports -- ui/ is outside the @/ alias root on purpose
import { BOARD_LABELS as UI_BOARD_LABELS, runIssueSet, splitIssues } from '../ui/app/lib/board';
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
      issues: numbers.map((n) => ({
        number: n,
        title: `Issue ${n}`,
        labels: [],
        cost: 1,
        tokens: n * 1000,
      })),
    },
  ],
});

const index = (...issues: number[]): RunIndexEntry[] =>
  issues.map((issue) => ({
    issue,
    runs: 1,
    costUsd: 2,
    tokens: issue * 100,
    lastTs: issue,
    title: `Issue ${issue}`,
  }));

describe('splitIssues', () => {
  // A failed dev run used to leave both agent:in-dev and agent:failed on the
  // issue, and every multi-labeled issue rendered one Active row per column.
  test('an issue sitting in two columns yields one row, labeled by the later column', () => {
    const doubled: DashboardState = {
      ...state(),
      columns: [
        {
          label: 'agent:in-dev',
          issues: [{ number: 12, title: 'CORS', labels: [], cost: 1, tokens: 100 }],
        },
        {
          label: 'agent:failed',
          issues: [{ number: 12, title: 'CORS', labels: [], cost: 1, tokens: 100 }],
        },
      ],
    };
    const { active } = splitIssues(doubled, index());
    expect(active).toHaveLength(1);
    expect(active?.[0]).toMatchObject({ number: 12, label: 'failed' });
  });

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

  // Active rows take tokens from /api/state (the server rolls them up with the
  // cost); Done rows only exist in the index, so they take them from there.
  test('carries tokens onto both active and done issues', () => {
    const { active, done } = splitIssues(state(1), index(1, 2));
    expect(active?.[0]).toMatchObject({ number: 1, cost: 1, tokens: 1000 });
    expect(done?.[0]).toMatchObject({ number: 2, cost: 2, tokens: 200 });
  });
});

describe('runIssueSet', () => {
  test('reports the issue set as unknown while neither source has landed', () => {
    expect(runIssueSet(null, null)).toBeNull();
  });

  test('unions the board and the run index, ascending and deduped', () => {
    expect(runIssueSet(state(3, 1), index(1, 2))).toEqual([1, 2, 3]);
  });

  // The regression this guards: an empty union must resolve to [] so the
  // dashboard can tell "no runs recorded" from "still loading" and stop
  // rendering skeletons.
  test('resolves to an empty array once both sources land with nothing', () => {
    expect(runIssueSet(state(), index())).toEqual([]);
  });

  test('uses the run index alone while the board state is still loading', () => {
    expect(runIssueSet(null, index(4))).toEqual([4]);
  });
});

describe('BOARD_LABELS', () => {
  // The board skeleton renders these columns before /api/state lands, so the
  // ui copy must stay identical to the server's — label names are exact.
  test('mirrors the server board columns exactly', () => {
    expect(UI_BOARD_LABELS).toEqual(BOARD_LABELS);
  });
});
