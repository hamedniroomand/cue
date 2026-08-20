export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  model: string;
  maxTurns: number;
  allowedTools: string[];
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
