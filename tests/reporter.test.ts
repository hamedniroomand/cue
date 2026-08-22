import { describe, expect, test } from 'bun:test';

import { eventMethod, formatEvent, makeEventPrinter } from '@/reporter';
import type { Spinner } from '@/spinner';
import type { CueEvent } from '@/stages/context';

const strip = (s: string) => s.replace(/\[[0-9;]*m/g, '');

function event(overrides: Partial<CueEvent> = {}): CueEvent {
  return {
    ts: new Date(2026, 7, 22, 9, 5, 3).getTime(),
    issue: 12,
    stage: 'triage',
    kind: 'progress',
    message: 'reading issue body',
    ...overrides,
  };
}

describe('eventMethod', () => {
  test('maps event kinds to consola methods', () => {
    expect(eventMethod('start')).toBe('start');
    expect(eventMethod('done')).toBe('success');
    expect(eventMethod('error')).toBe('error');
    expect(eventMethod('progress')).toBe('log');
  });
});

describe('formatEvent', () => {
  test('renders time, stage tag with issue number, and message', () => {
    expect(strip(formatEvent(event()))).toBe('09:05:03 triage #12 reading issue body');
  });

  test('omits the issue number when it is zero', () => {
    expect(
      strip(formatEvent(event({ issue: 0, stage: 'poll', message: '3 issues actionable' }))),
    ).toBe('09:05:03 poll 3 issues actionable');
  });

  test('keeps unknown stages printable', () => {
    expect(strip(formatEvent(event({ stage: 'review-fix', message: 'attempt 2' })))).toBe(
      '09:05:03 review-fix #12 attempt 2',
    );
  });
});

/** A Spinner that records the calls a real one would have animated. */
function fakeSpinner(enabled: boolean) {
  const calls: string[] = [];
  let live = false;
  const spinner: Spinner = {
    enabled,
    get spinning() {
      return live;
    },
    start(text) {
      live = true;
      calls.push(`start:${strip(text)}`);
    },
    update(text) {
      calls.push(`update:${strip(text)}`);
    },
    succeed(text) {
      live = false;
      calls.push(`succeed:${strip(text)}`);
    },
    fail(text) {
      live = false;
      calls.push(`fail:${strip(text)}`);
    },
    interject(print) {
      calls.push('interject');
      print();
    },
  };
  return { spinner, calls };
}

describe('makeEventPrinter', () => {
  test("poll's fetch window drives the spinner; the queue summary resolves it", () => {
    const { spinner, calls } = fakeSpinner(true);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning acme/widgets' }));
    print(event({ issue: 0, stage: 'poll', kind: 'progress', message: '3 actionable' }));
    expect(calls).toEqual([
      'start:09:05:03 poll scanning acme/widgets',
      'succeed:09:05:03 poll 3 actionable',
    ]);
  });

  test("poll's closing summary prints as a line — the frame is long gone", () => {
    const { spinner, calls } = fakeSpinner(true);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning' }));
    print(event({ issue: 0, stage: 'poll', kind: 'progress', message: '1 actionable' }));
    print(event({ issue: 0, stage: 'poll', kind: 'done', message: 'poll finished: 1 processed' }));
    expect(calls.at(-1)).toBe('interject');
  });

  test('an empty queue ends the live frame instead of leaving it spinning', () => {
    const { spinner, calls } = fakeSpinner(true);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning' }));
    print(event({ issue: 0, stage: 'poll', kind: 'done', message: 'nothing to do' }));
    expect(calls).toEqual(['start:09:05:03 poll scanning', 'succeed:09:05:03 poll nothing to do']);
    expect(spinner.spinning).toBe(false);
  });

  test('a failing poll ends the frame with a failure, not a tick', () => {
    const { spinner, calls } = fakeSpinner(true);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning' }));
    print(event({ issue: 0, stage: 'poll', kind: 'error', message: 'gh exploded' }));
    expect(calls.at(-1)).toBe('fail:09:05:03 poll gh exploded');
  });

  test('stage events park the frame and print — they are never swallowed', () => {
    const { spinner, calls } = fakeSpinner(true);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning' }));
    print(event({ stage: 'cleanup', kind: 'done', message: 'merged' }));
    expect(calls).toEqual(['start:09:05:03 poll scanning', 'interject']);
    expect(spinner.spinning).toBe(true); // interject resumes, it does not resolve
  });

  test('with the spinner disabled every event prints, poll included', () => {
    const { spinner, calls } = fakeSpinner(false);
    const print = makeEventPrinter(spinner);
    print(event({ issue: 0, stage: 'poll', kind: 'start', message: 'scanning' }));
    print(event({ stage: 'triage', kind: 'progress', message: 'reading issue' }));
    expect(calls).toEqual(['interject', 'interject']);
  });
});
