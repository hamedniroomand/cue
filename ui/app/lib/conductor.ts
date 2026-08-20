/**
 * Client-side view of the conductor API (src/server.ts).
 *
 * Every fetch falls back to the bundled fixtures in app/fixtures so the
 * dashboard is reviewable without a conductor process running.
 */

export interface BoardIssue {
  number: number
  title: string
  labels: string[]
  cost: number
}

export interface DashboardState {
  repo: string
  worktreeRoot: string
  models: { triage: string; dev: string; review: string }
  busy: string | null
  columns: Array<{ label: string; issues: BoardIssue[] }>
}

export interface ConductorEvent {
  ts: number
  issue: number
  stage: string
  kind: "start" | "progress" | "done" | "error"
  message: string
}

export interface RunSummary {
  stage: string
  ts: number
  costUsd?: number
  durationMs: number
  outcome: "ok" | "failed"
  error?: string
}

/** One issue that has runs recorded on disk — board membership not required. */
export interface RunIndexEntry {
  issue: number
  runs: number
  costUsd: number
  lastTs: number
  title?: string
}

export interface RunDetail extends RunSummary {
  prompt: string
  result: unknown
}

/** A single line of a `claude -p --output-format stream-json` transcript. */
export interface StreamEvent {
  type?: string
  subtype?: string
  model?: string
  result?: string
  total_cost_usd?: number
  num_turns?: number
  duration_api_ms?: number
  is_error?: boolean
  tool_name?: string
  message?: {
    role?: string
    content?: Array<{
      type?: string
      text?: string
      thinking?: string
      name?: string
      input?: Record<string, unknown>
      content?: unknown
      is_error?: boolean
    }>
  }
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
      key: string
      kind: "result"
      text: string
      costUsd?: number
      turns?: number
    }

/**
 * `RunEntry.result` is polymorphic across recorded runs: older logs store the
 * single `result` event as an object, newer ones store the whole event array.
 * Everything downstream reads StreamEvent[].
 */
export function normalizeEvents(result: unknown): StreamEvent[] {
  if (Array.isArray(result)) return result as StreamEvent[]
  if (result && typeof result === "object") return [result as StreamEvent]
  return []
}

function summarizeInput(input: Record<string, unknown> | undefined): string {
  if (!input) return ""
  const first =
    input.command ??
    input.file_path ??
    input.pattern ??
    input.description ??
    input.prompt
  const text =
    typeof first === "string" ? first : JSON.stringify(first ?? input)
  return text.slice(0, 240)
}

function asText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String(c.text) : ""
      )
      .join("")
  }
  return content === undefined ? "" : JSON.stringify(content)
}

/** Flatten a raw transcript into renderable rows, dropping empty noise. */
export function toRows(events: StreamEvent[]): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  events.forEach((ev, i) => {
    const key = String(i)
    if (ev.type === "system") {
      if (ev.subtype === "init")
        rows.push({ key, kind: "init", model: ev.model ?? "unknown" })
      else if (ev.subtype === "permission_denied")
        rows.push({
          key,
          kind: "denied",
          detail: ev.tool_name ?? "unknown tool",
        })
      // Hook lifecycle events are infrastructure noise; the Raw tab keeps them.
      return
    }
    if (ev.type === "rate_limit_event") {
      rows.push({
        key,
        kind: "rate_limit",
        detail: ev.subtype ?? "rate limited",
      })
      return
    }
    if (ev.type === "result") {
      rows.push({
        key,
        kind: "result",
        text: ev.result ?? "",
        costUsd: ev.total_cost_usd,
        turns: ev.num_turns,
      })
      return
    }
    for (const [j, block] of (ev.message?.content ?? []).entries()) {
      const bk = `${i}-${j}`
      if (block.type === "tool_use")
        rows.push({
          key: bk,
          kind: "tool",
          name: block.name ?? "tool",
          detail: summarizeInput(block.input),
        })
      else if (block.type === "tool_result")
        rows.push({
          key: bk,
          kind: "tool_result",
          detail: asText(block.content).slice(0, 400),
          failed: block.is_error === true,
        })
      else if (block.type === "thinking" && block.thinking?.trim())
        rows.push({ key: bk, kind: "thinking", text: block.thinking.trim() })
      else if (block.type === "text" && block.text?.trim())
        rows.push({
          key: bk,
          kind: "text",
          role: ev.message?.role ?? ev.type ?? "assistant",
          text: block.text.trim(),
        })
    }
  })
  return rows
}

export interface RunStats {
  events: number
  tools: number
  denied: number
  turns?: number
}

export function statsFor(events: StreamEvent[]): RunStats {
  const rows = toRows(events)
  const result = rows.find((r) => r.kind === "result")
  return {
    events: events.length,
    tools: rows.filter((r) => r.kind === "tool").length,
    denied: rows.filter((r) => r.kind === "denied").length,
    turns: result?.kind === "result" ? result.turns : undefined,
  }
}

export const STAGES = [
  "triage",
  "replan",
  "dev",
  "fix",
  "review",
  "review-fix",
] as const

export function shortLabel(label: string): string {
  return label.replace("agent:", "")
}

export function formatUsd(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

/* ---------------------------------------------------------------- fetching */

async function fixtures() {
  return (await import("~/fixtures")).default
}

async function get<T>(path: string, fallback: () => Promise<T>): Promise<T> {
  try {
    const res = await fetch(path)
    if (!res.ok) return await fallback()
    return (await res.json()) as T
  } catch {
    return await fallback()
  }
}

export async function fetchState(): Promise<DashboardState> {
  return get("/api/state", async () => (await fixtures()).state)
}

/**
 * Issues with recorded runs, read from disk. This is the source of truth for the
 * explorer: the label board only holds issues still in flight, so anything that
 * reached agent:done would otherwise be invisible.
 */
export async function fetchRunIndex(): Promise<RunIndexEntry[]> {
  return get("/api/runs", async () => (await fixtures()).index ?? [])
}

export async function fetchRuns(issue: number): Promise<RunSummary[]> {
  return get(
    `/api/runs/${issue}`,
    async () => (await fixtures()).runs[issue] ?? []
  )
}

export async function fetchRun(
  issue: number,
  run: string
): Promise<RunDetail | null> {
  return get(`/api/runs/${issue}/${run}`, async () => {
    const all = (await fixtures()).details[issue] ?? []
    return all.find((d) => `${d.stage}-${d.ts}` === run) ?? null
  })
}

export async function poll(): Promise<void> {
  await fetch("/api/poll", { method: "POST" })
}

export async function runIssue(issue: number): Promise<void> {
  await fetch(`/api/run/${issue}`, { method: "POST" })
}
