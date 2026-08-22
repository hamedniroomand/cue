import { describe, expect, test } from "bun:test";
import { WorktreeManager } from "../src/worktree";
import { makeFakeExec } from "./helpers/fakeExec";
import { wt as wtPath } from "./helpers/paths";

const CFG = { repoPath: "/repos/widgets", worktreeRoot: "/wt", baseBranch: "main" };

describe("WorktreeManager", () => {
  test("create fetches base and adds a worktree on a new branch", async () => {
    const { exec, calls } = makeFakeExec([
      { match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"] },
      {
        match: [
          "git",
          "-C",
          "/repos/widgets",
          "worktree",
          "add",
          "-b",
          "agent/issue-7",
          wtPath(7),
          "origin/main",
        ],
      },
    ]);
    const wt = await new WorktreeManager(exec, CFG).create(7);
    expect(wt).toEqual({ path: wtPath(7), branch: "agent/issue-7" });
    expect(calls).toHaveLength(2);
  });

  test("create tolerates an already-existing worktree", async () => {
    const { exec } = makeFakeExec([
      { match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"] },
      {
        match: ["git", "*", "*", "worktree", "add"],
        result: { code: 128, stderr: "fatal: 'agent/issue-7' already exists" },
      },
    ]);
    const wt = await new WorktreeManager(exec, CFG).create(7);
    expect(wt.path).toBe(wtPath(7));
  });

  test("create bootstraps an empty initial commit when the remote base branch is missing", async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"],
        result: { code: 128, stderr: "fatal: couldn't find remote ref main" },
      },
      { match: ["git", "-C", "/repos/widgets", "checkout", "-B", "main"] },
      { match: ["git", "-C", "/repos/widgets", "commit", "--allow-empty", "-m"] },
      { match: ["git", "-C", "/repos/widgets", "push", "-u", "origin", "main"] },
      { match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"] },
      {
        match: [
          "git",
          "-C",
          "/repos/widgets",
          "worktree",
          "add",
          "-b",
          "agent/issue-7",
          wtPath(7),
          "origin/main",
        ],
      },
    ]);
    const wt = await new WorktreeManager(exec, CFG).create(7);
    expect(wt.branch).toBe("agent/issue-7");
    expect(calls).toHaveLength(6);
  });

  test("create surfaces non-missing-ref fetch failures without bootstrapping", async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"],
        result: { code: 128, stderr: "fatal: Could not read from remote repository" },
      },
    ]);
    await expect(new WorktreeManager(exec, CFG).create(7)).rejects.toThrow(
      "Could not read from remote repository",
    );
    expect(calls).toHaveLength(1);
  });

  test("create throws on other git failures", async () => {
    const { exec } = makeFakeExec([
      { match: ["git", "-C", "/repos/widgets", "fetch", "origin", "main"] },
      {
        match: ["git", "*", "*", "worktree", "add"],
        result: { code: 128, stderr: "fatal: not a git repository" },
      },
    ]);
    await expect(new WorktreeManager(exec, CFG).create(7)).rejects.toThrow("not a git repository");
  });

  test("commitAll returns false when there is nothing to commit", async () => {
    const { exec } = makeFakeExec([
      { match: ["git", "-C", wtPath(7), "add", "-A"] },
      {
        match: ["git", "-C", wtPath(7), "commit", "-m"],
        result: { code: 1, stdout: "nothing to commit" },
      },
    ]);
    expect(await new WorktreeManager(exec, CFG).commitAll(7, "feat: x")).toBe(false);
  });

  test("diff returns the three-dot diff against origin base", async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ["git", "-C", wtPath(7), "diff", "origin/main...HEAD"],
        result: { stdout: "+ new line" },
      },
    ]);
    expect(await new WorktreeManager(exec, CFG).diff(7)).toBe("+ new line");
    expect(calls[0]![4]).toBe("origin/main...HEAD");
  });
});
