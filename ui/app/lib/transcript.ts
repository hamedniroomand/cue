/**
 * Pure transcript normalization for recorded runs — no ui-only imports, so
 * the root test suite covers it (tests/transcript.test.ts). The tool-input
 * summarizer is shared with the adapters' progress lines to keep both
 * surfaces rendering the same run the same way.
 */
import { summarizeToolInput } from "../../../src/adapters/summarize";

/** One line of a recorded agent transcript (claude, codex, or antigravity). */
export interface StreamEvent {
  event?: string;
  type?: string;
  subtype?: string;
  model?: string;
  result?:
    | string
    | {
        status?: string;
        response?: string;
        result?: string;
        total_cost_usd?: number;
        cost_usd?: number;
        num_turns?: number;
        usage?: { cost_usd?: number; total_tokens?: number };
      };
  init?: { model?: string; tools?: string[] };
  step_update?: {
    step_type?: string;
    text_delta?: string;
    message?: string;
    tool_name?: string;
    tool_info?: { name?: string; parameters?: Record<string, unknown> };
    tool_input?: Record<string, unknown>;
  };
  total_cost_usd?: number;
  num_turns?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  tool_name?: string;
  response?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
  };
  item?: {
    type?: string;
    text?: string;
    command?: string;
    exit_code?: number;
  };
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      name?: string;
      input?: Record<string, unknown>;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
}

export type TranscriptRow =
  | { key: string; kind: "init"; model: string }
  | { key: string; kind: "text"; role: string; text: string }
  | { key: string; kind: "thinking"; text: string }
  | { key: string; kind: "tool"; name: string; detail: string }
  | { key: string; kind: "tool_result"; detail: string; failed: boolean }
  | { key: string; kind: "denied"; detail: string }
  | { key: string; kind: "rate_limit"; detail: string }
  | {
      key: string;
      kind: "result";
      text: string;
      costUsd?: number;
      turns?: number;
    };

/**
 * `RunEntry.result` is polymorphic across recorded runs: older logs store the
 * single `result` event as an object, newer ones store the whole event array.
 * Everything downstream reads StreamEvent[].
 */
export function normalizeEvents(result: unknown): StreamEvent[] {
  if (Array.isArray(result)) return result as StreamEvent[];
  if (result && typeof result === "object") return [result as StreamEvent];
  return [];
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c ? String(c.text) : ""))
      .join("");
  }
  return content === undefined ? "" : JSON.stringify(content);
}

// One extractor for both spellings of a terminal event (agy `event: "result"`,
// claude `type: "result"`), so the two paths can never drift on precedence.
function resultRow(key: string, ev: StreamEvent): TranscriptRow {
  const r = typeof ev.result === "object" ? ev.result : undefined;
  return {
    key,
    kind: "result",
    text:
      (typeof ev.result === "string" ? ev.result : "") ||
      r?.response ||
      r?.result ||
      ev.response ||
      "",
    costUsd: ev.total_cost_usd ?? r?.total_cost_usd ?? r?.cost_usd ?? r?.usage?.cost_usd,
    turns: ev.num_turns ?? r?.num_turns,
  };
}

// Codex `codex exec --json` items. Commands render when they start; failures,
// reasoning, messages, and errors render when the item completes.
function codexRows(key: string, ev: StreamEvent): TranscriptRow[] {
  const item = ev.item!;
  if (item.type === "command_execution") {
    if (ev.type === "item.started" && item.command)
      return [{ key, kind: "tool", name: "shell", detail: item.command.slice(0, 240) }];
    if (ev.type === "item.completed" && typeof item.exit_code === "number" && item.exit_code !== 0)
      return [
        {
          key,
          kind: "tool_result",
          detail: `exit ${item.exit_code}: ${item.command ?? ""}`.slice(0, 400),
          failed: true,
        },
      ];
    return [];
  }
  if (ev.type !== "item.completed" || !item.text?.trim()) return [];
  const text = item.text.trim();
  if (item.type === "agent_message") return [{ key, kind: "text", role: "assistant", text }];
  if (item.type === "reasoning") return [{ key, kind: "thinking", text }];
  if (item.type === "error")
    return [{ key, kind: "tool_result", detail: text.slice(0, 400), failed: true }];
  return [];
}

/** Flatten a raw transcript into renderable rows, dropping empty noise. */
export function toRows(events: StreamEvent[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  events.forEach((ev, i) => {
    const key = String(i);
    if (ev.item && (ev.type === "item.started" || ev.type === "item.completed")) {
      rows.push(...codexRows(key, ev));
      return;
    }
    if (ev.event === "init") {
      rows.push({ key, kind: "init", model: ev.init?.model ?? ev.model ?? "unknown" });
      return;
    }
    if (ev.event === "step_update" && ev.step_update) {
      const su = ev.step_update;
      const toolName = su.tool_name ?? su.tool_info?.name;
      if (toolName) {
        rows.push({
          key,
          kind: "tool",
          name: toolName,
          detail: summarizeToolInput(su.tool_info?.parameters ?? su.tool_input, 240),
        });
      } else if (su.text_delta?.trim() || su.message?.trim()) {
        rows.push({
          key,
          kind: "text",
          role: "assistant",
          text: (su.text_delta ?? su.message ?? "").trim(),
        });
      }
      return;
    }
    if (ev.event === "result" || ev.type === "result") {
      rows.push(resultRow(key, ev));
      return;
    }
    if (ev.type === "system") {
      if (ev.subtype === "init") rows.push({ key, kind: "init", model: ev.model ?? "unknown" });
      else if (ev.subtype === "permission_denied")
        rows.push({
          key,
          kind: "denied",
          detail: ev.tool_name ?? "unknown tool",
        });
      // Hook lifecycle events are infrastructure noise; the Raw tab keeps them.
      return;
    }
    if (ev.type === "rate_limit_event") {
      rows.push({
        key,
        kind: "rate_limit",
        detail: ev.subtype ?? "rate limited",
      });
      return;
    }
    for (const [j, block] of (ev.message?.content ?? []).entries()) {
      const bk = `${i}-${j}`;
      if (block.type === "tool_use")
        rows.push({
          key: bk,
          kind: "tool",
          name: block.name ?? "tool",
          detail: summarizeToolInput(block.input, 240),
        });
      else if (block.type === "tool_result")
        rows.push({
          key: bk,
          kind: "tool_result",
          detail: asText(block.content).slice(0, 400),
          failed: block.is_error === true,
        });
      else if (block.type === "thinking" && block.thinking?.trim())
        rows.push({ key: bk, kind: "thinking", text: block.thinking.trim() });
      else if (block.type === "text" && block.text?.trim())
        rows.push({
          key: bk,
          kind: "text",
          role: ev.message?.role ?? ev.type ?? "assistant",
          text: block.text.trim(),
        });
    }
  });
  return rows;
}

export interface RunStats {
  events: number;
  tools: number;
  denied: number;
  turns?: number;
}

export function statsFor(events: StreamEvent[]): RunStats {
  const rows = toRows(events);
  const result = rows.find((r) => r.kind === "result");
  // Codex streams have no result event; its turns are turn.completed markers.
  const codexTurns = events.filter((e) => e.type === "turn.completed").length;
  return {
    events: events.length,
    tools: rows.filter((r) => r.kind === "tool").length,
    denied: rows.filter((r) => r.kind === "denied").length,
    turns: (result?.kind === "result" ? result.turns : undefined) ?? (codexTurns || undefined),
  };
}
