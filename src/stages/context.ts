import type { AgentAdapter } from "../adapters/types";
import type { CueConfig } from "../config";
import type { Exec } from "../exec";
import type { GitHub } from "../github";
import type { RunLogger } from "../log";
import type { Platform } from "../platform";
import type { WorktreeManager } from "../worktree";

export interface CueEvent {
  ts: number;
  issue: number;
  stage: string;
  kind: "start" | "progress" | "done" | "error";
  message: string;
}

export interface StageContext {
  onEvent: (event: CueEvent) => void;
  config: CueConfig;
  github: GitHub;
  adapter: AgentAdapter;
  logger: RunLogger;
  exec: Exec;
  platform: Platform;
  worktrees: WorktreeManager;
  promptsDirs: string[];
}
