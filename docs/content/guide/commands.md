# Commands

Every command runs **from inside the target repo** (cwd is the project Conductor should act on). The repo is auto-detected from the `origin` remote unless you set `repo` in `.conductor/config.json`.

```bash
conductor --help
conductor --version
```

## init

```bash
conductor init
```

Creates the `agent:*` labels on the GitHub repo and scaffolds `.conductor/` in the current directory:

- `.conductor/config.json` — written only if missing, default `{ "gate": { "test": "bun test" } }`
- `.conductor/prompts/` — empty directory for optional prompt overrides
- `.conductor/runs/` added to `.gitignore` if it is not already listed

Safe to re-run: existing config is left alone; labels that already exist are skipped.

## poll

```bash
conductor poll
```

The main loop. It:

1. Reconciles finished PRs ([cleanup](#cleanup)).
2. Lists issues labeled `agent:ready`, `agent:replan`, or `agent:approved`.
3. Runs the next stage for each one.

Use this after you label work, after you approve a plan, and after you merge.

## run

```bash
conductor run 42
```

Runs the next pipeline stage for a single issue. The issue must be in an actionable state: `agent:ready`, `agent:approved`, or `agent:replan`.

Useful when you want to drive one issue without scanning the whole board.

## cleanup

```bash
conductor cleanup
```

Reconciles merged and closed PRs for conductor-managed issues:

- merged → `agent:done`
- closed unmerged → `agent:failed`
- worktree and local `agent/issue-<n>` branch removed either way

Also runs at the start of every `poll`. Call it on its own if you merged on GitHub and want local worktrees gone without kicking the rest of the pipeline.

## status

```bash
conductor status
```

Prints issues in each active pipeline state, local spend per issue (from `.conductor/runs/`), and the worktree root.

Notes that stale `agent:in-dev` issues (crashed runs) must be relabeled by hand.

## ui

```bash
conductor ui          # http://127.0.0.1:4224, opens a browser
conductor ui 5000     # pick a port
conductor ui --no-open
```

Serves the [local dashboard](/guide/dashboard) for the current repo. Localhost only, no authentication.
