import { homedir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import type { Exec } from "./exec";

const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));
const repoPattern = v.pipe(v.string(), v.regex(/^[\w.-]+\/[\w.-]+$/, "repo must be org/name"));

// Everything is optional in the file: a project can adopt cue with an
// empty (or absent) .cue/config.json.
const ConfigSchema = v.object({
  repo: v.optional(repoPattern),
  adapter: v.optional(v.picklist(["claude", "codex"]), "claude"),
  models: v.optional(v.object({ triage: v.string(), dev: v.string(), review: v.string() }), {
    triage: "haiku",
    dev: "sonnet",
    review: "sonnet",
  }),
  maxTurns: v.optional(v.object({ triage: positiveInt, dev: positiveInt, review: positiveInt }), {
    triage: 15,
    dev: 60,
    review: 25,
  }),
  reviewFixIterations: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 2),
  gate: v.optional(v.object({ test: v.string(), lint: v.optional(v.string()) }), {
    test: "bun test",
  }),
  // Bash command patterns for dev/fix agents (Claude permission syntax, e.g.
  // "bun *", "git status"). Unset = Bash unrestricted.
  devBashAllowlist: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
  worktreeRoot: v.optional(v.pipe(v.string(), v.minLength(1))),
  baseBranch: v.optional(v.string(), "main"),
  staleClaimMinutes: v.optional(positiveInt, 90),
});

type FileConfig = v.InferOutput<typeof ConfigSchema>;

// The fully-resolved shape every stage consumes: repo detected, cwd bound.
export interface CueConfig extends Omit<FileConfig, "repo" | "worktreeRoot"> {
  repo: string;
  repoPath: string;
  worktreeRoot: string;
}

export function parseRepoFromRemote(url: string): string | null {
  const m = url.trim().match(/[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  return m?.[1] ?? null;
}

async function detectRepo(exec: Exec, cwd: string): Promise<string | null> {
  const r = await exec(["git", "-C", cwd, "remote", "get-url", "origin"]);
  if (r.code !== 0) return null;
  return parseRepoFromRemote(r.stdout);
}

export async function resolveConfig(exec: Exec, cwd: string): Promise<CueConfig> {
  const file = Bun.file(join(cwd, ".cue", "config.json"));
  const raw = (await file.exists()) ? await file.json() : {};
  const cfg = v.parse(ConfigSchema, raw);

  const repo = cfg.repo ?? (await detectRepo(exec, cwd));
  if (!repo)
    throw new Error(
      'cannot determine repo: set "repo" in .cue/config.json or add an origin remote',
    );

  return {
    ...cfg,
    repo,
    repoPath: cwd,
    // Home-dir store: invisible to the project's IDE indexing and tool globs,
    // and no clutter next to the user's other projects.
    worktreeRoot: cfg.worktreeRoot ?? join(homedir(), ".cue", "worktrees", repo.replace("/", "-")),
  };
}
