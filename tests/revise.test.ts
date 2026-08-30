import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Issue } from '@/github';
import { runRevise } from '@/stages/revise';

import { wt } from './helpers/paths';
import { makeCtx } from './triage.test';

const ISSUE: Issue = {
  number: 7,
  title: 'Fix login',
  body: 'It breaks',
  labels: ['agent:in-review', 'agent:revise'],
};
const PLAN_VIEW = {
  stdout: JSON.stringify({ comments: [{ body: '<!-- cue:plan -->\n## Approach\ndo it' }] }),
};

function prViewResult(overrides?: { comments?: unknown[]; reviews?: unknown[] }) {
  return {
    stdout: JSON.stringify({
      number: 9,
      comments: overrides?.comments ?? [
        { author: { login: 'hamed' }, body: 'also rename the flag' },
        { author: { login: 'hamed' }, body: '✅ cue review: approve\n\nNo findings.' },
      ],
      reviews: overrides?.reviews ?? [
        { author: { login: 'hamed' }, body: 'needs a null guard', state: 'CHANGES_REQUESTED' },
      ],
    }),
  };
}

const INLINE = {
  stdout: JSON.stringify({ author: 'hamed', body: 'off by one', path: 'src/a.ts', line: 12 }),
};

const CLAIM = {
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
};
const RELEASE = {
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
};
const ENSURE = [
  { match: ['git', '-C', '/repos/widgets', 'fetch', 'origin', 'agent/issue-7'] },
  { match: ['git', '-C', wt(7), 'rev-parse', '--git-dir'] },
  { match: ['git', '-C', wt(7), 'merge', '--ff-only', 'origin/agent/issue-7'] },
];

describe('runRevise', () => {
  test('claims, feeds PR feedback to the agent, gates, pushes, back to in-review', async () => {
    const { ctx, runs, notifications } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: INLINE },
        ...ENSURE,
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push', '-u', 'origin', 'agent/issue-7'] },
        RELEASE,
      ],
      ['addressed the feedback'],
    );
    await runRevise(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.cwd).toBe(wt(7));
    expect(run.model).toBe('sonnet');
    expect(run.access).toBe('write');
    expect(run.prompt).toContain('## Approach');
    expect(run.prompt).toContain('needs a null guard');
    expect(run.prompt).toContain('also rename the flag');
    expect(run.prompt).toContain('src/a.ts:12');
    // Cue's own verdict comments are not human feedback.
    expect(run.prompt).not.toContain('cue review:');
    expect(notifications).toEqual([
      expect.objectContaining({
        event: 'revised',
        issue: 7,
        repo: 'acme/widgets',
        url: 'https://github.com/acme/widgets/pull/9',
      }),
    ]);
  });

  test('injects spec guidance and learnings found in the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-revise-specs-'));
    const wtDir = join(root, 'issue-7');
    await mkdir(join(wtDir, 'openspec', 'specs'), { recursive: true });
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '- keep gh out of agent env\n');
    const { ctx, runs } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        { match: ['git', '-C', '/repos/widgets', 'fetch', 'origin', 'agent/issue-7'] },
        { match: ['git', '-C', wtDir, 'rev-parse', '--git-dir'] },
        { match: ['git', '-C', wtDir, 'merge', '--ff-only'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
        RELEASE,
      ],
      ['addressed the feedback'],
    );
    ctx.config.worktreeRoot = root;
    await runRevise(ctx, ISSUE);
    const prompt = runs[0]!.prompt;
    expect(prompt).toContain('openspec/specs');
    expect(prompt).toContain('keep gh out of agent env');
  });

  test('no code changes: skips the push, tells the PR, still returns to in-review', async () => {
    const { ctx, calls, runs } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        {
          match: ['gh', 'pr', 'view', 'agent/issue-7'],
          result: prViewResult({ comments: [], reviews: [] }),
        },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        ...ENSURE,
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        {
          match: ['git', '-C', wt(7), 'commit', '-m'],
          result: { code: 1, stdout: 'nothing to commit' },
        },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
        RELEASE,
      ],
      ['everything was already addressed'],
    );
    await runRevise(ctx, ISSUE);
    expect(runs[0]!.prompt).toContain('(no PR feedback found');
    const prComment = calls.find((c) => c[1] === 'pr' && c[2] === 'comment')!;
    expect(prComment.join(' ')).toContain('no code changes');
    expect(calls.some((c) => c.includes('push'))).toBe(false);
  });

  test('gate failure triggers one fix run, then succeeds', async () => {
    const { ctx, runs } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        ...ENSURE,
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: '2 tests failed' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        RELEASE,
      ],
      ['revised', 'fixed the tests'],
    );
    await runRevise(ctx, ISSUE);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.prompt).toContain('2 tests failed');
  });

  test('runs the configured setup command in the re-attached worktree', async () => {
    const { ctx, runs, events } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        ...ENSURE,
        { match: ['sh', '-c', 'bun install'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        RELEASE,
      ],
      ['addressed the feedback'],
    );
    ctx.config.setup = 'bun install';
    await runRevise(ctx, ISSUE);
    expect(runs).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        stage: 'revise',
        kind: 'progress',
        message: expect.stringContaining('bun install'),
      }),
    );
  });

  test('a rejected push runs the fix agent and pushes again', async () => {
    const { ctx, runs } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        ...ENSURE,
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        {
          match: ['git', '-C', wt(7), 'push'],
          result: { code: 1, stderr: 'pre-push hook declined' },
        },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        RELEASE,
      ],
      ['revised', 'fixed the hook failure'],
    );
    await runRevise(ctx, ISSUE);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.prompt).toContain('pre-push hook declined');
  });

  test('gate failure after fix throws', async () => {
    const { ctx } = await makeCtx(
      [
        CLAIM,
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['gh', 'pr', 'view', 'agent/issue-7'], result: prViewResult() },
        { match: ['gh', 'api', 'repos/acme/widgets/pulls/9/comments'], result: { stdout: '' } },
        ...ENSURE,
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: 'fail' } },
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: 'still failing' } },
      ],
      ['revised', 'tried to fix'],
    );
    await expect(runRevise(ctx, ISSUE)).rejects.toThrow('gate failed');
  });
});
