import type { AgentAdapter } from "../adapters/types";
import type { ConductorConfig } from "../config";
import type { Exec } from "../exec";
import type { GitHub } from "../github";
import type { RunLogger } from "../log";
import type { WorktreeManager } from "../worktree";

export interface ConductorEvent {
  ts: number;
  issue: number;
  stage: string;
  kind: "start" | "progress" | "done" | "error";
  message: string;
}

export interface StageContext {
  onEvent: (event: ConductorEvent) => void;
  config: ConductorConfig;
  github: GitHub;
  adapter: AgentAdapter;
  logger: RunLogger;
  exec: Exec;
  worktrees: WorktreeManager;
  promptsDirs: string[];
}
