import type { Exec } from "./exec";

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export class GitHub {
  constructor(
    private exec: Exec,
    private repo: string,
  ) {}

  private async gh(args: string[]): Promise<string> {
    const r = await this.exec(["gh", ...args]);
    if (r.code !== 0)
      throw new Error(`gh failed: gh ${args.slice(0, 3).join(" ")}: ${r.stderr.trim()}`);
    return r.stdout;
  }

  async listIssues(label: string, state: "open" | "all" = "open"): Promise<Issue[]> {
    const out = await this.gh([
      "issue",
      "list",
      "--repo",
      this.repo,
      "--label",
      label,
      "--state",
      state,
      "--json",
      "number,title,body,labels",
    ]);
    const raw = JSON.parse(out) as Array<{
      number: number;
      title: string;
      body: string;
      labels: Array<{ name: string }>;
    }>;
    return raw.map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: i.labels.map((l) => l.name),
    }));
  }

  async addLabel(n: number, label: string): Promise<void> {
    await this.gh(["issue", "edit", String(n), "--repo", this.repo, "--add-label", label]);
  }

  async removeLabel(n: number, label: string): Promise<void> {
    await this.gh(["issue", "edit", String(n), "--repo", this.repo, "--remove-label", label]);
  }

  async swapLabel(n: number, remove: string, add: string): Promise<void> {
    await this.gh([
      "issue",
      "edit",
      String(n),
      "--repo",
      this.repo,
      "--remove-label",
      remove,
      "--add-label",
      add,
    ]);
  }

  async comment(n: number, body: string): Promise<void> {
    await this.gh(["issue", "comment", String(n), "--repo", this.repo, "--body", body]);
  }

  async comments(n: number): Promise<Array<{ author: string; body: string }>> {
    const out = await this.gh([
      "issue",
      "view",
      String(n),
      "--repo",
      this.repo,
      "--json",
      "comments",
    ]);
    const { comments } = JSON.parse(out) as {
      comments: Array<{ author?: { login?: string }; body: string }>;
    };
    return comments.map((c) => ({ author: c.author?.login ?? "unknown", body: c.body }));
  }

  async findComment(n: number, marker: string): Promise<string | null> {
    const out = await this.gh([
      "issue",
      "view",
      String(n),
      "--repo",
      this.repo,
      "--json",
      "comments",
    ]);
    const { comments } = JSON.parse(out) as { comments: Array<{ body: string }> };
    const hit = comments.toReversed().find((c) => c.body.includes(marker));
    return hit?.body ?? null;
  }

  async createDraftPR(o: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }): Promise<string> {
    const out = await this.gh([
      "pr",
      "create",
      "--repo",
      this.repo,
      "--draft",
      "--head",
      o.branch,
      "--base",
      o.base,
      "--title",
      o.title,
      "--body",
      o.body,
    ]);
    return out.trim().split("\n").at(-1) ?? "";
  }

  // Tolerant by design: cleanup probes branches that may have no PR at all.
  async prState(branch: string): Promise<"OPEN" | "MERGED" | "CLOSED" | null> {
    const r = await this.exec(["gh", "pr", "view", branch, "--repo", this.repo, "--json", "state"]);
    if (r.code !== 0) return null;
    try {
      return (JSON.parse(r.stdout) as { state: "OPEN" | "MERGED" | "CLOSED" }).state;
    } catch {
      return null;
    }
  }

  async prComment(branch: string, body: string): Promise<void> {
    await this.gh(["pr", "comment", branch, "--repo", this.repo, "--body", body]);
  }
}
