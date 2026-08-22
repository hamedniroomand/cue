import { JsonlAdapter } from '@/adapters/base';
import { summarizeToolInput } from '@/adapters/summarize';
import type { AgentResult, AgentRunOptions } from '@/adapters/types';

interface StreamEvent {
  type?: string;
  subtype?: string;
  model?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

// Claude enforces permissions per tool name, so the semantic run options map
// to an explicit allowlist here — the one adapter that can scope Bash.
function allowedTools(opts: AgentRunOptions): string[] {
  const tools = ['Read', 'Grep', 'Glob'];
  if (opts.webSearch) tools.push('WebSearch');
  if (opts.access === 'write') {
    tools.push('Write', 'Edit');
    tools.push(...(opts.bashAllowlist?.map((p) => `Bash(${p})`) ?? ['Bash']));
  }
  return tools;
}

export class ClaudeAdapter extends JsonlAdapter<StreamEvent> {
  protected readonly bin = 'claude';
  protected readonly envKeys = ['ANTHROPIC_API_KEY'];
  protected readonly supportsWebSearch = true;

  protected command(opts: AgentRunOptions): string[] {
    return [
      'claude',
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      opts.model,
      '--max-turns',
      String(opts.maxTurns),
      '--allowedTools',
      allowedTools(opts).join(','),
    ];
  }

  protected progressFor(ev: StreamEvent): string[] {
    if (ev.type === 'system' && ev.subtype === 'init')
      return [`session started (${ev.model ?? 'unknown model'})`];
    if (ev.type !== 'assistant') return [];
    const messages: string[] = [];
    for (const block of ev.message?.content ?? []) {
      if (block.type === 'tool_use')
        messages.push(`⚙ ${block.name}: ${summarizeToolInput(block.input, 80)}`);
      else if (block.type === 'text' && block.text?.trim())
        messages.push(`… ${block.text.trim().slice(0, 100)}`);
    }
    return messages;
  }

  protected extract(events: StreamEvent[]): AgentResult {
    const final = events.findLast((e) => e.type === 'result');
    if (!final) throw new Error('claude stream contained no result event');
    return {
      text: final.result ?? '',
      costUsd: final.total_cost_usd,
      turns: final.num_turns,
      raw: events,
    };
  }
}
