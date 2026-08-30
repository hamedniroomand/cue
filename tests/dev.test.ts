import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Issue } from '@/github';
import { runDev } from '@/stages/dev';

import { wt } from './helpers/paths';
import { makeCtx } from './triage.test';

const ISSUE: Issue = {
  number: 7,
  title: 'Fix login',
  body: 'It breaks',
  labels: ['agent:approved'],
};
const PLAN_COMMENT = '<!-- cue:plan -->\n## Approach\ndo it\n## Acceptance criteria\n- [ ] works';

function planViewResult() {
  return { stdout: JSON.stringify({ comments: [{ body: PLAN_COMMENT }] }) };
}

describe('runDev', () => {
  test('happy path: claim, implement, gate, commit, push, draft PR, in-review', async () => {
    const { ctx, calls, runs, notifications } = await makeCtx(
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
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push', '-u', 'origin', 'agent/issue-7'] },
        {
          match: ['gh', 'pr', 'create'],
          result: { stdout: 'https://github.com/acme/widgets/pull/9' },
        },
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
      ],
      ['implemented the feature'],
    );
    await runDev(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.cwd).toBe(wt(7));
    expect(run.model).toBe('sonnet');
    expect(run.access).toBe('write');
    expect(run.bashAllowlist).toBeUndefined(); // default: shell unrestricted
    expect(run.prompt).toContain('## Approach');
    expect(calls.some((c) => c.includes('--draft'))).toBe(true);
    expect(notifications).toEqual([
      expect.objectContaining({
        event: 'pr-opened',
        issue: 7,
        title: 'Fix login',
        repo: 'acme/widgets',
        url: 'https://github.com/acme/widgets/pull/9',
      }),
    ]);
  });

  test('injects spec guidance and learnings found in the worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-dev-specs-'));
    const wtDir = join(root, 'issue-7');
    await mkdir(join(wtDir, '.cue', 'specs'), { recursive: true });
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '- never weaken tests to get green\n');
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
        { match: ['gh', 'pr', 'create'], result: { stdout: 'pr url' } },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['implemented the feature'],
    );
    ctx.config.worktreeRoot = root;
    await runDev(ctx, ISSUE);
    const prompt = runs[0]!.prompt;
    expect(prompt).toContain('.cue/specs');
    expect(prompt).toContain('## Spec changes');
    expect(prompt).toContain('never weaken tests to get green');
  });

  test('forwards the configured devBashAllowlist to the adapter', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push', '-u', 'origin', 'agent/issue-7'] },
        { match: ['gh', 'pr', 'create'], result: { stdout: 'pr url' } },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['implemented the feature'],
    );
    ctx.config.devBashAllowlist = ['bun *', 'git status'];
    await runDev(ctx, ISSUE);
    expect(runs[0]!.bashAllowlist).toEqual(['bun *', 'git status']);
  });

  test('runs the configured setup command in the fresh worktree before the agent', async () => {
    const { ctx, runs, events } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        // The strict call order proves setup runs after the worktree exists
        // and before the gate.
        { match: ['sh', '-c', 'bun install --frozen-lockfile'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        { match: ['gh', 'pr', 'create'], result: { stdout: 'url' } },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['implemented the feature'],
    );
    ctx.config.setup = 'bun install --frozen-lockfile';
    await runDev(ctx, ISSUE);
    expect(runs).toHaveLength(1);
    // An install can take minutes — the CLI must show why cue looks idle.
    expect(events).toContainEqual(
      expect.objectContaining({
        stage: 'dev',
        kind: 'progress',
        message: expect.stringContaining('bun install --frozen-lockfile'),
      }),
    );
  });

  test('a failing setup throws before the agent runs', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        {
          match: ['sh', '-c', 'bun install'],
          result: { code: 1, stderr: 'registry unreachable' },
        },
      ],
      [],
    );
    ctx.config.setup = 'bun install';
    await expect(runDev(ctx, ISSUE)).rejects.toThrow('registry unreachable');
    expect(runs).toHaveLength(0);
  });

  test('a rejected push runs the fix agent, re-gates, and pushes again', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        {
          match: ['git', '-C', wt(7), 'push'],
          result: { code: 1, stderr: 'pre-push hook: tsc not found' },
        },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        // An environment-only repair (e.g. installing deps) commits nothing —
        // the retry must still push.
        {
          match: ['git', '-C', wt(7), 'commit', '-m'],
          result: { code: 1, stdout: 'nothing to commit' },
        },
        { match: ['git', '-C', wt(7), 'push'] },
        { match: ['gh', 'pr', 'create'], result: { stdout: 'url' } },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['implemented', 'installed the missing deps'],
    );
    await runDev(ctx, ISSUE);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.prompt).toContain('tsc not found');
  });

  test('a push still rejected after repair fails the stage', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
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
        {
          match: ['git', '-C', wt(7), 'push'],
          result: { code: 1, stderr: 'pre-push hook declined again' },
        },
      ],
      ['implemented', 'tried to fix the hook'],
    );
    // "declined again" proves the failure came from the retry, not the first push.
    await expect(runDev(ctx, ISSUE)).rejects.toThrow('pre-push hook declined again');
    expect(runs).toHaveLength(2);
  });

  test('gate failure triggers one fix run, then succeeds', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: '2 tests failed' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wt(7), 'add', '-A'] },
        { match: ['git', '-C', wt(7), 'commit', '-m'] },
        { match: ['git', '-C', wt(7), 'push'] },
        { match: ['gh', 'pr', 'create'], result: { stdout: 'url' } },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      ['implemented', 'fixed the tests'],
    );
    await runDev(ctx, ISSUE);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.prompt).toContain('2 tests failed');
  });

  test('gate failure after fix throws', async () => {
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: planViewResult() },
        { match: ['git', '-C', '/repos/widgets', 'fetch'] },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'add'] },
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: 'fail' } },
        { match: ['sh', '-c', 'bun test'], result: { code: 1, stderr: 'still failing' } },
      ],
      ['implemented', 'tried to fix'],
    );
    await expect(runDev(ctx, ISSUE)).rejects.toThrow('gate failed');
  });

  test('missing plan comment throws before any worktree work', async () => {
    const { ctx, calls } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
      ],
      [],
    );
    await expect(runDev(ctx, ISSUE)).rejects.toThrow('no plan comment found');
    expect(calls.some((c) => c.includes('worktree'))).toBe(false);
  });
});
