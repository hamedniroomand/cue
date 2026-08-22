# Commands

Every command runs **from inside the target repo** (cwd is the project Cue should act on). The repo is auto-detected from the `origin` remote unless you set `repo` in `.cue/config.json`.

```bash
cue --help
cue --version
```

## init

```bash
cue init
```

Creates the `agent:*` labels on the GitHub repo and scaffolds `.cue/` in the current directory:

- `.cue/config.json` — written only if missing, default `{ "gate": { "test": "bun test" } }`
- `.cue/prompts/` — empty directory for optional prompt overrides
- `.cue/runs/` added to `.gitignore` if it is not already listed

Safe to re-run: existing config is left alone; labels that already exist are skipped.

## poll

```bash
cue poll
```

The main loop. It:

1. Reconciles finished PRs ([cleanup](#cleanup)).
2. Lists issues labeled `agent:ready`, `agent:replan`, or `agent:approved`.
3. Runs the next stage for each one.

Use this after you label work, after you approve a plan, and after you merge.

## run

```bash
cue run 42
```

Runs the next pipeline stage for a single issue. The issue must be in an actionable state: `agent:ready`, `agent:approved`, or `agent:replan`.

Useful when you want to drive one issue without scanning the whole board.

## cleanup

```bash
cue cleanup
```

Reconciles merged and closed PRs for Cue-managed issues:

- merged → `agent:done`
- closed unmerged → `agent:failed`
- worktree and local `agent/issue-<n>` branch removed either way

Also runs at the start of every `poll`. Call it on its own if you merged on GitHub and want local worktrees gone without kicking the rest of the pipeline.

## status

```bash
cue status
```

Prints issues in each active pipeline state, local spend per issue (from `.cue/runs/`), and the worktree root.

Notes that stale `agent:in-dev` issues (crashed runs) must be relabeled by hand.

## ui

```bash
cue ui          # http://127.0.0.1:4224, opens a browser
cue ui 5000     # pick a port
cue ui --no-open
```

Serves the [local dashboard](/guide/dashboard) for the current repo. Localhost only, no authentication.
