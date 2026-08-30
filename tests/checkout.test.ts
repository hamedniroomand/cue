import { describe, expect, test } from 'bun:test';

import {
  type BranchChoice,
  checkoutInteractive,
  confirmExitReviewMode,
  currentBranch,
  enterReview,
  exitReview,
  formatBranchOptions,
  isDirty,
  issueBranch,
  listIssueBranches,
  pickIssueBranch,
  reviewPrevBranch,
} from '@/checkout';
import type { Ask } from '@/configure';
import { RunLogger } from '@/log';

import { makeFakeExec } from './helpers/fakeExec';

const REPO = '/repos/widgets';

function scriptedAsk(answers: string[]): Ask & { asked: string[] } {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    select(message, _options, initial) {
      asked.push(message);
      const answer = answers[i++];
      return Promise.resolve(answer ?? initial);
    },
    text(message, initial) {
      asked.push(message);
      return Promise.resolve(initial);
    },
  };
}

describe('issueBranch', () => {
  test('formats the agent/issue-<n> branch name', () => {
    expect(issueBranch(7)).toBe('agent/issue-7');
  });
});

describe('isDirty', () => {
  test('false when status is clean', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
    ]);
    expect(await isDirty(exec, REPO)).toBe(false);
  });

  test('true when status has output', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: ' M file.ts\n' } },
    ]);
    expect(await isDirty(exec, REPO)).toBe(true);
  });

  test('throws when git status fails', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'status', '--porcelain'],
        result: { code: 128, stderr: 'fatal: not a git repository' },
      },
    ]);
    await expect(isDirty(exec, REPO)).rejects.toThrow('not a git repository');
  });
});

describe('currentBranch', () => {
  test('returns the branch name when on a branch', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
    ]);
    expect(await currentBranch(exec, REPO)).toBe('main');
  });

  test('returns null on a detached HEAD', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { code: 1, stderr: 'fatal: ref HEAD is not a symbolic ref' },
      },
    ]);
    expect(await currentBranch(exec, REPO)).toBeNull();
  });
});

describe('reviewPrevBranch', () => {
  test('returns the stored branch when set', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
    ]);
    expect(await reviewPrevBranch(exec, REPO)).toBe('main');
  });

  test('returns null when unset', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
    ]);
    expect(await reviewPrevBranch(exec, REPO)).toBeNull();
  });
});

describe('enterReview', () => {
  test('detaches onto a local branch and records the previous branch', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/issue-7'],
      },
      { match: ['git', '-C', REPO, 'checkout', '--detach', 'agent/issue-7'] },
      { match: ['git', '-C', REPO, 'config', 'cue.review.prev', 'main'] },
    ]);
    const result = await enterReview(exec, REPO, 7);
    expect(result).toEqual({ branch: 'agent/issue-7', prev: 'main' });
    expect(calls).toHaveLength(6);
  });

  test('fetches and detaches onto origin when the local branch is missing', async () => {
    const { exec, calls } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/issue-7'],
        result: { code: 1 },
      },
      { match: ['git', '-C', REPO, 'fetch', 'origin', 'agent/issue-7'] },
      { match: ['git', '-C', REPO, 'checkout', '--detach', 'origin/agent/issue-7'] },
      { match: ['git', '-C', REPO, 'config', 'cue.review.prev', 'main'] },
    ]);
    const result = await enterReview(exec, REPO, 7);
    expect(result).toEqual({ branch: 'agent/issue-7', prev: 'main' });
    expect(calls).toHaveLength(7);
  });

  test('refuses a dirty working tree', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: ' M file.ts' } },
    ]);
    await expect(enterReview(exec, REPO, 7)).rejects.toThrow('dirty');
  });

  test('refuses when already in review mode', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
    ]);
    await expect(enterReview(exec, REPO, 7)).rejects.toThrow('already in review mode');
  });

  test('refuses a detached HEAD', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { code: 1, stderr: 'fatal: ref HEAD is not a symbolic ref' },
      },
    ]);
    await expect(enterReview(exec, REPO, 7)).rejects.toThrow('detached');
  });

  test('surfaces a checkout failure', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/issue-7'],
      },
      {
        match: ['git', '-C', REPO, 'checkout', '--detach', 'agent/issue-7'],
        result: { code: 1, stderr: 'error: pathspec did not match' },
      },
    ]);
    await expect(enterReview(exec, REPO, 7)).rejects.toThrow('pathspec did not match');
  });

  test('surfaces a failed fetch when the branch is missing everywhere', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/issue-7'],
        result: { code: 1 },
      },
      {
        match: ['git', '-C', REPO, 'fetch', 'origin', 'agent/issue-7'],
        result: { code: 128, stderr: "fatal: couldn't find remote ref agent/issue-7" },
      },
    ]);
    await expect(enterReview(exec, REPO, 7)).rejects.toThrow("couldn't find remote ref");
  });
});

describe('exitReview', () => {
  test('restores the previous branch and unsets the config key', async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'checkout', 'main'] },
      { match: ['git', '-C', REPO, 'config', '--unset', 'cue.review.prev'] },
    ]);
    const result = await exitReview(exec, REPO);
    expect(result).toEqual({ prev: 'main' });
    expect(calls).toHaveLength(4);
  });

  test('refuses when not in review mode', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
    ]);
    await expect(exitReview(exec, REPO)).rejects.toThrow('not in review mode');
  });

  test('refuses a dirty working tree', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: ' M file.ts' } },
    ]);
    await expect(exitReview(exec, REPO)).rejects.toThrow('dirty');
  });

  test('surfaces a checkout failure', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      {
        match: ['git', '-C', REPO, 'checkout', 'main'],
        result: { code: 1, stderr: 'error: pathspec did not match' },
      },
    ]);
    await expect(exitReview(exec, REPO)).rejects.toThrow('pathspec did not match');
  });
});

describe('listIssueBranches', () => {
  test('lists branches with titles recovered from the run index', async () => {
    const { exec } = makeFakeExec([
      {
        match: [
          'git',
          '-C',
          REPO,
          'branch',
          '--list',
          'agent/issue-*',
          '--format=%(refname:short)',
        ],
        result: { stdout: 'agent/issue-7\nagent/issue-12\n' },
      },
    ]);
    const logger = {
      index: () =>
        Promise.resolve([
          { issue: 7, runs: 1, costUsd: 0, tokens: 0, lastTs: 1, title: 'Add widgets' },
          { issue: 12, runs: 1, costUsd: 0, tokens: 0, lastTs: 2 },
        ]),
    } as unknown as RunLogger;
    const choices = await listIssueBranches(exec, REPO, logger);
    expect(choices).toEqual([
      { issue: 7, branch: 'agent/issue-7', title: 'Add widgets' },
      { issue: 12, branch: 'agent/issue-12', title: undefined },
    ]);
  });

  test('returns an empty list when there are no matching branches', async () => {
    const { exec } = makeFakeExec([
      {
        match: [
          'git',
          '-C',
          REPO,
          'branch',
          '--list',
          'agent/issue-*',
          '--format=%(refname:short)',
        ],
        result: { stdout: '' },
      },
    ]);
    const logger = { index: () => Promise.resolve([]) } as unknown as RunLogger;
    expect(await listIssueBranches(exec, REPO, logger)).toEqual([]);
  });
});

describe('formatBranchOptions', () => {
  test('labels with the title when known', () => {
    const choices: BranchChoice[] = [{ issue: 7, branch: 'agent/issue-7', title: 'Add widgets' }];
    expect(formatBranchOptions(choices)).toEqual([{ value: '7', label: '#7 Add widgets' }]);
  });

  test('falls back to the issue number alone when no title is known', () => {
    const choices: BranchChoice[] = [{ issue: 12, branch: 'agent/issue-12' }];
    expect(formatBranchOptions(choices)).toEqual([{ value: '12', label: '#12' }]);
  });
});

describe('pickIssueBranch', () => {
  test('returns undefined when there are no choices', async () => {
    const ask = scriptedAsk([]);
    expect(await pickIssueBranch([], ask)).toBeUndefined();
    expect(ask.asked).toHaveLength(0);
  });

  test('returns the picked issue number', async () => {
    const choices: BranchChoice[] = [
      { issue: 7, branch: 'agent/issue-7', title: 'Add widgets' },
      { issue: 12, branch: 'agent/issue-12' },
    ];
    const ask = scriptedAsk(['12']);
    expect(await pickIssueBranch(choices, ask)).toBe(12);
  });
});

describe('confirmExitReviewMode', () => {
  test('defaults to yes and returns true when accepted', async () => {
    const ask = scriptedAsk([]);
    expect(await confirmExitReviewMode(ask, 'main')).toBe(true);
    expect(ask.asked[0]).toContain('main');
  });

  test('returns false when the user declines', async () => {
    const ask = scriptedAsk(['no']);
    expect(await confirmExitReviewMode(ask, 'main')).toBe(false);
  });
});

describe('checkoutInteractive', () => {
  test('offers to exit when already in review mode and the user accepts', async () => {
    const { exec } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'checkout', 'main'] },
      { match: ['git', '-C', REPO, 'config', '--unset', 'cue.review.prev'] },
    ]);
    const logger = { index: () => Promise.resolve([]) } as unknown as RunLogger;
    const ask = scriptedAsk(['yes']);
    const result = await checkoutInteractive(exec, REPO, logger, ask);
    expect(result).toEqual({ action: 'exited', prev: 'main' });
  });

  test('does nothing when already in review mode and the user declines to exit', async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'],
        result: { stdout: 'main\n' },
      },
    ]);
    const logger = { index: () => Promise.resolve([]) } as unknown as RunLogger;
    const ask = scriptedAsk(['no']);
    const result = await checkoutInteractive(exec, REPO, logger, ask);
    expect(result).toEqual({ action: 'none' });
    expect(calls).toHaveLength(1);
  });

  test('reports no branches when none are found', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: [
          'git',
          '-C',
          REPO,
          'branch',
          '--list',
          'agent/issue-*',
          '--format=%(refname:short)',
        ],
        result: { stdout: '' },
      },
    ]);
    const logger = { index: () => Promise.resolve([]) } as unknown as RunLogger;
    const ask = scriptedAsk([]);
    const result = await checkoutInteractive(exec, REPO, logger, ask);
    expect(result).toEqual({ action: 'no-branches' });
  });

  test('picks a branch and enters review mode', async () => {
    const { exec } = makeFakeExec([
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: [
          'git',
          '-C',
          REPO,
          'branch',
          '--list',
          'agent/issue-*',
          '--format=%(refname:short)',
        ],
        result: { stdout: 'agent/issue-7\n' },
      },
      { match: ['git', '-C', REPO, 'status', '--porcelain'], result: { stdout: '' } },
      { match: ['git', '-C', REPO, 'config', '--get', 'cue.review.prev'], result: { code: 1 } },
      {
        match: ['git', '-C', REPO, 'symbolic-ref', '--short', '-q', 'HEAD'],
        result: { stdout: 'main\n' },
      },
      {
        match: ['git', '-C', REPO, 'rev-parse', '--verify', '--quiet', 'refs/heads/agent/issue-7'],
      },
      { match: ['git', '-C', REPO, 'checkout', '--detach', 'agent/issue-7'] },
      { match: ['git', '-C', REPO, 'config', 'cue.review.prev', 'main'] },
    ]);
    const logger = {
      index: () => Promise.resolve([{ issue: 7, runs: 1, costUsd: 0, tokens: 0, lastTs: 1 }]),
    } as unknown as RunLogger;
    const ask = scriptedAsk(['7']);
    const result = await checkoutInteractive(exec, REPO, logger, ask);
    expect(result).toEqual({ action: 'entered', branch: 'agent/issue-7', prev: 'main' });
  });
});
