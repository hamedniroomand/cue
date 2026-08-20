import type { AgentAdapter } from "../adapters/types";
import type { ConductorConfig } from "../config";
import type { Exec } from "../exec";
import type { GitHub } from "../github";
import type { RunLogger } from "../log";
import type { WorktreeManager } from "../worktree";

export interface StageContext {
  config: ConductorConfig;
  github: GitHub;
  adapter: AgentAdapter;
  logger: RunLogger;
  exec: Exec;
  worktrees: WorktreeManager;
  promptsDirs: string[];
}
