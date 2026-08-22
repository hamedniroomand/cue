import { describe, expect, test } from 'bun:test';

import type { Issue } from '@/github';
import { runReplan } from '@/stages/replan';

import { makeCtx } from './triage.test';

const ISSUE: Issue = {
  number: 7,
  title: 'Simple Bun Server',
  body: 'make a server',
  labels: ['agent:planned', 'agent:replan'],
};

const GOOD_PLAN =
  '## Problem\nx\n## Approach\nbetter\n## Files likely touched\n- a\n## Acceptance criteria\n- [ ] works\n## Risk\nlow\n## Revision notes\nswitched approach';

function commentsPayload() {
  return {
    stdout: JSON.stringify({
      comments: [
        {
          author: { login: 'cue-bot' },
          body: '<!-- cue:plan -->\nold plan: use express',
        },
        { author: { login: 'hamed' }, body: 'find a better solution, no heavy frameworks' },
        { author: { login: 'cue-bot' }, body: '⚠️ cue dev failed: whatever' },
      ],
    }),
  };
}

describe('runReplan', () => {
  test('revises using previous plan + human feedback, excluding cue noise', async () => {
    const { ctx, calls, runs, notifications } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:replan'] },
        { match: ['gh', 'issue', 'view', '7'], result: commentsPayload() },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--add-label', 'agent:planned'] },
      ],
      [GOOD_PLAN],
    );
    await runReplan(ctx, ISSUE);
    const run = runs[0]!;
    expect(run.prompt).toContain('old plan: use express');
    expect(run.prompt).toContain('find a better solution, no heavy frameworks');
    expect(run.prompt).not.toContain('dev failed');
    expect(run.access).toBe('read-only');
    expect(run.webSearch).toBe(true);
    expect(run.model).toBe('haiku');
    expect(calls[2]!.join(' ')).toContain('<!-- cue:plan -->');
    expect(notifications).toEqual([expect.objectContaining({ event: 'planned', issue: 7 })]);
  });

  test('throws when there is no previous plan to revise', async () => {
    const { ctx } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
      ],
      [],
    );
    await expect(runReplan(ctx, ISSUE)).rejects.toThrow('no plan comment');
  });

  test('replans even with no feedback comments (label alone is the signal)', async () => {
    const { ctx, runs } = await makeCtx(
      [
        { match: ['gh', 'issue', 'edit', '7'] },
        {
          match: ['gh', 'issue', 'view', '7'],
          result: {
            stdout: JSON.stringify({
              comments: [{ author: { login: 'bot' }, body: '<!-- cue:plan -->\nold' }],
            }),
          },
        },
        { match: ['gh', 'issue', 'comment', '7'] },
        { match: ['gh', 'issue', 'edit', '7'] },
      ],
      [GOOD_PLAN],
    );
    await runReplan(ctx, ISSUE);
    expect(runs[0]!.prompt).toContain('no explicit feedback');
  });
});
