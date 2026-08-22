import { describe, expect, test } from 'bun:test';

import { eventMethod, formatEvent } from '@/reporter';
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
