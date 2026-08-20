export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`missing prompt variable: ${name}`);
    return value;
  });
}

// Earlier directories win: [project overrides, packaged defaults].
export async function loadPrompt(dirs: string[], name: string): Promise<string> {
  for (const dir of dirs) {
    const file = Bun.file(`${dir}/${name}.md`);
    if (await file.exists()) return file.text();
  }
  throw new Error(`prompt not found: ${name}.md (searched: ${dirs.join(", ")})`);
}
