import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const REJECT_LOW = JSON.stringify({
  approve: false,
  findings: [{ file: 'src/a.ts', line: 3, severity: 'low', note: 'prefer const here' }],
});
const REJECT_MEDIUM = JSON.stringify({
  approve: false,
  findings: [
    { file: 'src/a.ts', line: 3, severity: 'low', note: 'prefer const here' },
    { file: 'src/b.ts', line: 9, severity: 'medium', note: 'unhandled null' },
  ],
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
    expect(runs[0]!.access).toBe('read-only');
    expect(calls.at(-1)!.join(' ')).toContain('approve');
  });

  test('low-only rejection skips the fix loop and leaves the notes to the human', async () => {
    const { ctx, calls, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wt(7), 'diff'], result: { stdout: '+ change' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      [REJECT_LOW],
    );
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(false);
    expect(runs).toHaveLength(1);
    const comment = calls.at(-1)!.join(' ');
    expect(comment).toContain('no blocking findings');
    expect(comment).toContain('prefer const here');
  });

  test('a medium finding still triggers the fix loop', async () => {
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
      [REJECT_MEDIUM, 'handled the null', APPROVE],
    );
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
    expect(runs).toHaveLength(3);
    expect(runs[1]!.prompt).toContain('unhandled null');
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

  test('fix-forcing findings are distilled into .cue/learnings.md and pushed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-review-learn-'));
    const wtDir = join(root, 'issue-7');
    await mkdir(join(wtDir, '.cue', 'specs'), { recursive: true });
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '- first lesson\n');
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v1' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v2' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
      ],
      [REJECT, 'fixed the off-by-one', APPROVE, '- guard array indexing at boundaries'],
    );
    ctx.config.worktreeRoot = root;
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
    // The review prompt carries the spec-consistency note when specs exist.
    expect(runs[0]!.prompt).toContain('## Spec changes');
    // The distiller saw the findings and the already-recorded lessons.
    const distill = runs[3]!;
    expect(distill.prompt).toContain('off by one');
    expect(distill.prompt).toContain('- first lesson');
    expect(distill.access).toBe('read-only');
    const file = await Bun.file(join(wtDir, '.cue', 'learnings.md')).text();
    expect(file).toBe('- first lesson\n- guard array indexing at boundaries\n');
  });

  test('a distiller reply with no durable lesson records nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-review-none-'));
    const wtDir = join(root, 'issue-7');
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '- first lesson\n');
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v1' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v2' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
        // No further git calls: nothing to record, nothing to push.
      ],
      [REJECT, 'fixed it', APPROVE, 'NONE'],
    );
    ctx.config.worktreeRoot = root;
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
    expect(runs).toHaveLength(4);
    const file = await Bun.file(join(wtDir, '.cue', 'learnings.md')).text();
    expect(file).toBe('- first lesson\n');
  });

  test('a distiller crash never fails a finished review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-review-crash-'));
    const wtDir = join(root, 'issue-7');
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '');
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v1' } },
        { match: ['sh', '-c', 'bun test'] },
        { match: ['git', '-C', wtDir, 'add', '-A'] },
        { match: ['git', '-C', wtDir, 'commit', '-m'] },
        { match: ['git', '-C', wtDir, 'push'] },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ v2' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      // The fourth adapter call (distiller) exhausts the fake and throws.
      [REJECT, 'fixed it', APPROVE],
    );
    ctx.config.worktreeRoot = root;
    const verdict = await runReview(ctx, ISSUE);
    expect(verdict.approve).toBe(true);
  });

  test('an approve on the first pass records no learnings even when enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cue-review-clean-'));
    const wtDir = join(root, 'issue-7');
    await Bun.write(join(wtDir, '.cue', 'learnings.md'), '- first lesson\n');
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'view', '7'], result: PLAN_VIEW },
        { match: ['git', '-C', wtDir, 'diff'], result: { stdout: '+ change' } },
        { match: ['gh', 'pr', 'comment', 'agent/issue-7'] },
      ],
      [APPROVE],
    );
    ctx.config.worktreeRoot = root;
    await runReview(ctx, ISSUE);
    expect(runs).toHaveLength(1);
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
