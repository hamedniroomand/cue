import { describe, expect, mock, test } from 'bun:test';

/**
 * mock.module is not hoisted, so this file must not statically import
 * `@/configure` — the real `@clack/prompts` would be bound first.
 */
const clack = {
  intro: mock((_message: string) => {}),
  outro: mock((_message: string) => {}),
  isCancel: mock((value: unknown) => value === 'CANCEL'),
  select: mock(async ({ initialValue }: { initialValue: string }) => initialValue),
  text: mock(async ({ initialValue }: { initialValue: string }) => initialValue),
};

await mock.module('@clack/prompts', () => clack);

const { clackAsk, PromptCancelled } = await import('@/configure');

describe('clackAsk', () => {
  test('select and text return the clack value', async () => {
    await expect(clackAsk.select('adapter', [], 'codex')).resolves.toBe('codex');
    await expect(clackAsk.text('test command', 'bun test')).resolves.toBe('bun test');
  });

  test('select and text throw PromptCancelled when clack reports cancel', async () => {
    clack.select.mockImplementationOnce(async () => 'CANCEL');
    await expect(clackAsk.select('adapter', [], 'codex')).rejects.toThrow(PromptCancelled);
    clack.text.mockImplementationOnce(async () => 'CANCEL');
    await expect(clackAsk.text('test command', 'bun test')).rejects.toThrow(PromptCancelled);
  });

  test('begin and end frame the wizard', () => {
    clackAsk.begin?.('Configuring Cue for this repo');
    clackAsk.end?.('adapter codex · test `bun test`');
    expect(clack.intro).toHaveBeenCalled();
    expect(clack.outro).toHaveBeenCalled();
  });
});
