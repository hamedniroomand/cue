import { homedir } from 'node:os';
import { join } from 'node:path';

import * as v from 'valibot';

import { ADAPTERS, type AdapterName } from '@/adapters/registry';
import type { Exec } from '@/exec';

const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));
const repoPattern = v.pipe(v.string(), v.regex(/^[\w.-]+\/[\w.-]+$/, 'repo must be org/name'));

/**
 * Where the published JSON Schema lives in this repo. VitePress resolves its
 * publicDir under `srcDir`, so it must sit in docs/content/public/ — files in
 * docs/public/ are NOT copied to the site root. From here it publishes to
 * CONFIG_SCHEMA_URL.
 */
export const CONFIG_SCHEMA_PATH = 'docs/content/public/schema/config.json';

/**
 * Absolute URL of the published schema — written into scaffolded configs as
 * "$schema" for editor autocompletion. It must stay an https URL: a path into
 * the package would not survive `bun build --compile` release binaries.
 * The schema itself is a hand-written mirror of ConfigSchema below, kept
 * honest by tests/schema.test.ts.
 */
export const CONFIG_SCHEMA_URL = 'https://hamedniroomand.github.io/cue/schema/config.json';

// Everything is optional in the file: a project can adopt cue with an
// empty (or absent) .cue/config.json.
export const ConfigSchema = v.object({
  repo: v.optional(repoPattern),
  adapter: v.optional(v.picklist(['claude', 'antigravity', 'agy', 'codex']), 'codex'),
  models: v.optional(v.object({ triage: v.string(), dev: v.string(), review: v.string() })),
  maxTurns: v.optional(v.object({ triage: positiveInt, dev: positiveInt, review: positiveInt }), {
    triage: 15,
    dev: 60,
    review: 25,
  }),
  reviewFixIterations: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 2),
  gate: v.optional(v.object({ test: v.string(), lint: v.optional(v.string()) }), {
    test: 'bun test',
  }),
  // Bash command patterns for dev/fix agents (Claude permission syntax, e.g.
  // "bun *", "git status"). Unset = Bash unrestricted.
  devBashAllowlist: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
  worktreeRoot: v.optional(v.pipe(v.string(), v.minLength(1))),
  baseBranch: v.optional(v.string(), 'main'),
  staleClaimMinutes: v.optional(positiveInt, 90),
  // POSTed a JSON notification when a plan awaits approval or a draft PR
  // awaits merge. Slack- and Discord-compatible payload; best-effort only.
  webhookUrl: v.optional(v.pipe(v.string(), v.url())),
});

type FileConfig = v.InferOutput<typeof ConfigSchema>;

// The fully-resolved shape every stage consumes: repo detected, cwd bound,
// the "agy" alias normalized away.
export interface CueConfig extends Omit<
  FileConfig,
  'repo' | 'worktreeRoot' | 'models' | 'adapter'
> {
  repo: string;
  repoPath: string;
  worktreeRoot: string;
  adapter: AdapterName;
  models: { triage: string; dev: string; review: string };
}

export function parseRepoFromRemote(url: string): string | null {
  const m = url.trim().match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return m?.[1] ?? null;
}

async function detectRepo(exec: Exec, cwd: string): Promise<string | null> {
  const r = await exec(['git', '-C', cwd, 'remote', 'get-url', 'origin']);
  if (r.code !== 0) return null;
  return parseRepoFromRemote(r.stdout);
}

export async function resolveConfig(exec: Exec, cwd: string): Promise<CueConfig> {
  const file = Bun.file(join(cwd, '.cue', 'config.json'));
  const raw = (await file.exists()) ? await file.json() : {};
  const cfg = v.parse(ConfigSchema, raw);

  const repo = cfg.repo ?? (await detectRepo(exec, cwd));
  if (!repo)
    throw new Error(
      'cannot determine repo: set "repo" in .cue/config.json or add an origin remote',
    );

  const adapter: AdapterName = cfg.adapter === 'agy' ? 'antigravity' : cfg.adapter;
  // Model names only mean something relative to an adapter, and the default
  // adapter has changed before — explicit models with an implicit adapter is
  // how "sonnet" ends up handed to codex.
  const adapterIsExplicit = typeof raw === 'object' && raw !== null && 'adapter' in raw;
  if (cfg.models && !adapterIsExplicit)
    throw new Error(
      '"models" is set but "adapter" is not: model names are adapter-specific, ' +
        'so set "adapter" explicitly in .cue/config.json',
    );

  return {
    ...cfg,
    adapter,
    models: cfg.models ?? ADAPTERS[adapter].defaultModels,
    repo,
    repoPath: cwd,
    // Home-dir store: invisible to the project's IDE indexing and tool globs,
    // and no clutter next to the user's other projects.
    worktreeRoot: cfg.worktreeRoot ?? join(homedir(), '.cue', 'worktrees', repo.replace('/', '-')),
  };
}
