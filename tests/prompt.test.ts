import { describe, expect, test } from 'bun:test';

import { loadPrompt, renderPrompt } from '@/prompt';

describe('renderPrompt', () => {
  test('substitutes all variables', () => {
    expect(renderPrompt('Hi {{name}}, issue {{n}}', { name: 'dev', n: '7' })).toBe(
      'Hi dev, issue 7',
    );
  });

  test('throws when a variable is missing', () => {
    expect(() => renderPrompt('{{gone}}', {})).toThrow('missing prompt variable: gone');
  });
});

describe('loadPrompt', () => {
  test('loads each shipped role prompt with its required placeholders', async () => {
    const required: Record<string, string[]> = {
      triage: ['{{issue_number}}', '{{issue_title}}', '{{issue_body}}'],
      dev: ['{{issue_title}}', '{{issue_body}}', '{{plan}}'],
      review: ['{{plan}}', '{{diff}}'],
      fix: ['{{failure_output}}'],
      replan: [
        '{{issue_number}}',
        '{{issue_title}}',
        '{{issue_body}}',
        '{{previous_plan}}',
        '{{feedback}}',
      ],
    };
    for (const [name, vars] of Object.entries(required)) {
      const text = await loadPrompt(['prompts'], name);
      for (const v of vars) expect(text).toContain(v);
    }
  });

  test('earlier directories win: project overrides beat packaged defaults', async () => {
    const overrideDir = `${import.meta.dir}/fixtures/prompt-override`;
    const text = await loadPrompt([overrideDir, 'prompts'], 'triage');
    expect(text).toContain('PROJECT OVERRIDE');
    const fallback = await loadPrompt([overrideDir, 'prompts'], 'dev');
    expect(fallback).toContain('{{plan}}'); // not overridden → packaged default
  });

  test('throws for a missing prompt', async () => {
    await expect(loadPrompt(['prompts'], 'nope')).rejects.toThrow('prompt not found');
  });
});
