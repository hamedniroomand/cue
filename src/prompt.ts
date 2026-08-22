export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`missing prompt variable: ${name}`);
    return value;
  });
}

import { join } from "node:path";
import { EMBEDDED_PROMPTS } from "./embedded";

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
  throw new Error(`prompt not found: ${name}.md (searched: ${dirs.join(", ")}, embedded)`);
}
