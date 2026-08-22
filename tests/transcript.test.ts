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
});
