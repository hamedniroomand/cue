import { describe, expect, test } from 'bun:test';

// The dashboard's transcript normalizer lives in the ui package but is pure
// TS with no ui-only imports, so the root suite covers it directly.
// oxlint-disable-next-line import/no-relative-parent-imports -- ui/ is outside the @/ alias root on purpose
import { normalizeEvents, statsFor, toRows } from '../ui/app/lib/transcript';

describe('normalizeEvents', () => {
  test('wraps a legacy single-object result and passes arrays through', () => {
    expect(normalizeEvents({ type: 'result', result: 'done' })).toHaveLength(1);
    expect(normalizeEvents([{ type: 'result' }, { type: 'system' }])).toHaveLength(2);
    expect(normalizeEvents('garbage')).toEqual([]);
  });
});

describe('toRows: claude stream', () => {
  test('renders init, tool use, text, and the result with cost', () => {
    const rows = toRows([
      { type: 'system', subtype: 'init', model: 'claude-sonnet' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking around.' },
            { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } },
          ],
        },
      },
      { type: 'result', result: 'All done.', total_cost_usd: 0.04, num_turns: 6 },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['init', 'text', 'tool', 'result']);
    const result = rows.at(-1)!;
    expect(result).toMatchObject({ kind: 'result', text: 'All done.', costUsd: 0.04, turns: 6 });
  });
});

describe('toRows: codex stream', () => {
  const CODEX = [
    { type: 'thread.started' },
    { type: 'item.started', item: { type: 'command_execution', command: 'bun test' } },
    {
      type: 'item.completed',
      item: { type: 'command_execution', command: 'bun test', exit_code: 0 },
    },
    { type: 'item.completed', item: { type: 'reasoning', text: 'Considering the fix.' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'The plan.' } },
    { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 25 } },
  ];

  test('renders commands, reasoning, and agent messages exactly once each', () => {
    const rows = toRows(CODEX);
    expect(rows.filter((r) => r.kind === 'tool')).toHaveLength(1);
    expect(rows.find((r) => r.kind === 'tool')).toMatchObject({
      name: 'shell',
      detail: 'bun test',
    });
    expect(rows.filter((r) => r.kind === 'thinking')).toHaveLength(1);
    expect(rows.filter((r) => r.kind === 'text' && r.text === 'The plan.')).toHaveLength(1);
  });

  test('renders failed commands and error items visibly', () => {
    const rows = toRows([
      {
        type: 'item.completed',
        item: { type: 'command_execution', command: 'bun test', exit_code: 1 },
      },
      { type: 'item.completed', item: { type: 'error', text: 'sandbox denied network' } },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'tool_result', failed: true });
    expect(rows[1]).toMatchObject({
      kind: 'tool_result',
      failed: true,
      detail: 'sandbox denied network',
    });
  });

  test('statsFor counts codex turns from turn.completed events', () => {
    expect(statsFor(CODEX).turns).toBe(1);
    expect(statsFor(CODEX).tools).toBe(1);
  });
});

describe('toRows: streamed fragment coalescing', () => {
  test('agy text_delta fragments merge verbatim into one markdown-complete row', () => {
    const rows = toRows([
      { event: 'step_update', step_update: { text_delta: '## Plan\n- use `Bun.' } },
      { event: 'step_update', step_update: { text_delta: 'serve()` and' } },
      { event: 'step_update', step_update: { text_delta: ' **done**.' } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'text',
      text: '## Plan\n- use `Bun.serve()` and **done**.',
    });
  });

  test('whitespace-only deltas join words instead of being dropped', () => {
    const rows = toRows([
      { event: 'step_update', step_update: { text_delta: 'GET, POST' } },
      { event: 'step_update', step_update: { text_delta: '\n' } },
      { event: 'step_update', step_update: { text_delta: ', PUT' } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'text', text: 'GET, POST\n, PUT' });
  });

  test('a tool call between deltas starts a new text row', () => {
    const rows = toRows([
      { event: 'step_update', step_update: { text_delta: 'first' } },
      {
        event: 'step_update',
        step_update: { tool_name: 'grep_search', tool_info: { parameters: { Query: 'x' } } },
      },
      { event: 'step_update', step_update: { text_delta: 'second' } },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['text', 'tool', 'text']);
  });

  test('consecutive complete claude text blocks merge as paragraphs, same role only', () => {
    const rows = toRows([
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Part one.' }] },
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Part two.' }] },
      },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'A reply.' }] } },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'text', text: 'Part one.\n\nPart two.' });
    expect(rows[1]).toMatchObject({ kind: 'text', role: 'user', text: 'A reply.' });
  });

  test('consecutive thinking blocks merge as paragraphs', () => {
    const rows = toRows([
      { type: 'item.completed', item: { type: 'reasoning', text: 'First thought.' } },
      { type: 'item.completed', item: { type: 'reasoning', text: 'Second thought.' } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'thinking', text: 'First thought.\n\nSecond thought.' });
  });
});

describe('toRows: antigravity stream', () => {
  test('renders init, steps, and the object-shaped result', () => {
    const rows = toRows([
      { event: 'init', init: { model: 'gemini-3.7-flash-high' } },
      {
        event: 'step_update',
        step_update: { tool_name: 'grep_search', tool_info: { parameters: { Query: 'Adapter' } } },
      },
      {
        event: 'result',
        result: { status: 'SUCCESS', response: 'Plan.', num_turns: 4, usage: { cost_usd: 0.015 } },
      },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['init', 'tool', 'result']);
    expect(rows[0]).toMatchObject({ kind: 'init', model: 'gemini-3.7-flash-high' });
    expect(rows[1]).toMatchObject({ kind: 'tool', detail: 'Adapter' });
    expect(rows.at(-1)).toMatchObject({ kind: 'result', text: 'Plan.', costUsd: 0.015, turns: 4 });
  });

  test('event- and type-keyed result rows resolve text and cost identically', () => {
    const payload = {
      result: { response: 'Answer.', total_cost_usd: 0.5 },
    };
    const [a] = toRows([{ event: 'result', ...payload }]);
    const [b] = toRows([{ type: 'result', ...payload }]);
    expect(a).toMatchObject({ kind: 'result', text: 'Answer.', costUsd: 0.5 });
    expect(b).toMatchObject({ kind: 'result', text: 'Answer.', costUsd: 0.5 });
  });

  test('a step_update with only a message becomes an assistant text row', () => {
    const rows = toRows([{ event: 'step_update', step_update: { message: '  still going  ' } }]);
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'text', role: 'assistant', text: 'still going' }),
    ]);
  });

  test('statsFor surfaces the shared token extractor on the stream', () => {
    // Extraction itself is covered in tests/usage.test.ts; this only pins that
    // statsFor wires it up, so the RunView metric and the run index agree.
    const stats = statsFor([
      { event: 'init', init: { model: 'gemini-3.7-flash-medium' } },
      {
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: 'Plan.',
          usage: {
            input_tokens: 63333,
            output_tokens: 2293,
            thinking_tokens: 1213,
            cache_read_tokens: 4000,
            total_tokens: 65626,
          },
        },
      },
    ]);
    expect(stats.usage).toEqual({
      input: 63333,
      cachedInput: 4000,
      cacheWrite: 0,
      output: 2293,
      reasoning: 1213,
      total: 69626,
    });
  });
});

describe('toRows: claude system and tool_result', () => {
  test('permission_denied and rate_limit events become their own rows', () => {
    const rows = toRows([
      { type: 'system', subtype: 'permission_denied', tool_name: 'Bash' },
      { type: 'rate_limit_event', subtype: 'retrying in 2s' },
      { type: 'system', subtype: 'hook' },
    ]);
    expect(rows).toEqual([
      { key: '0', kind: 'denied', detail: 'Bash' },
      { key: '1', kind: 'rate_limit', detail: 'retrying in 2s' },
    ]);
  });

  test('permission_denied without a tool name falls back to unknown tool', () => {
    const rows = toRows([{ type: 'system', subtype: 'permission_denied' }]);
    expect(rows[0]).toEqual({ key: '0', kind: 'denied', detail: 'unknown tool' });
  });

  test('rate_limit_event without a subtype uses a generic label', () => {
    const rows = toRows([{ type: 'rate_limit_event' }]);
    expect(rows[0]).toEqual({ key: '0', kind: 'rate_limit', detail: 'rate limited' });
  });

  test('tool_result content is flattened from a string, a text-block array, or JSON', () => {
    const rows = toRows([
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: 'plain ok' },
            {
              type: 'tool_result',
              content: [{ text: 'first' }, { text: 'second' }],
              is_error: true,
            },
            { type: 'tool_result', content: { exit: 1 } },
            { type: 'tool_result' },
          ],
        },
      },
    ]);
    expect(rows).toEqual([
      { key: '0-0', kind: 'tool_result', detail: 'plain ok', failed: false },
      { key: '0-1', kind: 'tool_result', detail: 'firstsecond', failed: true },
      { key: '0-2', kind: 'tool_result', detail: '{"exit":1}', failed: false },
      { key: '0-3', kind: 'tool_result', detail: '', failed: false },
    ]);
  });
});
