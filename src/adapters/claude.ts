import type { AgentAdapter, AgentResult, AgentRunOptions } from '@/adapters/types';
import type { Exec } from '@/exec';
import { currentPlatform, type Platform } from '@/platform';

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

function summarizeToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const interesting = input.command ?? input.file_path ?? input.pattern ?? input.description ?? '';
  const text = typeof interesting === 'string' ? interesting : JSON.stringify(interesting);
  return (text ?? '').slice(0, 80);
}

function progressFor(ev: StreamEvent): string[] {
  if (ev.type === 'system' && ev.subtype === 'init')
    return [`session started (${ev.model ?? 'unknown model'})`];
  if (ev.type !== 'assistant') return [];
  const messages: string[] = [];
  for (const block of ev.message?.content ?? []) {
    if (block.type === 'tool_use')
      messages.push(`⚙ ${block.name}: ${summarizeToolInput(block.input)}`);
    else if (block.type === 'text' && block.text?.trim())
      messages.push(`… ${block.text.trim().slice(0, 100)}`);
  }
  return messages;
}

function parseEvents(stdout: string): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as StreamEvent);
    } catch {
      // non-JSON noise on stdout is ignored
    }
  }
  return events;
}

export class ClaudeAdapter implements AgentAdapter {
  constructor(
    private exec: Exec,
    private platform: Platform = currentPlatform(),
  ) {}

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const env: Record<string, string> = {};
    for (const key of this.platform.agentEnvAllowlist) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    const cmd = [
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
    ];
    if (opts.allowedTools.length > 0) cmd.push('--allowedTools', opts.allowedTools.join(','));

    const onLine = opts.onProgress
      ? (line: string) => {
          try {
            for (const msg of progressFor(JSON.parse(line) as StreamEvent)) opts.onProgress!(msg);
          } catch {
            // partial or non-JSON line; skip
          }
        }
      : undefined;

    const r = await this.exec(cmd, { cwd: opts.cwd, env, timeoutMs: opts.timeoutMs, onLine });
    if (r.code !== 0) throw new Error(`claude exited ${r.code}: ${r.stderr.slice(0, 500)}`);

    const events = parseEvents(r.stdout);
    const final = events.find((e) => e.type === 'result');
    if (!final) throw new Error('claude stream contained no result event');
    return {
      text: final.result ?? '',
      costUsd: final.total_cost_usd,
      turns: final.num_turns,
      raw: events,
    };
  }
}
