import { describe, expect, test } from 'bun:test';

import type { Issue } from '@/github';
import { parseVerdict, runReview } from '@/stages/review';

import { wt } from './helpers/paths';
import { makeCtx } from './triage.test';

const ISSUE: Issue = { number: 7, title: 'Fix login', body: 'b', labels: ['agent:in-review'] };
const PLAN_VIEW = {
  stdout: JSON.stringify({ comments: [{ body: '<!-- cue:plan -->\nplan' }] }),
};
const APPROVE = JSON.stringify({ approve: true, findings: [] });
const REJECT = JSON.stringify({
  approve: false,
  findings: [{ file: 'src/a.ts', line: 3, severity: 'high', note: 'off by one' }],
});

describe('parseVerdict', () => {
  test('parses a verdict wrapped in prose', () => {
    const v = parseVerdict(`Sure! Here you go:\n${REJECT}\nHope that helps.`);
    expect(v?.approve).toBe(false);
    expect(v?.findings[0]?.severity).toBe('high');
  });

  test('returns null for garbage', () => {
    expect(parseVerdict('no json here')).toBeNull();
    expect(parseVerdict('{"approve": "yes"}')).toBeNull();
  });
});

describe('runReview', () => {
  test('approves on first pass and comments on the PR', async () => {
    const { ctx, calls, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ change' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      [APPROVE],
    );
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
    expect(runs[0]!.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
    expect(calls.at(-1)!.join(' ')).toContain('approve');
  });

  test('reject → fix → gate → re-review → approve', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v1' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v2' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      [REJECT, 'fixed the off-by-one', APPROVE],
    );
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
    expect(runs).toHaveLength(3);
    expect(runs[1]!.prompt).toContain('off by one');
  });

  test('iteration cap: still-rejected verdict is returned, not looped forever', async () => {
    const ghCalls = [
      { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
      { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v1' } },
      { match: ['sh', '-c', 'bun test'] },
      { match: ['git', '-C', wt(7), 'add', '-A'] },
      { match: ['git', '-C', wt(7), 'commit', '-m'] },
      { match: ['git', '-C', wt(7), 'push'] },
      { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v2' } },
      { match: ['sh', '-c', 'bun test'] },
      { match: ['git', '-C', wt(7), 'add', '-A'] },
      { match: ['git', '-C', wt(7), 'commit', '-m'] },
      { match: ['git', '-C', wt(7), 'push'] },
      { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v3' } },
      { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
    ];
    const { ctx, runs } = await makeCtx(ghCalls, [REJECT, 'fix1', REJECT, 'fix2', REJECT]);
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(false);
    expect(runs).toHaveLength(5);
  });

  test('unparseable verdict retries once with a JSON nudge, then throws', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ v1' } },
      ],
      ['not json', 'still not json'],
    );
    await expect(runReview(ctx, ISSUE)).rejects.toThrow('unparseable verdict');
    expect(runs[1]!.prompt).toContain('Respond with only the JSON object.');
  });
});
