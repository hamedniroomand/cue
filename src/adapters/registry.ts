import { AntigravityAdapter } from '@/adapters/antigravity';
import { ClaudeAdapter } from '@/adapters/claude';
import { CodexAdapter } from '@/adapters/codex';
import type { AgentAdapter } from '@/adapters/types';
import type { Exec } from '@/exec';
import type { Platform } from '@/platform';

/** Canonical adapter names — aliases ("agy") are normalized in config.ts. */
export type AdapterName = 'claude' | 'codex' | 'antigravity';

export interface AdapterInfo {
  make(exec: Exec, platform: Platform): AgentAdapter;
  defaultModels: { triage: string; dev: string; review: string };
}

/**
 * The one place that knows which adapters exist. Adding an adapter means one
 * entry here plus the "agy"-style alias handling in config.ts if it needs one.
 */
export const ADAPTERS: Record<AdapterName, AdapterInfo> = {
  claude: {
    make: (exec, platform) => new ClaudeAdapter(exec, platform),
    defaultModels: { triage: 'haiku', dev: 'sonnet', review: 'opus' },
  },
  codex: {
    make: (exec, platform) => new CodexAdapter(exec, platform),
    defaultModels: { triage: 'gpt-5.3-codex', dev: 'gpt-5.3-codex', review: 'gpt-5.3-codex' },
  },
  antigravity: {
    make: (exec, platform) => new AntigravityAdapter(exec, platform),
    defaultModels: {
      triage: 'gemini-3.7-flash-medium',
      dev: 'gemini-3.7-flash-high',
      review: 'gemini-3.7-flash-high',
    },
  },
};
