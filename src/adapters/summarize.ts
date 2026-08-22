/**
 * The single list of "interesting" tool-input keys, shared by every adapter's
 * progress line and by the dashboard transcript (ui/app/lib/transcript.ts
 * imports this file relatively — it must stay dependency-free so both build
 * roots can compile it).
 *
 * PascalCase variants cover Antigravity's tool parameters; snake_case covers
 * Claude and Codex.
 */
export const TOOL_INPUT_KEYS = [
  'command',
  'CommandLine',
  'file_path',
  'path',
  'AbsolutePath',
  'pattern',
  'Pattern',
  'query',
  'Query',
  'description',
  'prompt',
] as const;

/** One-line summary of a tool invocation's input, capped at maxLen chars. */
export function summarizeToolInput(
  input: Record<string, unknown> | undefined,
  maxLen: number,
): string {
  if (!input) return '';
  let first: unknown;
  for (const key of TOOL_INPUT_KEYS) {
    if (input[key] !== undefined) {
      first = input[key];
      break;
    }
  }
  const text = typeof first === 'string' ? first : JSON.stringify(first ?? input);
  return (text ?? '').slice(0, maxLen);
}
