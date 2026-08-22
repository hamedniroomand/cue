import { describe, expect, test } from 'bun:test';

import { ADAPTERS } from '@/adapters/registry';
import { ADAPTER_OPTIONS, type Ask, promptConfig, shouldPrompt } from '@/configure';

/**
 * Replays scripted answers and records what the wizard offered, so the
 * pre-filled initials are asserted rather than assumed.
 */
function scriptedAsk(answers: string[]): Ask & { asked: string[]; initials: string[] } {
  const asked: string[] = [];
  const initials: string[] = [];
  let i = 0;
  const next = (initial: string) => {
    initials.push(initial);
    const answer = answers[i++];
    return Promise.resolve(answer ?? initial);
  };
  return {
    asked,
    initials,
    select(message, _options, initial) {
      asked.push(message);
      return next(initial);
    },
    text(message, initial) {
      asked.push(message);
      return next(initial);
    },
  };
}

describe('promptConfig', () => {
  test('asks adapter, test and lint — in that order, nothing else', async () => {
    const ask = scriptedAsk(['claude', 'npm test', 'npm run lint']);
    const { config } = await promptConfig({}, ask);
    expect(ask.asked).toHaveLength(3);
    expect(config).toEqual({
      adapter: 'claude',
      gate: { test: 'npm test', lint: 'npm run lint' },
    });
  });

  test('a fresh repo is pre-filled with the shipped defaults', async () => {
    const ask = scriptedAsk([]);
    const { config } = await promptConfig({}, ask);
    expect(ask.initials).toEqual(['codex', 'bun test', '']);
    expect(config).toEqual({ adapter: 'codex', gate: { test: 'bun test' } });
  });

  test('an existing config is pre-filled with its own values', async () => {
    const ask = scriptedAsk([]);
    const current = { adapter: 'claude', gate: { test: 'npm test', lint: 'npm run lint' } };
    const { config } = await promptConfig(current, ask);
    expect(ask.initials).toEqual(['claude', 'npm test', 'npm run lint']);
    // Accepting every default must round-trip unchanged, or re-running init
    // would silently rewrite a tuned config.
    expect(config).toEqual(current);
  });

  test('the agy alias pre-selects antigravity and is written canonically', async () => {
    const ask = scriptedAsk([]);
    const { config } = await promptConfig({ adapter: 'agy' }, ask);
    expect(ask.initials[0]).toBe('antigravity');
    expect(config.adapter).toBe('antigravity');
  });

  test('a blank lint answer omits the key instead of writing an empty command', async () => {
    const ask = scriptedAsk(['codex', 'bun test', '   ']);
    const { config } = await promptConfig({ gate: { test: 'bun test', lint: 'old lint' } }, ask);
    expect(config.gate).toEqual({ test: 'bun test' });
  });

  test('a blank test answer keeps the pre-filled command — the gate is required', async () => {
    const ask = scriptedAsk(['codex', '', '']);
    const { config } = await promptConfig({ gate: { test: 'npm test' } }, ask);
    expect(config.gate).toEqual({ test: 'npm test' });
  });

  test('switching adapter drops models: the old names mean nothing to the new CLI', async () => {
    const ask = scriptedAsk(['codex']);
    const current = {
      adapter: 'claude',
      models: { triage: 'haiku', dev: 'sonnet', review: 'sonnet' },
      gate: { test: 'bun test' },
    };
    const { config, notes } = await promptConfig(current, ask);
    expect(config.models).toBeUndefined();
    expect(notes.join('\n')).toContain('models');
  });

  test('keeping the adapter keeps models exactly as they were', async () => {
    const ask = scriptedAsk([]);
    const models = { triage: 'haiku', dev: 'sonnet', review: 'sonnet' };
    const { config, notes } = await promptConfig({ adapter: 'claude', models }, ask);
    expect(config.models).toEqual(models);
    expect(notes).toEqual([]);
  });

  test('unrelated fields survive the wizard untouched', async () => {
    const ask = scriptedAsk(['codex', 'bun test', '']);
    const { config } = await promptConfig(
      { $schema: 'https://example/schema.json', baseBranch: 'develop', staleClaimMinutes: 30 },
      ask,
    );
    expect(config.$schema).toBe('https://example/schema.json');
    expect(config.baseBranch).toBe('develop');
    expect(config.staleClaimMinutes).toBe(30);
  });
});

describe('promptConfig framing', () => {
  test('brackets the run and summarizes the outcome when the backend supports it', async () => {
    const framed: string[] = [];
    const base = scriptedAsk(['claude', 'npm test', 'npm run lint']);
    const ask: Ask = {
      ...base,
      begin: (m) => framed.push(`begin:${m}`),
      end: (m) => framed.push(`end:${m}`),
    };
    await promptConfig({}, ask);
    expect(framed[0]).toContain('begin:');
    expect(framed[1]).toBe('end:adapter claude · test `npm test` · lint `npm run lint`');
  });

  test('omits lint from the summary when there is none', async () => {
    const framed: string[] = [];
    const base = scriptedAsk(['codex', 'bun test', '']);
    await promptConfig({}, { ...base, end: (m) => framed.push(m) });
    expect(framed[0]).toBe('adapter codex · test `bun test`');
  });

  test('a backend with no framing hooks still works — they are optional', async () => {
    const { config } = await promptConfig({}, scriptedAsk(['codex', 'bun test', '']));
    expect(config.adapter).toBe('codex');
  });
});

describe('ADAPTER_OPTIONS', () => {
  test('offers every canonical adapter and never the agy alias', () => {
    expect(ADAPTER_OPTIONS.map((o) => o.value)).toEqual(['codex', 'antigravity', 'claude']);
  });

  // The registry is the one place that knows which adapters exist; a new entry
  // there must not be silently missing from the wizard.
  test('covers the adapter registry exactly', () => {
    const offered = ADAPTER_OPTIONS.map((o) => o.value).toSorted();
    expect(offered).toEqual(Object.keys(ADAPTERS).toSorted());
  });

  test('every option is labelled and hinted with the CLI it runs', () => {
    for (const option of ADAPTER_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('shouldPrompt', () => {
  const tty = { stdin: true, stdout: true };

  test('asks only when both streams are a terminal', () => {
    expect(shouldPrompt([], tty)).toBe(true);
  });

  test.each([
    ['stdout piped', { stdin: true, stdout: false }],
    ['stdin redirected', { stdin: false, stdout: true }],
    ['neither (CI)', { stdin: false, stdout: false }],
    ['undefined, as node reports for a pipe', {}],
  ])('stays silent when %s', (_label, streams) => {
    expect(shouldPrompt([], streams)).toBe(false);
  });

  test.each([['--yes'], ['-y']])('%s wins even on a full terminal', (flag) => {
    expect(shouldPrompt([flag], tty)).toBe(false);
  });

  test('unrelated flags do not suppress the questions', () => {
    expect(shouldPrompt(['--no-open'], tty)).toBe(true);
  });
});
