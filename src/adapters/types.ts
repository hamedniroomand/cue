export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  model: string;
  maxTurns: number;
  /** What the stage may do. Read-only stages inspect the repo; write stages
   *  edit files and run commands. Each adapter maps this to its own native
   *  permission mechanism (tool allowlist, sandbox, mode). */
  access: 'read-only' | 'write';
  /** Grant web search where the adapter supports it. */
  webSearch?: boolean;
  /** Shell command patterns a write stage may run (Claude permission syntax,
   *  e.g. "bun *"). Unset = unrestricted shell. Only Claude can enforce
   *  per-command scoping; sandboxed adapters fall back to their sandbox. */
  bashAllowlist?: string[];
  timeoutMs: number;
  onProgress?: (message: string) => void;
}

export interface AgentResult {
  text: string;
  costUsd?: number;
  turns?: number;
  raw: unknown;
}

export interface AgentAdapter {
  run(opts: AgentRunOptions): Promise<AgentResult>;
}
