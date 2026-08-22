import { describe, expect, test } from 'bun:test';

import { AntigravityAdapter } from '@/adapters/antigravity';
import { ClaudeAdapter } from '@/adapters/claude';
import { CodexAdapter } from '@/adapters/codex';
import { ADAPTERS } from '@/adapters/registry';
import { POSIX } from '@/platform';

import { makeFakeExec } from './helpers/fakeExec';

describe('adapter registry', () => {
  const { exec } = makeFakeExec([]);

  test('constructs the matching adapter for each name', () => {
    expect(ADAPTERS.claude.make(exec, POSIX)).toBeInstanceOf(ClaudeAdapter);
    expect(ADAPTERS.codex.make(exec, POSIX)).toBeInstanceOf(CodexAdapter);
    expect(ADAPTERS.antigravity.make(exec, POSIX)).toBeInstanceOf(AntigravityAdapter);
  });

  test('every adapter ships default models for all three stages', () => {
    for (const info of Object.values(ADAPTERS)) {
      expect(info.defaultModels.triage).toBeTruthy();
      expect(info.defaultModels.dev).toBeTruthy();
      expect(info.defaultModels.review).toBeTruthy();
    }
  });
});
