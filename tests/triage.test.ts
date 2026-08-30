import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AdapterError } from '@/adapters/base';
import type { Issue } from '@/github';
import { GitHub } from '@/github';
import { RunLogger } from '@/log';
import type { Notification } from '@/notify';
import { POSIX } from '@/platform';
import type { CueEvent, StageContext } from '@/stages/context';
import { PLAN_MARKER, runTriage } from '@/stages/triage';
import { WorktreeManager } from '@/worktree';

import { makeFakeAdapter } from './helpers/fakeAdapter';
import { makeFakeExec, type ExpectedCall } from './helpers/fakeExec';

const ISSUE: Issue = { number: 7, title: 'Fix login', body: 'It breaks', labels: ['agent:ready'] };

export async function makeCtx(
  ghCalls: ExpectedCall[],
  adapterResponses: string[],
): Promise<{
  ctx: StageContext;
  calls: string[][];
  runs: ReturnType<typeof makeFakeAdapter>['runs'];
  events: CueEvent[];
  notifications: Notification[];
}> {
  const { exec, calls } = makeFakeExec(ghCalls);
  const { adapter, runs } = makeFakeAdapter(adapterResponses);
  const events: CueEvent[] = [];
  const notifications: Notification[] = [];
  const runsDir = await mkdtemp(join(tmpdir(), 'cue-test-'));
  const config = {
    repo: 'acme/widgets',
    repoPath: '/repos/widgets',
    adapter: 'claude' as const,
    models: { triage: 'haiku', dev: 'sonnet', review: 'sonnet' },
    maxTurns: { triage: 15, dev: 60, review: 25 },
    reviewFixIterations: 2,
    gate: { test: 'bun test' },
    worktreeRoot: '/wt',
    baseBranch: 'main',
    staleClaimMinutes: 90,
  };
  const ctx: StageContext = {
    config,
    github: new GitHub(exec, config.repo),
    adapter,
    logger: new RunLogger(runsDir),
    exec,
    platform: POSIX,
    worktrees: new WorktreeManager(exec, config),
    promptsDirs: ['prompts'],
    onEvent: (e) => events.push(e),
    notify: async (n) => {
      notifications.push(n);
    },
  };
  return { ctx, calls, runs, events, notifications };
}

const GOOD_PLAN =
  '## Problem\nx\n## Approach\ny\n## Files likely touched\n- a\n## Acceptance criteria\n- [ ] works\n## Risk\nlow';

describe('runTriage', () => {
  test('claims, plans read-only, comments with marker, labels planned', async () => {
    const { ctx, calls, runs, notifications, events } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:ready'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:planned'] },
      ],
      [GOOD_PLAN],
    );
    await runTriage(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.model).toBe('haiku');
    expect(run.cwd).toBe('/repos/widgets');
    expect(run.access).toBe('read-only');
    expect(run.webSearch).toBeUndefined();
    expect(run.prompt).toContain('Fix login');
    // Issue title and body arrive fenced as data — one pair each. (The
    // tag-plus-newline form is the fence; the preamble mentions the tag inline.)
    expect(run.prompt.match(/<untrusted-data>\n/g)).toHaveLength(2);
    // No specs dir, no learnings file → the knowledge layer stays fully out of the prompt.
    expect(run.prompt).not.toContain('## Spec changes');
    expect(run.prompt).not.toContain('Repo learnings');
    expect(events).toContainEqual(
      expect.objectContaining({ issue: 7, stage: 'triage', kind: 'progress', message: 'working' }),
    );
    const commentCall = calls[1]!;
    expect(commentCall.join(' ')).toContain(PLAN_MARKER);
    expect(notifications).toEqual([
      expect.objectContaining({
        event: 'planned',
        issue: 7,
        title: 'Fix login',
        repo: 'acme/widgets',
        url: 'https://github.com/acme/widgets/issues/7',
      }),
    ]);
  });

  test('injects spec guidance and learnings when the repo keeps them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-triage-specs-'));
    await mkdir(join(root, 'openspec', 'specs'), { recursive: true });
    await Bun.write(join(root, '.cue', 'learnings.md'), '- always update the schema mirror\n');
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      [GOOD_PLAN],
    );
    ctx.config.repoPath = root;
    await runTriage(ctx, ISSUE);
    const prompt = runs[0]!.prompt;
    expect(prompt).toContain('openspec/specs');
    expect(prompt).toContain('## Spec changes');
    expect(prompt).toContain('always update the schema mirror');
  });

  test('a crashed adapter run is still recorded with its partial transcript', async () => {
    const { ctx } = await makeCtx([{ match: ['gh', 'issue', 'edit', '7'] }], []);
    ctx.adapter = {
      run: () => Promise.reject(new AdapterError('agy error: boom', [{ event: 'step_update' }])),
    };
    await expect(runTriage(ctx, ISSUE)).rejects.toThrow('agy error: boom');
    const runs = await ctx.logger.list(7);
    expect(runs).toEqual([
      expect.objectContaining({ stage: 'triage', outcome: 'failed', error: 'agy error: boom' }),
    ]);
    const detail = await ctx.logger.read(7, `triage-${runs[0]!.ts}`);
    expect(detail?.result).toEqual([{ event: 'step_update' }]);
  });

  test('throws when the plan is missing required sections', async () => {
    const { ctx } = await makeCtx(
      [{ match: ['gh', 'issue', 'edit', '7'] }],
      ['I refuse to use the template'],
    );
    await expect(runTriage(ctx, ISSUE)).rejects.toThrow('missing required sections');
  });
});
