import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { CONFIG_SCHEMA_URL } from '@/config';

const DEFAULT_CONFIG = { $schema: CONFIG_SCHEMA_URL, gate: { test: 'bun test' } };

const write = (path: string, value: unknown) =>
  Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Creates (or tops up) the target repo's `.cue/` directory. Returns the list of
 * things it changed so the CLI owns all printing.
 *
 * Safe to re-run: an existing config is only ever touched to add the `$schema`
 * key, and a config we cannot parse is a hard error rather than an overwrite.
 */
export async function scaffold(cwd: string): Promise<string[]> {
  const done: string[] = [];
  await mkdir(join(cwd, '.cue', 'prompts'), { recursive: true });

  const configPath = join(cwd, '.cue', 'config.json');
  const configFile = Bun.file(configPath);
  if (await configFile.exists()) {
    let current: unknown;
    try {
      current = await configFile.json();
    } catch (err) {
      throw new Error(
        '.cue/config.json is not valid JSON — fix or delete it, then re-run cue init',
        { cause: err },
      );
    }
    // Existing projects predate the published schema; top them up in place so
    // editors start autocompleting, but never reformat a config that has it.
    if (typeof current === 'object' && current !== null && !('$schema' in current)) {
      await write(configPath, { $schema: CONFIG_SCHEMA_URL, ...current });
      done.push('added $schema to .cue/config.json — editors now autocomplete it');
    }
  } else {
    await write(configPath, DEFAULT_CONFIG);
    done.push("created .cue/config.json — adjust the gate to this project's test command");
  }

  const gitignorePath = join(cwd, '.gitignore');
  const gitignoreFile = Bun.file(gitignorePath);
  const current = (await gitignoreFile.exists()) ? await gitignoreFile.text() : '';
  if (!current.includes('.cue/runs/')) {
    await Bun.write(gitignorePath, `${current.replace(/\n?$/, '\n')}.cue/runs/\n`);
    done.push('added .cue/runs/ to .gitignore');
  }
  return done;
}
