import type { Exec } from '@/exec';

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
    const r = await this.exec(['gh', ...args]);
    if (r.code !== 0)
      throw new Error(`gh failed: gh ${args.slice(0, 3).join(' ')}: ${r.stderr.trim()}`);
    return r.stdout;
  }

  /**
   * List several labels at once, CHUNK at a time. Full fan-out would be
   * fastest, but `gh` calls land on GitHub's secondary rate limiter, which
   * dislikes concurrent bursts — three at a time keeps the dashboard's
   * seven-label board snappy without tripping it.
   */
  async listIssuesByLabel(
    labels: string[],
    state: 'open' | 'all' = 'open',
  ): Promise<Map<string, Issue[]>> {
    const CHUNK = 2;
    const result = new Map<string, Issue[]>();
    for (let i = 0; i < labels.length; i += CHUNK) {
      const chunk = labels.slice(i, i + CHUNK);
      const lists = await Promise.all(chunk.map((label) => this.listIssues(label, state)));
      chunk.forEach((label, j) => result.set(label, lists[j]!));
    }
    return result;
  }

  async listIssues(label: string, state: 'open' | 'all' = 'open'): Promise<Issue[]> {
    const out = await this.gh([
      'issue',
      'list',
      '--repo',
      this.repo,
      '--label',
      label,
      '--state',
      state,
      '--json',
      'number,title,body,labels',
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
      body: i.body ?? '',
      labels: i.labels.map((l) => l.name),
    }));
  }

  async addLabel(n: number, label: string): Promise<void> {
    await this.gh(['issue', 'edit', String(n), '--repo', this.repo, '--add-label', label]);
  }

  async removeLabel(n: number, label: string): Promise<void> {
    await this.gh(['issue', 'edit', String(n), '--repo', this.repo, '--remove-label', label]);
  }

  async swapLabel(n: number, remove: string, add: string): Promise<void> {
    await this.gh([
      'issue',
      'edit',
      String(n),
      '--repo',
      this.repo,
      '--remove-label',
      remove,
      '--add-label',
      add,
    ]);
  }

  async comment(n: number, body: string): Promise<void> {
    await this.gh(['issue', 'comment', String(n), '--repo', this.repo, '--body', body]);
  }

  async comments(n: number): Promise<Array<{ author: string; body: string }>> {
    const out = await this.gh([
      'issue',
      'view',
      String(n),
      '--repo',
      this.repo,
      '--json',
      'comments',
    ]);
    const { comments } = JSON.parse(out) as {
      comments: Array<{ author?: { login?: string }; body: string }>;
    };
    return comments.map((c) => ({ author: c.author?.login ?? 'unknown', body: c.body }));
  }

  async findComment(n: number, marker: string): Promise<string | null> {
    const out = await this.gh([
      'issue',
      'view',
      String(n),
      '--repo',
      this.repo,
      '--json',
      'comments',
    ]);
    const { comments } = JSON.parse(out) as { comments: Array<{ body: string }> };
    const hit = comments.toReversed().find((c) => c.body.includes(marker));
    return hit?.body ?? null;
  }

  /**
   * When the label was last added to the issue, as epoch ms. Read from the
   * timeline API so the claim's age is visible to every machine, not just the
   * one that made it. Tolerant by design: cleanup probes claims it may not be
   * able to explain, and null means "cannot tell", never "stale".
   */
  async labelAddedAt(n: number, label: string): Promise<number | null> {
    const r = await this.exec([
      'gh',
      'api',
      `repos/${this.repo}/issues/${n}/timeline`,
      '--paginate',
      '--jq',
      `.[] | select(.event == "labeled" and .label.name == "${label}") | .created_at`,
    ]);
    if (r.code !== 0) return null;
    const last = r.stdout
      .trim()
      .split('\n')
      .findLast((line) => line.length > 0);
    if (!last) return null;
    const ts = Date.parse(last);
    return Number.isNaN(ts) ? null : ts;
  }

  async createDraftPR(o: {
    branch: string;
    base: string;
    title: string;
    body: string;
  }): Promise<string> {
    const out = await this.gh([
      'pr',
      'create',
      '--repo',
      this.repo,
      '--draft',
      '--head',
      o.branch,
      '--base',
      o.base,
      '--title',
      o.title,
      '--body',
      o.body,
    ]);
    return out.trim().split('\n').at(-1) ?? '';
  }

  // Tolerant by design: cleanup probes branches that may have no PR at all.
  async prState(branch: string): Promise<'OPEN' | 'MERGED' | 'CLOSED' | null> {
    const r = await this.exec(['gh', 'pr', 'view', branch, '--repo', this.repo, '--json', 'state']);
    if (r.code !== 0) return null;
    try {
      return (JSON.parse(r.stdout) as { state: 'OPEN' | 'MERGED' | 'CLOSED' }).state;
    } catch {
      return null;
    }
  }

  async prComment(branch: string, body: string): Promise<void> {
    await this.gh(['pr', 'comment', branch, '--repo', this.repo, '--body', body]);
  }
}
