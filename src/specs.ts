import { stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The spec knowledge layer — living, OpenSpec-format specs plus review-distilled
 * learnings, both plain markdown committed in the target repo. Everything here
 * is presence-detected: a repo opts in by creating the directory or file, so
 * there is deliberately no config field for any of it.
 */

/** Recognized spec roots, in priority order: an existing OpenSpec layout wins. */
const SPEC_ROOTS = ['openspec/specs', '.cue/specs'] as const;

/**
 * The specs directory this repo keeps, as a repo-relative POSIX path for
 * prompts, or null when the repo keeps none (the layer stays fully off).
 */
export async function resolveSpecsDir(root: string): Promise<string | null> {
  for (const rel of SPEC_ROOTS) {
    try {
      if ((await stat(join(root, ...rel.split('/')))).isDirectory()) return rel;
    } catch {
      // Missing path — keep looking.
    }
  }
  return null;
}

const LEARNINGS_REL = ['.cue', 'learnings.md'] as const;

/** Prompts must stay bounded, so only the newest tail of a huge file is injected. */
const LEARNINGS_TAIL = 8000;

/**
 * Recorded learnings: null when `.cue/learnings.md` does not exist (the feature
 * is off), the empty string when it exists but holds nothing yet.
 */
export async function readLearnings(root: string): Promise<string | null> {
  const file = Bun.file(join(root, ...LEARNINGS_REL));
  if (!(await file.exists())) return null;
  return (await file.text()).trim().slice(-LEARNINGS_TAIL);
}

/** The durable bullet lines of a distiller reply — anything else (prose, NONE) is dropped. */
export function extractLessons(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
}

export async function appendLearnings(root: string, lessons: string[]): Promise<void> {
  const file = Bun.file(join(root, ...LEARNINGS_REL));
  const current = (await file.exists()) ? await file.text() : '';
  const head = current.trim() ? `${current.trimEnd()}\n` : '';
  await Bun.write(file, `${head}${lessons.join('\n')}\n`);
}

export function specsPlanGuidance(dir: string): string {
  return `This repository keeps living specs — the source of truth for behavior — in \`${dir}/<capability>/spec.md\` (OpenSpec format: \`### Requirement:\` blocks stating what the system SHALL do, each with \`#### Scenario:\` blocks of WHEN/THEN bullets). Read the capabilities your change touches before planning.

In addition to the structure below, insert a \`## Spec changes\` section between \`## Acceptance criteria\` and \`## Risk\`. When the change alters spec-covered behavior, write the delta in OpenSpec change format — \`## ADDED Requirements\` / \`## MODIFIED Requirements\` / \`## REMOVED Requirements\` subsections carrying the full new requirement text and scenarios — and make acceptance criteria trace to those scenarios. Otherwise write exactly: None.`;
}

export function specsDevGuidance(dir: string): string {
  return `This repository keeps living specs in \`${dir}\` — the source of truth for behavior. The plan's \`## Spec changes\` section is part of the approved change: apply it to the spec files in this same change (create \`<capability>/spec.md\` files as needed, OpenSpec format — \`### Requirement:\` blocks with \`#### Scenario:\` WHEN/THEN bullets), so specs and code ship in one reviewable diff. If the plan's spec changes say None, leave the specs untouched.`;
}

export function specsReviewGuidance(dir: string): string {
  return `This repository keeps living specs in \`${dir}\`. If the plan carries a \`## Spec changes\` section (other than None), verify the diff applies it to the spec files and that the implemented behavior matches the updated specs — report a mismatch as a finding on the spec file.`;
}

/** Wraps recorded learnings for prompt injection. */
export function learningsSection(content: string): string {
  return `Repo learnings recorded from previous review cycles — honor them before writing code:\n\n${content}`;
}

/**
 * The two knowledge-layer prompt variables every stage template renders.
 * Both collapse to empty strings when the repo has not opted in, so the
 * packaged prompts read exactly as before.
 */
export async function knowledgeVars(
  root: string,
  guidance: (dir: string) => string,
): Promise<{ specs_guidance: string; learnings: string }> {
  const dir = await resolveSpecsDir(root);
  const learnings = await readLearnings(root);
  return {
    specs_guidance: dir ? guidance(dir) : '',
    learnings: learnings ? learningsSection(learnings) : '',
  };
}
