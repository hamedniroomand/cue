import { JsonlAdapter } from '@/adapters/base';
import { summarizeToolInput } from '@/adapters/summarize';
import type { AgentResult, AgentRunOptions } from '@/adapters/types';

interface AgyUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
}

interface AgyStepUpdate {
  conversation_id?: string;
  step_index?: number;
  state?: string;
  step_type?: string;
  text_delta?: string;
  message?: string;
  tool_name?: string;
  tool_info?: {
    name?: string;
    parameters?: Record<string, unknown>;
  };
  tool_input?: Record<string, unknown>;
  duration_seconds?: number;
  usage?: AgyUsage;
}

interface AgyResultPayload {
  conversation_id?: string;
  status?: string;
  response?: string;
  result?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  usage?: AgyUsage;
  total_cost_usd?: number;
  cost_usd?: number;
}

interface AgyInitPayload {
  cwd?: string;
  model?: string;
  tools?: string[];
  permission_mode?: string;
}

interface AgyStreamEvent {
  event?: string;
  type?: string;
  model?: string;
  init?: AgyInitPayload;
  step_update?: AgyStepUpdate;
  result?: AgyResultPayload | string;
  status?: string;
  response?: string;
  error?: string;
  total_cost_usd?: number;
  num_turns?: number;
}

function isResultEvent(e: AgyStreamEvent): boolean {
  return (
    e.event === 'result' || e.type === 'result' || e.status === 'SUCCESS' || e.status === 'ERROR'
  );
}

export class AntigravityAdapter extends JsonlAdapter<AgyStreamEvent> {
  protected readonly bin = 'agy';
  // agy has no web-search flag; the base class surfaces a webSearch request
  // as a progress warning instead of silently dropping it.
  protected readonly supportsWebSearch = false;
  protected readonly envKeys = [
    'GEMINI_API_KEY',
    'ANTIGRAVITY_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_API_KEY',
  ];

  protected command(opts: AgentRunOptions): string[] {
    // agy has no per-command Bash scoping and no turn cap: write access maps
    // to accept-edits mode, read-only stages run in plan mode, and the only
    // hard bound on a run is the print timeout mirroring opts.timeoutMs.
    const cmd = [
      'agy',
      '-p',
      opts.prompt,
      '--output-format',
      'stream-json',
      '--mode',
      opts.access === 'write' ? 'accept-edits' : 'plan',
      '--dangerously-skip-permissions',
      '--model',
      opts.model,
    ];
    if (opts.timeoutMs > 0) cmd.push('--print-timeout', `${Math.ceil(opts.timeoutMs / 1000)}s`);
    return cmd;
  }

  protected progressFor(ev: AgyStreamEvent): string[] {
    if (ev.event === 'init') {
      const model = ev.init?.model ?? ev.model;
      return [model ? `session started (${model})` : 'session started'];
    }
    if (ev.event !== 'step_update' || !ev.step_update) return [];
    const su = ev.step_update;
    const toolName = su.tool_name ?? su.tool_info?.name;
    if (toolName) {
      const params = su.tool_info?.parameters ?? su.tool_input;
      return [`⚙ ${toolName}: ${summarizeToolInput(params, 80)}`];
    }
    const text = su.text_delta ?? su.message;
    return text?.trim() ? [`… ${text.trim().slice(0, 100)}`] : [];
  }

  protected extract(events: AgyStreamEvent[]): AgentResult {
    // The terminal event of an append-only stream: always take the LAST match,
    // so a mid-stream event carrying a result-shaped payload can't shadow it.
    const final = events.findLast(isResultEvent);
    if (!final) throw new Error('agy stream contained no result event');

    if (final.status === 'ERROR')
      throw new Error(`agy error: ${final.error ?? final.response ?? 'unknown error'}`);

    if (typeof final.result === 'string') return { text: final.result, raw: events };

    if (final.result && typeof final.result === 'object') {
      const r = final.result;
      if (r.status === 'ERROR')
        throw new Error(`agy error: ${r.error ?? r.response ?? 'unknown error'}`);
      return {
        text: r.response ?? r.result ?? '',
        costUsd: r.total_cost_usd ?? r.cost_usd ?? r.usage?.cost_usd,
        turns: r.num_turns,
        raw: events,
      };
    }

    return {
      text: final.response ?? '',
      costUsd: final.total_cost_usd,
      turns: final.num_turns,
      raw: events,
    };
  }
}
