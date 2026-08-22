/**
 * Token accounting, normalized across adapters — the single extractor, shared
 * by the run log (src/log.ts) and the dashboard (ui/app/lib/transcript.ts) so
 * one run can never render two different numbers.
 *
 * Every adapter reports usage differently and, critically, their own
 * `total_tokens` do NOT mean the same thing. Verified against recorded runs:
 *
 * - antigravity: `input_tokens + output_tokens === total_tokens` exactly
 *   (148900 + 11032 === 159932) while `cache_read_tokens` (649148) sits
 *   OUTSIDE that total. Its total is not a total.
 * - claude: reports no total at all. `input_tokens`, `cache_read_input_tokens`
 *   and `cache_creation_input_tokens` are disjoint — a recorded iteration
 *   shows `input_tokens: 8` next to `cache_read_input_tokens: 34114`, which
 *   only holds if reads are excluded from input.
 * - codex: `cached_input_tokens` is a SUBSET of `input_tokens` and
 *   `reasoning_output_tokens` a subset of `output_tokens` (OpenAI convention;
 *   field names read out of the codex binary's own type table).
 *
 * So provider totals are never trusted. `total` is computed here and the parts
 * are disjoint, which is what makes summing across adapters meaningful.
 */

export interface TokenUsage {
  /** Prompt tokens processed fresh. Never includes cache reads. */
  input: number;
  /** Prompt tokens served from cache. */
  cachedInput: number;
  /** Prompt tokens written into the cache (claude only). */
  cacheWrite: number;
  /** Completion tokens, reasoning included. */
  output: number;
  /** Reasoning/thinking tokens — a SUBSET of `output`, surfaced for display. */
  reasoning: number;
  /** input + cachedInput + cacheWrite + output. Always computed, never read. */
  total: number;
}

/** Coerce a reported field to a usable count; garbage and negatives become 0. */
function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Seal the disjoint parts into a usage, or nothing when the run reported none. */
function seal(parts: Omit<TokenUsage, 'total'>): TokenUsage | undefined {
  const total = parts.input + parts.cachedInput + parts.cacheWrite + parts.output;
  return total > 0 ? { ...parts, total } : undefined;
}

/** `claude -p`: a terminal `type: "result"` event carrying disjoint usage. */
function claudeUsage(events: Array<Record<string, unknown>>): TokenUsage | undefined {
  const final = events.findLast((e) => e.type === 'result');
  if (!final) return undefined;

  const usage = record(final.usage);
  if (usage) {
    const details = record(usage.output_tokens_details);
    const sealed = seal({
      input: num(usage.input_tokens),
      cachedInput: num(usage.cache_read_input_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      output: num(usage.output_tokens),
      reasoning: num(details?.thinking_tokens),
    });
    if (sealed) return sealed;
  }

  // Older/aggregated streams report per-model usage instead. Same disjoint
  // fields in camelCase; summing across models is safe because of that.
  const models = record(final.modelUsage);
  if (!models) return undefined;
  let input = 0;
  let cachedInput = 0;
  let cacheWrite = 0;
  let output = 0;
  for (const value of Object.values(models)) {
    const m = record(value);
    if (!m) continue;
    input += num(m.inputTokens);
    cachedInput += num(m.cacheReadInputTokens);
    cacheWrite += num(m.cacheCreationInputTokens);
    output += num(m.outputTokens);
  }
  return seal({ input, cachedInput, cacheWrite, output, reasoning: 0 });
}

/** `agy -p`: a terminal `event: "result"` whose usage hangs off the payload. */
function antigravityUsage(events: Array<Record<string, unknown>>): TokenUsage | undefined {
  const final = events.findLast((e) => e.event === 'result');
  if (!final) return undefined;

  const usage = record(record(final.result)?.usage) ?? record(final.usage);
  if (!usage) return undefined;

  // total_tokens is deliberately ignored: agy leaves cache reads out of it.
  return seal({
    input: num(usage.input_tokens),
    cachedInput: num(usage.cache_read_tokens),
    cacheWrite: 0,
    output: num(usage.output_tokens),
    reasoning: num(usage.thinking_tokens),
  });
}

/** `codex exec --json`: usage rides every `turn.completed`. */
function codexUsage(events: Array<Record<string, unknown>>): TokenUsage | undefined {
  let input = 0;
  let cachedInput = 0;
  let output = 0;
  let reasoning = 0;
  for (const event of events) {
    if (event.type !== 'turn.completed') continue;
    const usage = record(event.usage);
    if (!usage) continue;
    // Codex nests cache reads inside input_tokens, so the fresh count is the
    // difference. Clamped: a future codex that reports them disjointly would
    // undercount slightly rather than emit a negative that poisons every sum.
    const reported = num(usage.input_tokens);
    const cached = num(usage.cached_input_tokens);
    input += Math.max(0, reported - cached);
    cachedInput += cached;
    output += num(usage.output_tokens);
    reasoning += num(usage.reasoning_output_tokens);
  }
  // UNVERIFIED: whether a multi-turn `codex exec` reports per-turn deltas or a
  // running total. Single-turn runs — every run cue makes today — are identical
  // either way. If multi-turn totals ever look inflated, take the last event
  // instead of summing.
  return seal({ input, cachedInput, cacheWrite: 0, output, reasoning });
}

/**
 * Pull normalized usage out of a recorded `result`, which is polymorphic: older
 * logs store the single terminal event, newer ones the whole event array.
 */
export function extractUsage(result: unknown): TokenUsage | undefined {
  const raw: unknown[] = Array.isArray(result) ? result : [result];
  const events: Array<Record<string, unknown>> = [];
  for (const e of raw) {
    const r = record(e);
    if (r) events.push(r);
  }
  if (events.length === 0) return undefined;
  return claudeUsage(events) ?? antigravityUsage(events) ?? codexUsage(events);
}

/** Compact token count for dense UI: 500 → "500", 65626 → "65.6k". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * The disjoint parts, in the order they sum to `total`. Reasoning is left out
 * on purpose — it is a subset of `output`, so listing it here would invite
 * adding it to the rest.
 */
export function formatTokenBreakdown(usage: TokenUsage): string {
  const parts = [`${formatTokens(usage.input)} in`];
  if (usage.cachedInput > 0) parts.push(`${formatTokens(usage.cachedInput)} cached`);
  if (usage.cacheWrite > 0) parts.push(`${formatTokens(usage.cacheWrite)} written`);
  parts.push(`${formatTokens(usage.output)} out`);
  return parts.join(' · ');
}
