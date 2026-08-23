import { describe, expect, test } from 'bun:test';

import type { Issue } from '@/github';
import { poll, runIssue } from '@/pipeline';

import { wt } from './helpers/paths';
import { makeCtx } from './triage.test';

describe('runIssue failure handling', () => {
  test('a stage error becomes an issue comment + agent:failed, not a crash', async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:ready'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:failed'] },
      ],
      ['garbage output'],
    );
    const issue: Issue = { number: 7, title: 't', body: 'b', labels: ['agent:ready'] };
    await runIssue(ctx, issue);
    const comment = calls[1]!.join(' ');
    expect(comment).toContain('cue triage failed');
    expect(comment).toContain('missing required sections');
  });

  test('returns failed so poll can count outcomes', async () => {
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['garbage output'],
    );
    const issue: Issue = { number: 7, title: 't', body: 'b', labels: ['agent:ready'] };
    expect(await runIssue(ctx, issue)).toBe('failed');
  });

  test('a dev failure drops the agent:in-dev claim so only agent:failed remains', async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:approved',
            '--add-label',
            'agent:in-dev',
          ],
        },
        // No plan comment → runDev throws after claiming.
        { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:in-dev'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:failed'] },
      ],
      [],
    );
    const issue: Issue = { number: 7, title: 't', body: 'b', labels: ['agent:approved'] };
    expect(await runIssue(ctx, issue)).toBe('failed');
    expect(calls).toHaveLength(5);
  });

  test('the failure path survives an unremovable in-dev label', async () => {
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
        { match: ['gh', 'issue', 'comment', '7'] },
        {
          match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:in-dev'],
          result: { code: 1, stderr: 'label does not exist' },
        },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:failed'] },
      ],
      [],
    );
    const issue: Issue = { number: 7, title: 't', body: 'b', labels: ['agent:approved'] };
    expect(await runIssue(ctx, issue)).toBe('failed');
  });

  test('agent:revise runs revise then review', async () => {
    const PLAN_VIEW = {
      stdout: JSON.stringify({ comments: [{ body: '<!-- cue:plan -->\nplan' }] }),
    };
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:revise',
            '--add-label',
            'agent:in-dev',
          ],
        },
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        {
          match: ['gh', 'pr', 'view', 'agent/issue-7'],
          result: {
            stdout: JSON.stringify({
              number: 9,
              comments: [{ author: { login: 'hamed' }, body: 'tighten the regex' }],
              reviews: [],
            }),
          },
        },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        { match: ['git', '-C', '/repos/widgets', 'fetch', 'origin', 'agent/issue-7'] },
        { match: ['git', '-C', wt(7), 'rev-parse', '--git-dir'] },
        { match: ['git', '-C', wt(7), 'merge', '--ff-only'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
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
            'agent:in-review',
          ],
        },
        // runReview follows the revise
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ revised' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      ['revised the code', JSON.stringify({ approve: true, findings: [] })],
    );
    const issue: Issue = {
      number: 7,
      title: 't',
      body: 'b',
      labels: ['agent:in-review', 'agent:revise'],
    };
    expect(await runIssue(ctx, issue)).toBe('done');
    expect(calls.at(-1)!.join(' ')).toContain('approve');
  });

  test('a revise failure drops the agent:in-dev claim so only agent:failed remains', async () => {
    const { ctx, calls } = await makeCtx(
      [
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:revise',
            '--add-label',
            'agent:in-dev',
          ],
        },
        { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
        // No PR on the branch → runRevise throws after claiming.
        { match: ['gh', 'pr', 'view'], result: { code: 1, stderr: 'no pull requests found' } },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:in-dev'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:failed'] },
      ],
      [],
    );
    const issue: Issue = { number: 7, title: 't', body: 'b', labels: ['agent:revise'] };
    expect(await runIssue(ctx, issue)).toBe('failed');
    expect(calls).toHaveLength(6);
  });

  test('skip labels do nothing', async () => {
    const { ctx, calls } = await makeCtx([], []);
    await runIssue(ctx, {
      number: 7,
      title: 't',
      body: 'b',
      labels: ['agent:stop', 'agent:ready'],
    });
    expect(calls).toHaveLength(0);
  });
});

const emptyList = (label: string) => ({
  match: ['gh', 'issue', 'list', '--repo', '*', '--label', label],
  result: { stdout: '[]' },
});

describe('poll reporting', () => {
  test('says so when no issues are actionable instead of exiting silently', async () => {
    const { ctx, events } = await makeCtx(
      [
        emptyList('agent:in-review'),
        emptyList('agent:in-dev'),
        emptyList('agent:ready'),
        emptyList('agent:approved'),
        emptyList('agent:replan'),
        emptyList('agent:revise'),
      ],
      [],
    );
    await poll(ctx);
    const pollEvents = events.filter((e) => e.stage === 'poll');
    expect(pollEvents[0]).toMatchObject({ kind: 'start', issue: 0 });
    expect(pollEvents.at(-1)).toMatchObject({ kind: 'done' });
    expect(pollEvents.at(-1)!.message).toContain('nothing to do');
  });

  test('a multi-labeled issue is processed once', async () => {
    const DUAL = JSON.stringify([
      {
        number: 7,
        title: 't',
        body: 'b',
        labels: [{ name: 'agent:ready' }, { name: 'agent:approved' }],
      },
    ]);
    const { ctx, events } = await makeCtx(
      [
        emptyList('agent:in-review'),
        emptyList('agent:in-dev'),
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: DUAL },
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:approved'],
          result: { stdout: DUAL },
        },
        emptyList('agent:replan'),
        emptyList('agent:revise'),
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['garbage output'],
    );
    await poll(ctx);
    const pollEvents = events.filter((e) => e.stage === 'poll');
    expect(pollEvents[1]!.message).toContain('1 actionable');
    expect(pollEvents.at(-1)!.message).toContain('1 processed');
  });

  test('reports the actionable count and the failure count', async () => {
    const READY = JSON.stringify([
      { number: 7, title: 't', body: 'b', labels: [{ name: 'agent:ready' }] },
    ]);
    const { ctx, events } = await makeCtx(
      [
        emptyList('agent:in-review'),
        emptyList('agent:in-dev'),
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: READY },
        },
        emptyList('agent:approved'),
        emptyList('agent:replan'),
        emptyList('agent:revise'),
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['garbage output'],
    );
    await poll(ctx);
    const pollEvents = events.filter((e) => e.stage === 'poll');
    expect(pollEvents.map((e) => e.kind)).toEqual(['start', 'progress', 'done']);
    expect(pollEvents[1]!.message).toContain('1 actionable');
    expect(pollEvents.at(-1)!.message).toContain('1 failed');
  });
});
