import { intro, isCancel, outro, select, text } from '@clack/prompts';

import { ADAPTERS, type AdapterName } from '@/adapters/registry';

export interface AskOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * The narrow slice of prompting the wizard needs. Injected so tests replay
 * scripted answers instead of driving a terminal — the same seam as `Exec`.
 */
export interface Ask {
  select(message: string, options: AskOption[], initial: string): Promise<string>;
  text(message: string, initial: string): Promise<string>;
  /** Optional framing around the whole run — clack draws its bracketed group. */
  begin?(message: string): void;
  end?(message: string): void;
}

/** Thrown when the user aborts a prompt, so callers can bail without writing. */
export class PromptCancelled extends Error {
  constructor() {
    super('cancelled at the prompt');
    this.name = 'PromptCancelled';
  }
}

/** Canonical adapters only — "agy" is an input alias, never an offer. */
export const ADAPTER_OPTIONS: AskOption[] = [
  { value: 'codex', label: 'Codex', hint: 'codex exec' },
  { value: 'antigravity', label: 'Antigravity', hint: 'agy' },
  { value: 'claude', label: 'Claude Code', hint: 'claude -p' },
];

/**
 * Whether `cue init` may ask questions. A scripted install must never block on a
 * prompt, so both streams have to be a terminal — and `--yes` always wins.
 */
export function shouldPrompt(
  flags: string[],
  streams: { stdin?: boolean; stdout?: boolean },
): boolean {
  if (flags.includes('--yes') || flags.includes('-y')) return false;
  return streams.stdin === true && streams.stdout === true;
}

/**
 * The real terminal backend. Every prompt is checked with clack's `isCancel`
 * and turned into a throw, so a Ctrl+C can never be mistaken for an answer.
 */
export const clackAsk: Ask = {
  async select(message, options, initial) {
    const value = await select({ message, options, initialValue: initial });
    if (isCancel(value)) throw new PromptCancelled();
    return value;
  },
  async text(message, initial) {
    // initialValue pre-fills the editable buffer; defaultValue covers a
    // submitted-empty field so the answer is never an empty string by accident.
    const value = await text({ message, initialValue: initial, defaultValue: initial });
    if (isCancel(value)) throw new PromptCancelled();
    return value;
  },
  begin(message) {
    intro(message);
  },
  end(message) {
    outro(message);
  },
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

export interface PromptedConfig {
  /** `current` with the answers merged over it, ready to write. */
  config: Record<string, unknown>;
  /** Things the wizard decided on the user's behalf and must own up to. */
  notes: string[];
}

/**
 * Asks the three settings Cue cannot guess — which agent CLI runs the stages,
 * and how this project tests and lints. Everything else keeps its default and
 * is edited in the file, where the published schema autocompletes it.
 *
 * Accepting every pre-filled answer round-trips `current` unchanged, so
 * re-running `cue init` never rewrites a tuned config by accident.
 */
export async function promptConfig(
  current: Record<string, unknown>,
  ask: Ask,
): Promise<PromptedConfig> {
  const notes: string[] = [];
  ask.begin?.('Configuring Cue for this repo');
  const before = current.adapter === 'agy' ? 'antigravity' : asString(current.adapter);

  const picked = await ask.select(
    'Which agent CLI drives the stages?',
    ADAPTER_OPTIONS,
    before ?? 'codex',
  );
  const adapter = (picked in ADAPTERS ? picked : (before ?? 'codex')) as AdapterName;

  const gate = asRecord(current.gate);
  const test = (
    await ask.text('Test command for the gate', asString(gate.test) ?? 'bun test')
  ).trim();
  const lint = (await ask.text('Lint command (blank for none)', asString(gate.lint) ?? '')).trim();

  // A blank answer means "keep what was pre-filled": an empty gate command
  // would parse but never gate anything.
  const nextGate = {
    test: test || asString(gate.test) || 'bun test',
    ...(lint ? { lint } : {}),
  };
  const config: Record<string, unknown> = { ...current, adapter, gate: nextGate };

  // Model names only mean something relative to an adapter, so carrying them
  // across a switch is how "sonnet" ends up handed to codex.
  if (current.models && before && before !== adapter) {
    delete config.models;
    notes.push(`dropped "models" — those names belong to ${before}, not ${adapter}`);
  }
  const summary = [`adapter ${adapter}`, `test \`${nextGate.test}\``];
  if (nextGate.lint) summary.push(`lint \`${nextGate.lint}\``);
  ask.end?.(summary.join(' · '));
  return { config, notes };
}
