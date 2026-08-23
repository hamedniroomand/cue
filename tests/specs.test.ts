import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendLearnings,
  extractLessons,
  readLearnings,
  resolveSpecsDir,
  specsDevGuidance,
  specsPlanGuidance,
  specsReviewGuidance,
} from '@/specs';

const tmp = () => mkdtemp(join(tmpdir(), 'cue-specs-'));

describe('resolveSpecsDir', () => {
  test('is null when the repo keeps no specs', async () => {
    expect(await resolveSpecsDir(await tmp())).toBeNull();
  });

  test('finds an OpenSpec layout first', async () => {
    const root = await tmp();
    await mkdir(join(root, 'openspec', 'specs'), { recursive: true });
    await mkdir(join(root, '.cue', 'specs'), { recursive: true });
    expect(await resolveSpecsDir(root)).toBe('openspec/specs');
  });

  test('falls back to .cue/specs', async () => {
    const root = await tmp();
    await mkdir(join(root, '.cue', 'specs'), { recursive: true });
    expect(await resolveSpecsDir(root)).toBe('.cue/specs');
  });

  test('a file with the specs name does not count as a specs dir', async () => {
    const root = await tmp();
    await mkdir(join(root, '.cue'), { recursive: true });
    await Bun.write(join(root, '.cue', 'specs'), 'not a directory');
    expect(await resolveSpecsDir(root)).toBeNull();
  });
});

describe('readLearnings', () => {
  test('is null when .cue/learnings.md does not exist (feature off)', async () => {
    expect(await readLearnings(await tmp())).toBeNull();
  });

  test('is the empty string for an empty file (feature on, nothing yet)', async () => {
    const root = await tmp();
    await Bun.write(join(root, '.cue', 'learnings.md'), '');
    expect(await readLearnings(root)).toBe('');
  });

  test('returns the content, keeping only the newest tail of a huge file', async () => {
    const root = await tmp();
    const old = `- old lesson\n`.repeat(2000);
    await Bun.write(join(root, '.cue', 'learnings.md'), `${old}- newest lesson`);
    const got = (await readLearnings(root))!;
    expect(got.length).toBeLessThanOrEqual(8000);
    expect(got).toContain('- newest lesson');
  });
});

describe('lessons plumbing', () => {
  test('extractLessons keeps only bullet lines', () => {
    expect(
      extractLessons('Sure! Here you go:\n- guard indexed access\n- run oxfmt\nHope it helps'),
    ).toEqual(['- guard indexed access', '- run oxfmt']);
    expect(extractLessons('NONE')).toEqual([]);
    expect(extractLessons('no bullets, just prose')).toEqual([]);
  });

  test('appendLearnings appends to existing content without blank-line drift', async () => {
    const root = await tmp();
    await Bun.write(join(root, '.cue', 'learnings.md'), '- first\n');
    await appendLearnings(root, ['- second']);
    expect(await Bun.file(join(root, '.cue', 'learnings.md')).text()).toBe('- first\n- second\n');
  });

  test('appendLearnings starts a fresh empty file cleanly', async () => {
    const root = await tmp();
    await Bun.write(join(root, '.cue', 'learnings.md'), '');
    await appendLearnings(root, ['- first']);
    expect(await Bun.file(join(root, '.cue', 'learnings.md')).text()).toBe('- first\n');
  });
});

describe('prompt guidance', () => {
  test('names the resolved specs dir and the delta section', () => {
    expect(specsPlanGuidance('openspec/specs')).toContain('openspec/specs');
    expect(specsPlanGuidance('openspec/specs')).toContain('## Spec changes');
    expect(specsDevGuidance('.cue/specs')).toContain('.cue/specs');
    expect(specsReviewGuidance('.cue/specs')).toContain('## Spec changes');
  });
});
