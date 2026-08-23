import { describe, expect, test } from 'bun:test';

import { actioningLabel, nextAction } from '@/action';

describe('nextAction', () => {
  test('routes by label with stop winning over everything', () => {
    expect(nextAction(['agent:ready'])).toBe('triage');
    expect(nextAction(['agent:approved', 'bug'])).toBe('dev');
    expect(nextAction(['agent:planned', 'agent:replan'])).toBe('replan');
    expect(nextAction(['agent:replan', 'agent:stop'])).toBe('skip');
    expect(nextAction(['agent:ready', 'agent:stop'])).toBe('skip');
    expect(nextAction(['agent:planned'])).toBe('skip');
    expect(nextAction([])).toBe('skip');
  });

  test('actioningLabel is the label nextAction actually selected', () => {
    expect(actioningLabel(['agent:planned', 'agent:replan'])).toBe('agent:replan');
    expect(actioningLabel(['agent:ready', 'agent:approved'])).toBe('agent:ready');
    expect(actioningLabel(['agent:planned'])).toBeUndefined();
  });
});
