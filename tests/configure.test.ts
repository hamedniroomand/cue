import { describe, expect, test } from 'bun:test';

import { ADAPTERS } from '@/adapters/registry';
import {
  ADAPTER_OPTIONS,
  type Ask,
  formatIssueOptions,
  PromptCancelled,
  promptConfig,
  promptSelectIssue,
  shouldPrompt,
} from '@/configure';
import type { Issue } from '@/github';

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

  test('an unknown pick falls back to the previous adapter, then codex', async () => {
    const fromEmpty = await promptConfig({}, scriptedAsk(['not-an-adapter', 'bun test', '']));
    expect(fromEmpty.config.adapter).toBe('codex');
    const fromClaude = await promptConfig(
      { adapter: 'claude' },
      scriptedAsk(['not-an-adapter', 'bun test', '']),
    );
    expect(fromClaude.config.adapter).toBe('claude');
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

describe('formatIssueOptions', () => {
  const issues: Issue[] = [
    { number: 5, title: 'Old issue', body: '', labels: ['agent:ready'] },
    { number: 42, title: 'Approved feature', body: '', labels: ['agent:approved', 'backend'] },
    { number: 20, title: 'Needs replan', body: '', labels: ['agent:replan'] },
  ];

  test("preserves caller order — sorting is the caller's job", () => {
    const options = formatIssueOptions(issues);
    expect(options.map((o) => o.value)).toEqual(['5', '42', '20']);
  });

  test('formats option labels with number and title', () => {
    const options = formatIssueOptions(issues);
    expect(options.map((o) => o.label)).toEqual([
      '#5 Old issue',
      '#42 Approved feature',
      '#20 Needs replan',
    ]);
  });

  test('formats hints with stage label and target action', () => {
    const options = formatIssueOptions(issues);
    expect(options.map((o) => o.hint)).toEqual([
      'agent:ready → triage',
      'agent:approved → dev',
      'agent:replan → replan',
    ]);
  });

  test('hint is just the action when no agent:* label is actioning', () => {
    const options = formatIssueOptions([{ number: 1, title: 'Other', body: '', labels: ['bug'] }]);
    expect(options[0]?.hint).toBe('skip');
  });

  test('hint uses nextAction priority when several agent:* labels are present', () => {
    const options = formatIssueOptions([
      {
        number: 8,
        title: 'Revise the plan',
        body: '',
        labels: ['agent:planned', 'agent:replan'],
      },
    ]);
    expect(options[0]?.hint).toBe('agent:replan → replan');
  });
});

describe('promptSelectIssue', () => {
  const issues: Issue[] = [
    { number: 10, title: 'First', body: '', labels: ['agent:ready'] },
    { number: 25, title: 'Second', body: '', labels: ['agent:approved'] },
  ];

  test('returns undefined when issues list is empty', async () => {
    const ask = scriptedAsk([]);
    const selected = await promptSelectIssue([], ask);
    expect(selected).toBeUndefined();
    expect(ask.asked).toHaveLength(0);
  });

  test('pre-selects the newest issue as initial and returns selected issue', async () => {
    const ask = scriptedAsk(['10']);
    const selected = await promptSelectIssue(issues, ask);
    expect(ask.initials[0]).toBe('25'); // newest issue #25 is initial
    expect(selected).toEqual(issues[0]); // picked #10
  });

  test('returns the newest issue when accepting default initial', async () => {
    const ask = scriptedAsk([]);
    const selected = await promptSelectIssue(issues, ask);
    expect(selected).toEqual(issues[1]); // issue #25
  });

  test('throws PromptCancelled when ask cancels', async () => {
    const cancelAsk: Ask = {
      select() {
        throw new PromptCancelled();
      },
      text() {
        throw new PromptCancelled();
      },
    };
    await expect(promptSelectIssue(issues, cancelAsk)).rejects.toThrow(PromptCancelled);
  });
});
