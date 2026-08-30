import type { Ask, AskOption } from '@/configure';
import type { Exec } from '@/exec';
import type { RunIndexEntry } from '@/log';

const REVIEW_CONFIG_KEY = 'cue.review.prev';

/** Structural subset of `RunLogger` — avoids a test-only cast to the concrete class. */
export interface RunIndexSource {
  index(): Promise<RunIndexEntry[]>;
}

async function git(exec: Exec, repoPath: string, args: string[]) {
  return exec(['git', '-C', repoPath, ...args]);
}

export async function isDirty(exec: Exec, repoPath: string): Promise<boolean> {
  const r = await git(exec, repoPath, ['status', '--porcelain']);
  if (r.code !== 0) throw new Error(`git status failed: ${r.stderr.trim()}`);
  return r.stdout.trim().length > 0;
}

async function assertClean(exec: Exec, repoPath: string, context: string): Promise<void> {
  if (await isDirty(exec, repoPath)) {
    throw new Error(`working tree is dirty — commit or stash changes ${context}`);
  }
}

/** Null on a detached HEAD — `symbolic-ref` only resolves a branch ref. */
export async function currentBranch(exec: Exec, repoPath: string): Promise<string | null> {
  const r = await git(exec, repoPath, ['symbolic-ref', '--short', '-q', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function reviewPrevBranch(exec: Exec, repoPath: string): Promise<string | null> {
  const r = await git(exec, repoPath, ['config', '--get', REVIEW_CONFIG_KEY]);
  const value = r.stdout.trim();
  return r.code === 0 && value ? value : null;
}

async function setReviewPrev(exec: Exec, repoPath: string, branch: string): Promise<void> {
  const r = await git(exec, repoPath, ['config', REVIEW_CONFIG_KEY, branch]);
  if (r.code !== 0) throw new Error(`git config failed: ${r.stderr.trim()}`);
}

async function unsetReviewPrev(exec: Exec, repoPath: string): Promise<void> {
  const r = await git(exec, repoPath, ['config', '--unset', REVIEW_CONFIG_KEY]);
  if (r.code !== 0) throw new Error(`git config --unset failed: ${r.stderr.trim()}`);
}

async function localBranchExists(exec: Exec, repoPath: string, branch: string): Promise<boolean> {
  const r = await git(exec, repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.code === 0;
}

export interface CheckoutResult {
  branch: string;
  prev: string;
}

/**
 * Enters review mode: detaches HEAD onto the given branch so the main repo
 * can inspect it even though a worktree already owns that branch name. The
 * caller supplies the branch name (`WorktreeManager.branch` is the single
 * source of the `agent/issue-<n>` convention) so it is not re-derived here.
 */
export async function enterReview(
  exec: Exec,
  repoPath: string,
  branch: string,
): Promise<CheckoutResult> {
  await assertClean(exec, repoPath, 'before checkout');
  if (await reviewPrevBranch(exec, repoPath)) {
    throw new Error('already in review mode — run `cue checkout exit` first');
  }
  const prev = await currentBranch(exec, repoPath);
  if (!prev) {
    throw new Error('HEAD is detached — cannot enter review mode from a detached HEAD');
  }
  // Always fetched: a local branch left behind origin (the pipeline pushed
  // from another machine) must never be silently reviewed stale. FETCH_HEAD
  // rather than origin/<branch> because a --single-branch clone's refspec
  // never materializes refs/remotes/origin/<branch> even when the fetch works.
  let ref: string;
  const fetched = await git(exec, repoPath, ['fetch', 'origin', branch]);
  if (fetched.code === 0) {
    ref = 'FETCH_HEAD';
  } else if (await localBranchExists(exec, repoPath, branch)) {
    ref = branch; // offline fallback — the fetch failed but the branch exists locally
  } else {
    throw new Error(`git fetch failed: ${fetched.stderr.trim()}`);
  }
  // Recorded before the checkout so a failed checkout leaves review mode
  // recoverable either way: unset here on failure, or restored by `exit`.
  await setReviewPrev(exec, repoPath, prev);
  const checkedOut = await git(exec, repoPath, ['checkout', '--detach', ref]);
  if (checkedOut.code !== 0) {
    await unsetReviewPrev(exec, repoPath).catch(() => {});
    throw new Error(`git checkout failed: ${checkedOut.stderr.trim()}`);
  }
  return { branch, prev };
}

/** Leaves review mode: restores the branch recorded in git config and clears it. */
export async function exitReview(exec: Exec, repoPath: string): Promise<{ prev: string }> {
  const prev = await reviewPrevBranch(exec, repoPath);
  if (!prev) throw new Error('not in review mode');
  await assertClean(exec, repoPath, 'before exiting review mode');
  const r = await git(exec, repoPath, ['checkout', prev]);
  if (r.code !== 0) {
    throw new Error(
      `git checkout failed: ${r.stderr.trim()} — if "${prev}" no longer exists, run \`git config --unset ${REVIEW_CONFIG_KEY}\` to leave review mode by hand`,
    );
  }
  await unsetReviewPrev(exec, repoPath);
  return { prev };
}

export interface BranchChoice {
  issue: number;
  branch: string;
  title?: string;
}

/** Local `agent/issue-*` branches with titles recovered offline from the run index. */
export async function listIssueBranches(
  exec: Exec,
  repoPath: string,
  logger: RunIndexSource,
): Promise<BranchChoice[]> {
  const r = await git(exec, repoPath, [
    'branch',
    '--list',
    'agent/issue-*',
    '--format=%(refname:short)',
  ]);
  if (r.code !== 0) throw new Error(`git branch failed: ${r.stderr.trim()}`);
  const index = await logger.index();
  const titles = new Map(index.map((e) => [e.issue, e.title]));
  const choices: BranchChoice[] = [];
  for (const branch of r.stdout.split('\n')) {
    const trimmed = branch.trim();
    const m = trimmed.match(/^agent\/issue-(\d+)$/);
    if (!m?.[1]) continue;
    const issue = Number(m[1]);
    choices.push({ issue, branch: trimmed, title: titles.get(issue) });
  }
  return choices.toSorted((a, b) => a.issue - b.issue);
}

export function formatBranchOptions(choices: BranchChoice[]): AskOption[] {
  return choices.map((c) => ({
    value: String(c.issue),
    label: c.title ? `#${c.issue} ${c.title}` : `#${c.issue}`,
  }));
}

/** Precondition: `choices` is non-empty — callers must handle the empty case first. */
export async function pickIssueBranch(choices: BranchChoice[], ask: Ask): Promise<BranchChoice> {
  const options = formatBranchOptions(choices);
  const picked = await ask.select('Select an issue branch to review:', options, options[0]!.value);
  const choice = choices.find((c) => String(c.issue) === picked);
  if (!choice) {
    throw new Error(
      `selection "${picked}" matches no issue branch — expected one of: ${options.map((o) => o.value).join(', ')}`,
    );
  }
  return choice;
}

const CONFIRM_EXIT_OPTIONS: AskOption[] = [
  { value: 'yes', label: 'Yes', hint: 'exit review mode and restore the previous branch' },
  { value: 'no', label: 'No', hint: 'stay in review mode' },
];

export async function confirmExitReviewMode(ask: Ask, prev: string): Promise<boolean> {
  const picked = await ask.select(
    `Already in review mode — restore "${prev}" and exit?`,
    CONFIRM_EXIT_OPTIONS,
    'yes',
  );
  return picked === 'yes';
}

export type CheckoutOutcome =
  | { action: 'entered'; branch: string; prev: string }
  | { action: 'exited'; prev: string }
  | { action: 'no-branches' }
  | { action: 'none' };

/**
 * Drives `cue checkout` with no argument: offers to exit when already in
 * review mode, otherwise lists issue branches for the user to pick.
 */
export async function checkoutInteractive(
  exec: Exec,
  repoPath: string,
  logger: RunIndexSource,
  ask: Ask,
): Promise<CheckoutOutcome> {
  const prev = await reviewPrevBranch(exec, repoPath);
  if (prev) {
    // Checked before prompting so a dirty tree fails fast instead of asking
    // the user to confirm an exit that `exitReview` cannot then perform.
    await assertClean(exec, repoPath, 'before exiting review mode');
    const doExit = await confirmExitReviewMode(ask, prev);
    if (!doExit) return { action: 'none' };
    const r = await exitReview(exec, repoPath);
    return { action: 'exited', prev: r.prev };
  }
  const choices = await listIssueBranches(exec, repoPath, logger);
  if (choices.length === 0) return { action: 'no-branches' };
  // Same fail-fast as the exit path above: a dirty tree fails before the user
  // is asked to pick a branch that enterReview cannot then check out.
  await assertClean(exec, repoPath, 'before checkout');
  const choice = await pickIssueBranch(choices, ask);
  const r = await enterReview(exec, repoPath, choice.branch);
  return { action: 'entered', branch: r.branch, prev: r.prev };
}
