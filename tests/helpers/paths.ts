import { join } from 'node:path';

/** Host-native expected worktree path for the "/wt" worktreeRoot used by
 *  makeCtx and worktree tests — WorktreeManager.path() builds with join(),
 *  so on Windows the fakes must expect backslashes too. */
export const wt = (issue: number): string => join('/wt', `issue-${issue}`);
