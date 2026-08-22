import { describe, expect, test } from 'bun:test';

import { createSpinner, withSpinner } from '@/spinner';

/** Records what a real ora instance would have been told to do. */
function fakeOra(initial = '') {
  const calls: string[] = [];
  let text = initial;
  const instance = {
    calls,
    get text() {
      return text;
    },
    set text(v: string) {
      text = v;
      calls.push(`text:${v}`);
    },
    isSpinning: false,
    start(t?: string) {
      instance.isSpinning = true;
      calls.push(`start:${t ?? text}`);
      return instance;
    },
    stop() {
      instance.isSpinning = false;
      calls.push('stop');
      return instance;
    },
    succeed(t?: string) {
      instance.isSpinning = false;
      calls.push(`succeed:${t ?? text}`);
      return instance;
    },
    fail(t?: string) {
      instance.isSpinning = false;
      calls.push(`fail:${t ?? text}`);
      return instance;
    },
  };
  return instance;
}

// Real ora takes its text at construction, so the fake models that too:
// `make(text)` seeds it and a bare `.start()` reuses it.
function harness() {
  const ora = fakeOra();
  return {
    ora,
    spinner: createSpinner({
      enabled: true,
      make: (text) => {
        ora.text = text;
        ora.calls.pop(); // constructor text is not a call the spinner made
        return ora as never;
      },
    }),
  };
}

describe('createSpinner (enabled)', () => {
  test('start, update, succeed drive the underlying spinner', () => {
    const { ora, spinner } = harness();
    spinner.start('scanning');
    spinner.update('3 actionable');
    spinner.succeed('done');
    expect(ora.calls).toEqual(['start:scanning', 'text:3 actionable', 'succeed:done']);
  });

  test('interject pauses the frame around the print, then resumes it', () => {
    const { ora, spinner } = harness();
    spinner.start('scanning');
    spinner.interject(() => ora.calls.push('printed a line'));
    expect(ora.calls).toEqual(['start:scanning', 'stop', 'printed a line', 'start:scanning']);
  });

  test('interject with nothing spinning just prints — no stray frame is started', () => {
    const { ora, spinner } = harness();
    spinner.interject(() => ora.calls.push('printed a line'));
    expect(ora.calls).toEqual(['printed a line']);
  });

  test('succeed and fail on an idle spinner are no-ops, never a stray symbol', () => {
    const { ora, spinner } = harness();
    spinner.succeed('nothing was running');
    spinner.fail('nor here');
    expect(ora.calls).toEqual([]);
  });

  test('spinning tracks whether a frame is live', () => {
    const { spinner } = harness();
    expect(spinner.spinning).toBe(false);
    spinner.start('scanning');
    expect(spinner.spinning).toBe(true);
    spinner.succeed('done');
    expect(spinner.spinning).toBe(false);
  });

  test('a second start replaces the first instead of stacking frames', () => {
    const { ora, spinner } = harness();
    spinner.start('first');
    spinner.start('second');
    expect(ora.calls).toEqual(['start:first', 'stop', 'start:second']);
  });
});

describe('createSpinner (disabled — no TTY, CI, piped output)', () => {
  test('never constructs a spinner and lets interject print straight through', () => {
    let made = 0;
    const spinner = createSpinner({
      enabled: false,
      make: () => {
        made++;
        return fakeOra() as never;
      },
    });
    const printed: string[] = [];
    spinner.start('scanning');
    spinner.update('3 actionable');
    spinner.interject(() => printed.push('line'));
    spinner.succeed('done');
    expect(made).toBe(0);
    expect(printed).toEqual(['line']);
  });
});

describe('withSpinner', () => {
  test('succeeds with the same text and returns the wrapped value', async () => {
    const { ora, spinner } = harness();
    const value = await withSpinner(spinner, 'fetching issues', async () => 42);
    expect(value).toBe(42);
    expect(ora.calls).toEqual(['start:fetching issues', 'succeed:fetching issues']);
  });

  test('a throwing task fails the spinner and rethrows — no frame is left spinning', async () => {
    const { ora, spinner } = harness();
    const boom = withSpinner(spinner, 'fetching issues', async () => {
      throw new Error('gh exploded');
    });
    await expect(boom).rejects.toThrow('gh exploded');
    expect(ora.calls).toEqual(['start:fetching issues', 'fail:fetching issues']);
    expect(ora.isSpinning).toBe(false);
  });
});
