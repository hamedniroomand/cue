import type { Exec } from "./exec";

export interface WorktreeConfig {
  repoPath: string;
  worktreeRoot: string;
  baseBranch: string;
}

export class WorktreeManager {
  constructor(
    private exec: Exec,
    private cfg: WorktreeConfig,
  ) {}

  path(issue: number): string {
    return `${this.cfg.worktreeRoot}/issue-${issue}`;
  }

  branch(issue: number): string {
    return `agent/issue-${issue}`;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const r = await this.exec(["git", "-C", cwd, ...args]);
    if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim()}`);
    return r.stdout;
  }

  private async bootstrapBase(): Promise<void> {
    await this.git(this.cfg.repoPath, ["checkout", "-B", this.cfg.baseBranch]);
    await this.git(this.cfg.repoPath, [
      "commit",
      "--allow-empty",
      "-m",
      "chore: initialize repository (conductor bootstrap)",
    ]);
    await this.git(this.cfg.repoPath, ["push", "-u", "origin", this.cfg.baseBranch]);
  }

  async create(issue: number): Promise<{ path: string; branch: string }> {
    const fetched = await this.exec([
      "git",
      "-C",
      this.cfg.repoPath,
      "fetch",
      "origin",
      this.cfg.baseBranch,
    ]);
    if (fetched.code !== 0) {
      if (!fetched.stderr.includes("couldn't find remote ref"))
        throw new Error(`git fetch failed: ${fetched.stderr.trim()}`);
      await this.bootstrapBase();
      await this.git(this.cfg.repoPath, ["fetch", "origin", this.cfg.baseBranch]);
    }
    const r = await this.exec([
      "git",
      "-C",
      this.cfg.repoPath,
      "worktree",
      "add",
      "-b",
      this.branch(issue),
      this.path(issue),
      `origin/${this.cfg.baseBranch}`,
    ]);
    if (r.code !== 0 && !r.stderr.includes("already exists"))
      throw new Error(`git worktree add failed: ${r.stderr.trim()}`);
    return { path: this.path(issue), branch: this.branch(issue) };
  }

  async commitAll(issue: number, message: string): Promise<boolean> {
    await this.git(this.path(issue), ["add", "-A"]);
    const r = await this.exec(["git", "-C", this.path(issue), "commit", "-m", message]);
    return r.code === 0;
  }

  async push(issue: number): Promise<void> {
    await this.git(this.path(issue), ["push", "-u", "origin", this.branch(issue)]);
  }

  // Tolerant by design: the worktree may live on another developer's machine.
  async remove(issue: number): Promise<void> {
    await this.exec([
      "git",
      "-C",
      this.cfg.repoPath,
      "worktree",
      "remove",
      "--force",
      this.path(issue),
    ]);
    await this.exec(["git", "-C", this.cfg.repoPath, "branch", "-D", this.branch(issue)]);
  }

  async diff(issue: number): Promise<string> {
    return this.git(this.path(issue), ["diff", `origin/${this.cfg.baseBranch}...HEAD`]);
  }
}
