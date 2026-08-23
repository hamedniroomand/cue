import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { CONFIG_SCHEMA_URL } from '@/config';

const DEFAULT_CONFIG = { gate: { test: 'bun test' } };

const configPathOf = (cwd: string) => join(cwd, '.cue', 'config.json');

/** `$schema` first so editors pick it up without scrolling, then everything else. */
const serialize = (config: Record<string, unknown>) => {
  const { $schema: _ignored, ...rest } = config;
  return `${JSON.stringify({ $schema: CONFIG_SCHEMA_URL, ...rest }, null, 2)}\n`;
};

/**
 * The config file exactly as written, unvalidated — `resolveConfig` is the
 * validating reader. This one exists so the init wizard can pre-fill its
 * prompts from whatever is on disk, including fields it does not ask about.
 */
export async function readRawConfig(cwd: string): Promise<Record<string, unknown>> {
  const file = Bun.file(configPathOf(cwd));
  if (!(await file.exists())) return {};
  let parsed: unknown;
  try {
    parsed = await file.json();
  } catch (err) {
    throw new Error('.cue/config.json is not valid JSON — fix or delete it, then re-run cue init', {
      cause: err,
    });
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

export interface ScaffoldOptions {
  /**
   * Create an empty `.cue/learnings.md`, arming the review stage's retrospective.
   * Only ever creates: an existing file may hold recorded lessons, and `init` is
   * documented as safe to re-run.
   */
  learnings?: boolean;
}

/**
 * Creates (or tops up) the target repo's `.cue/` directory. Returns the list of
 * things it changed so the CLI owns all printing.
 *
 * Safe to re-run. With no `config`, an existing file is only ever touched to add
 * the `$schema` key. With one (the init wizard's answers), the file is rewritten
 * only when the result actually differs — accepting every pre-filled answer
 * leaves it byte-identical.
 */
export async function scaffold(
  cwd: string,
  config?: Record<string, unknown>,
  options: ScaffoldOptions = {},
): Promise<string[]> {
  const done: string[] = [];
  await mkdir(join(cwd, '.cue', 'prompts'), { recursive: true });

  const configPath = configPathOf(cwd);
  const existing = await Bun.file(configPath);
  const had = await existing.exists();
  const current = await readRawConfig(cwd);

  if (config) {
    const next = serialize(config);
    if (!had || (await existing.text()) !== next) {
      await Bun.write(configPath, next);
      done.push(
        had
          ? 'updated .cue/config.json'
          : "created .cue/config.json — adjust the gate to this project's test command",
      );
    }
  } else if (had) {
    // Existing projects predate the published schema; top them up in place so
    // editors start autocompleting, but never reformat a config that has it.
    if (current.$schema !== CONFIG_SCHEMA_URL) {
      await Bun.write(configPath, serialize(current));
      done.push('added $schema to .cue/config.json — editors now autocomplete it');
    }
  } else {
    await Bun.write(configPath, serialize(DEFAULT_CONFIG));
    done.push("created .cue/config.json — adjust the gate to this project's test command");
  }

  // Deliberately not gitignored: dev, revise and review read this file from the
  // worktree, which is created from origin — an uncommitted one is invisible there.
  if (options.learnings) {
    const learnings = Bun.file(join(cwd, '.cue', 'learnings.md'));
    if (!(await learnings.exists())) {
      await Bun.write(learnings, '');
      done.push('created .cue/learnings.md — commit it so worktrees can see it');
    }
  }

  const gitignorePath = join(cwd, '.gitignore');
  const gitignoreFile = Bun.file(gitignorePath);
  const gitignore = (await gitignoreFile.exists()) ? await gitignoreFile.text() : '';
  if (!gitignore.includes('.cue/runs/')) {
    await Bun.write(gitignorePath, `${gitignore.replace(/\n?$/, '\n')}.cue/runs/\n`);
    done.push('added .cue/runs/ to .gitignore');
  }
  return done;
}
