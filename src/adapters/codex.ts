import { JsonlAdapter } from '@/adapters/base';
import type { AgentResult, AgentRunOptions } from '@/adapters/types';

interface CodexItem {
  type?: string;
  text?: string;
  command?: string;
  exit_code?: number;
}

interface CodexEvent {
  type?: string;
  item?: CodexItem;
}

/** Runs a fresh non-interactive Codex session for one Cue pipeline stage. */
export class CodexAdapter extends JsonlAdapter<CodexEvent> {
  protected readonly bin = 'codex';
  protected readonly envKeys = ['OPENAI_API_KEY', 'CODEX_HOME'];
  protected readonly supportsWebSearch = true;

  protected command(opts: AgentRunOptions): string[] {
    // Codex has no per-command Bash scoping and no turn cap: write access maps
    // to the workspace-write sandbox (which also denies network), read-only
    // stages stay in the read-only sandbox, and the only hard bound on a run
    // is opts.timeoutMs. bashAllowlist/maxTurns are documented as Claude-only.
    return [
      'codex',
      // --search is a global flag; `codex exec --search` is rejected.
      ...(opts.webSearch ? ['--search'] : []),
      'exec',
      '--json',
      '--sandbox',
      opts.access === 'write' ? 'workspace-write' : 'read-only',
      '--cd',
      opts.cwd,
      '--model',
      opts.model,
      opts.prompt,
    ];
  }

  protected progressFor(event: CodexEvent): string[] {
    // Codex emits item.started and item.completed for the same item — report
    // commands when they start and messages when they complete, never both.
    if (event.type === 'item.started' && event.item?.type === 'command_execution')
      return event.item.command ? [`⚙ ${event.item.command.slice(0, 100)}`] : [];
    if (event.type === 'item.completed' && event.item?.type === 'agent_message')
      return event.item.text?.trim() ? [`… ${event.item.text.trim().slice(0, 100)}`] : [];
    return [];
  }

  protected extract(events: CodexEvent[]): AgentResult {
    const final = events.findLast(
      (event) => event.type === 'item.completed' && event.item?.type === 'agent_message',
    );
    if (!final?.item?.text) throw new Error('codex stream contained no final agent message');
    const turns = events.filter((event) => event.type === 'turn.completed').length;
    // Codex JSONL reports token usage but no dollar cost; costUsd stays
    // unknown rather than a made-up estimate.
    return { text: final.item.text, turns: turns > 0 ? turns : undefined, raw: events };
  }
}
