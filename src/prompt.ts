import { join } from 'node:path';

import { EMBEDDED_PROMPTS } from '@/embedded';

const FENCE = 'untrusted-data';

/**
 * The runner-owned data boundary around externally-authored text (issue titles
 * and bodies). Stages fence those values before rendering, so every template —
 * packaged or a `.cue/prompts/` override — carries the boundary without its
 * author having to remember it. Fence lookalikes inside the content are
 * neutralized so the content can never close its own boundary.
 */
export function fenceUntrusted(text: string): string {
  const safe = text.replace(new RegExp(`<(/?)${FENCE}>`, 'gi'), `&lt;$1${FENCE}&gt;`);
  return `<${FENCE}>\n${safe}\n</${FENCE}>`;
}

export function renderPrompt(
  template: string,
  vars: Record<string, string>,
  required: string[] = [],
): string {
  // Rendering is single-pass over the template, so a {{placeholder}} inside a
  // substituted value is never expanded.
  for (const name of required) {
    if (!template.includes(`{{${name}}}`))
      throw new Error(
        `prompt template is missing required {{${name}}} — a .cue/prompts override must keep this placeholder`,
      );
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`missing prompt variable: ${name}`);
    return value;
  });
}

// Earlier directories win: [project overrides, packaged defaults]. The prompts
// embedded in the binary are the last resort, so compiled installs work with
// no prompts directory on disk at all.
export async function loadPrompt(dirs: string[], name: string): Promise<string> {
  for (const dir of dirs) {
    const file = Bun.file(join(dir, `${name}.md`));
    if (await file.exists()) return file.text();
  }
  const embedded = EMBEDDED_PROMPTS[name];
  if (embedded) {
    const file = Bun.file(embedded);
    if (await file.exists()) return file.text();
  }
  throw new Error(`prompt not found: ${name}.md (searched: ${dirs.join(', ')}, embedded)`);
}
