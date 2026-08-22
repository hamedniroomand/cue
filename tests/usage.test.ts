import { describe, expect, test } from 'bun:test';

import {
  extractUsage,
  formatTokenBreakdown,
  formatTokens,
  type TokenUsage,
} from '@/adapters/usage';

/** The invariant the whole module exists to guarantee. */
function expectDisjoint(usage: TokenUsage | undefined): TokenUsage {
  expect(usage).toBeDefined();
  const u = usage!;
  expect(u.input + u.cachedInput + u.cacheWrite + u.output).toBe(u.total);
  expect(u.reasoning).toBeLessThanOrEqual(u.output);
  return u;
}

describe('extractUsage: claude', () => {
  // Verbatim shape of a recorded `claude -p` result event.
  const claudeResult = {
    type: 'result',
    subtype: 'success',
    result: 'Done.',
    total_cost_usd: 0.0743,
    usage: {
      input_tokens: 73,
      cache_creation_input_tokens: 15283,
      cache_read_input_tokens: 283110,
      output_tokens: 3074,
      output_tokens_details: { thinking_tokens: 2011 },
    },
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 73,
        outputTokens: 3074,
        cacheReadInputTokens: 283110,
        cacheCreationInputTokens: 15283,
        costUSD: 0.0743,
      },
    },
  };

  test('reads the disjoint usage fields and computes the total itself', () => {
    const u = expectDisjoint(extractUsage([claudeResult]));
    expect(u).toEqual({
      input: 73,
      cachedInput: 283110,
      cacheWrite: 15283,
      output: 3074,
      reasoning: 2011,
      total: 301540,
    });
  });

  test('falls back to modelUsage, summing across models', () => {
    const { usage: _dropped, ...noUsage } = claudeResult;
    const u = expectDisjoint(
      extractUsage([
        {
          ...noUsage,
          modelUsage: {
            ...claudeResult.modelUsage,
            'claude-sonnet-5': {
              inputTokens: 24,
              outputTokens: 2454,
              cacheReadInputTokens: 556909,
              cacheCreationInputTokens: 22694,
              costUSD: 0.327,
            },
          },
        },
      ]),
    );
    expect(u).toEqual({
      input: 97,
      cachedInput: 840019,
      cacheWrite: 37977,
      output: 5528,
      reasoning: 0,
      total: 883621,
    });
  });

  test('accepts a legacy single-object result, not just an array', () => {
    expect(extractUsage(claudeResult)?.total).toBe(301540);
  });
});

describe('extractUsage: antigravity', () => {
  // Recorded `agy -p` dev run. Note total_tokens is 159932 — input + output
  // only — while 649148 cache reads sit outside it. We must NOT trust that.
  const agyResult = {
    event: 'result',
    result: {
      status: 'SUCCESS',
      response: 'Done.',
      usage: {
        input_tokens: 148900,
        output_tokens: 11032,
        thinking_tokens: 6860,
        cache_read_tokens: 649148,
        total_tokens: 159932,
      },
    },
  };

  test('ignores the reported total, which excludes cache reads', () => {
    const u = expectDisjoint(extractUsage([agyResult]));
    expect(u).toEqual({
      input: 148900,
      cachedInput: 649148,
      cacheWrite: 0,
      output: 11032,
      reasoning: 6860,
      total: 809080,
    });
    expect(u.total).not.toBe(159932);
  });

  test('handles a run that read nothing from cache', () => {
    const u = expectDisjoint(
      extractUsage([
        {
          event: 'result',
          result: {
            usage: {
              input_tokens: 63333,
              output_tokens: 2293,
              thinking_tokens: 1213,
              cache_read_tokens: 0,
              total_tokens: 65626,
            },
          },
        },
      ]),
    );
    expect(u.total).toBe(65626);
    expect(u.cachedInput).toBe(0);
  });
});

describe('extractUsage: codex', () => {
  test('unnests cached_input_tokens from input_tokens across turns', () => {
    const u = expectDisjoint(
      extractUsage([
        { type: 'turn.started' },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 1000,
            cached_input_tokens: 400,
            output_tokens: 250,
            reasoning_output_tokens: 100,
            total_tokens: 1250,
          },
        },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 2000,
            cached_input_tokens: 1500,
            output_tokens: 300,
            reasoning_output_tokens: 120,
            total_tokens: 2300,
          },
        },
      ]),
    );
    expect(u).toEqual({
      input: 1100,
      cachedInput: 1900,
      cacheWrite: 0,
      output: 550,
      reasoning: 220,
      total: 3550,
    });
  });

  test('clamps rather than going negative if cache ever exceeds input', () => {
    const u = expectDisjoint(
      extractUsage([
        {
          type: 'turn.completed',
          usage: { input_tokens: 100, cached_input_tokens: 900, output_tokens: 50 },
        },
      ]),
    );
    expect(u).toEqual({
      input: 0,
      cachedInput: 900,
      cacheWrite: 0,
      output: 50,
      reasoning: 0,
      total: 950,
    });
  });
});

describe('extractUsage: nothing to report', () => {
  test.each([
    ['null', null],
    ['an empty array', []],
    ['a stream with no terminal event', [{ type: 'item.completed' }]],
    ['a result event with no usage', [{ type: 'result', result: 'Done.' }]],
    ['an all-zero usage', [{ type: 'result', usage: { input_tokens: 0, output_tokens: 0 } }]],
  ])('returns undefined for %s', (_label, result) => {
    expect(extractUsage(result)).toBeUndefined();
  });

  test('ignores garbage field values instead of producing NaN', () => {
    const u = extractUsage([
      { type: 'result', usage: { input_tokens: 'lots', output_tokens: -5, cache_read_tokens: 10 } },
    ]);
    expect(u).toBeUndefined();
  });
});

describe('formatting', () => {
  test('formatTokens picks a readable suffix', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(65626)).toBe('65.6k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  test('formatTokenBreakdown lists only the disjoint parts, in summing order', () => {
    expect(
      formatTokenBreakdown({
        input: 73,
        cachedInput: 283110,
        cacheWrite: 15283,
        output: 3074,
        reasoning: 2011,
        total: 301540,
      }),
    ).toBe('73 in · 283.1k cached · 15.3k written · 3.1k out');
  });

  test('omits cache segments an adapter never reports', () => {
    expect(
      formatTokenBreakdown({
        input: 100,
        cachedInput: 0,
        cacheWrite: 0,
        output: 25,
        reasoning: 0,
        total: 125,
      }),
    ).toBe('100 in · 25 out');
  });
});
