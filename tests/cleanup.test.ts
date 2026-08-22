import { describe, expect, test } from 'bun:test';

import { runCleanup } from '@/cleanup';
import { poll } from '@/pipeline';

import { wt } from './helpers/paths';
import { makeCtx } from './triage.test';

const IN_REVIEW = JSON.stringify([
  { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:in-review' }] },
]);

// Every runCleanup ends with the stale-claim sweep; these tests have none.
const noInDev = {
  match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:in-dev'],
  result: { stdout: '[]' },
};

describe('runCleanup', () => {
  test('merged PR: label → agent:done, worktree and branch removed', async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            'gh',
            'issue',
            'list',
            '--repo',
            '*',
            '--label',
            'agent:in-review',
            '--state',
            'all',
          ],
          result: { stdout: IN_REVIEW },
        },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: { stdout: '{"state":"MERGED"}' } },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:in-review',
            '--add-label',
            'agent:done',
          ],
        },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'remove', '--force', wt(7)] },
        { match: ['git', '-C', '/repos/widgets', 'branch', '-D', 'agent/issue-7'] },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(6);
  });

  test('merged PR emits a cleanup done event', async () => {
    const { ctx, events } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: { stdout: '{"state":"MERGED"}' } },
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['git', '*', '*', 'worktree', 'remove'] },
        { match: ['git', '*', '*', 'branch', '-D'] },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx);
    expect(events).toEqual([
      expect.objectContaining({
        issue: 7,
        stage: 'cleanup',
        kind: 'done',
        message: 'merged → agent:done, worktree cleaned',
      }),
    ]);
  });

  test('closed PR emits a cleanup error event', async () => {
    const { ctx, events } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: { stdout: '{"state":"CLOSED"}' } },
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['git', '*', '*', 'worktree', 'remove'] },
        { match: ['git', '*', '*', 'branch', '-D'] },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx);
    expect(events).toEqual([
      expect.objectContaining({
        issue: 7,
        stage: 'cleanup',
        kind: 'error',
        message: 'PR closed without merge → agent:failed',
      }),
    ]);
  });

  test('PR closed without merge: label → agent:failed', async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: { stdout: '{"state":"CLOSED"}' } },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:in-review',
            '--add-label',
            'agent:failed',
          ],
        },
        { match: ['git', '*', '*', 'worktree', 'remove'] },
        { match: ['git', '*', '*', 'branch', '-D'] },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(6);
  });

  test('open PR is left untouched', async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: { stdout: '{"state":"OPEN"}' } },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(3);
  });

  test('tolerates a missing PR and a missing worktree on this machine', async () => {
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view'], result: { code: 1, stderr: 'no pull requests found' } },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx); // must not throw
  });

  test('merged cleanup survives worktree-remove failures (worktree lives on another machine)', async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ['gh', 'issue', 'list'], result: { stdout: IN_REVIEW } },
        { match: ['gh', 'pr', 'view'], result: { stdout: '{"state":"MERGED"}' } },
        { match: ['gh', 'issue', 'edit', '7'] },
        {
          match: ['git', '*', '*', 'worktree', 'remove'],
          result: { code: 128, stderr: 'not a working tree' },
        },
        {
          match: ['git', '*', '*', 'branch', '-D'],
          result: { code: 1, stderr: 'branch not found' },
        },
        noInDev,
      ],
      [],
    );
    await runCleanup(ctx); // must not throw
    expect(calls).toHaveLength(6);
  });
});

describe('stale agent:in-dev reclaim', () => {
  const IN_DEV = JSON.stringify([
    { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:in-dev' }] },
  ]);
  const noInReview = {
    match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:in-review', '--state', 'all'],
    result: { stdout: '[]' },
  };
  const listInDev = {
    match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:in-dev'],
    result: { stdout: IN_DEV },
  };

  test('a claim older than staleClaimMinutes is reset to agent:approved', async () => {
    const { ctx, calls, events } = await makeCtx(
      [
        noInReview,
        listInDev,
        { match: ['gh', 'api'], result: { stdout: '2000-01-01T00:00:00Z\n' } },
        { match: ['git', '*', '*', 'worktree', 'remove'] },
        { match: ['git', '*', '*', 'branch', '-D'] },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:in-dev',
            '--add-label',
            'agent:approved',
          ],
        },
        { match: ['gh', 'issue', 'comment', '7'] },
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(7);
    expect(calls.at(-1)!.join(' ')).toContain('stale');
    expect(events).toEqual([
      expect.objectContaining({
        issue: 7,
        stage: 'cleanup',
        kind: 'done',
        message: 'stale agent:in-dev claim → agent:approved',
      }),
    ]);
  });

  test('a fresh claim is left running', async () => {
    const { ctx, calls } = await makeCtx(
      [
        noInReview,
        listInDev,
        { match: ['gh', 'api'], result: { stdout: `${new Date().toISOString()}\n` } },
      ],
      [],
    );
    await runCleanup(ctx);
    expect(calls).toHaveLength(3);
  });

  test('a failed issue that kept its claim gets agent:in-dev removed, never reclaimed', async () => {
    const BOTH = JSON.stringify([
      {
        number: 12,
        title: 'CORS',
        body: 'b',
        labels: [{ name: 'agent:in-dev' }, { name: 'agent:failed' }],
      },
    ]);
    const { ctx, calls, events } = await makeCtx(
      [
        noInReview,
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:in-dev'],
          result: { stdout: BOTH },
        },
        { match: ['gh', 'issue', 'edit', '12', '--repo', '*', '--remove-label', 'agent:in-dev'] },
      ],
      [],
    );
    await runCleanup(ctx);
    // No timeline probe, no reclaim to agent:approved — a failed issue must
    // wait for a human, however old its leftover claim is.
    expect(calls).toHaveLength(3);
    expect(events).toEqual([
      expect.objectContaining({
        issue: 12,
        stage: 'cleanup',
        kind: 'done',
        message: 'failed run left agent:in-dev behind → claim removed',
      }),
    ]);
  });

  test('an unreadable timeline leaves the claim untouched', async () => {
    const { ctx, calls } = await makeCtx(
      [noInReview, listInDev, { match: ['gh', 'api'], result: { code: 1, stderr: 'nope' } }],
      [],
    );
    await runCleanup(ctx); // must not throw, must not relabel
    expect(calls).toHaveLength(3);
  });
});

describe('poll runs cleanup first', () => {
  test('the in-review sweep happens before ready/approved listing', async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            'gh',
            'issue',
            'list',
            '--repo',
            '*',
            '--label',
            'agent:in-review',
            '--state',
            'all',
          ],
          result: { stdout: '[]' },
        },
        noInDev,
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: '[]' },
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:approved'],
          result: { stdout: '[]' },
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:replan'],
          result: { stdout: '[]' },
        },
      ],
      [],
    );
    await poll(ctx);
    expect(calls[0]).toContain('agent:in-review');
  });
});
