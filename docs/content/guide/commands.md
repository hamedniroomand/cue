# Commands

Every command runs **from inside the target repo** (cwd is the project Cue should act on). The repo is auto-detected from the `origin` remote unless you set `repo` in `.cue/config.json`.

```bash
cue --help
cue --version
```

## init

```bash
cue init          # asks three questions, then sets everything up
cue init --yes    # skip the questions, keep current/default values
```

Creates the `agent:*` labels on the GitHub repo and scaffolds `.cue/` in the current directory:

- `.cue/config.json` — with a [`$schema`](/guide/config#editor-autocompletion) line for editor autocompletion
- `.cue/prompts/` — empty directory for optional prompt overrides
- `.cue/runs/` added to `.gitignore` if it is not already listed

### The questions

In a terminal, `init` asks for the three settings Cue cannot guess:

| Question | Pre-filled with |
| --- | --- |
| Which agent CLI drives the stages? | your current `adapter`, else `codex` |
| Test command for the gate | your current `gate.test`, else `bun test` |
| Lint command (blank for none) | your current `gate.lint`, else nothing |

Everything else keeps its default and is edited in the file, where the schema autocompletes it. Answers are pre-filled and editable, so pressing Enter through the whole thing leaves `config.json` byte-identical — `init` doubles as a reconfigure command without risking a tuned setup. Ctrl+C aborts before anything is written.

Switching adapter drops any `models` you had set, because model names are adapter-specific; Cue says so when it happens, and the new adapter's defaults apply.

**Non-interactive runs never prompt.** When stdin or stdout is not a TTY — CI, a pipe, `cue init | tee` — or when you pass `--yes`, `init` skips the questions entirely and behaves as it always has.

Safe to re-run: labels that already exist are refreshed in place, and an existing config is only rewritten if your answers actually changed something.

## process

```bash
cue process
```

The main loop. It:

1. Reconciles finished PRs ([cleanup](#cleanup)).
2. Lists issues labeled `agent:ready`, `agent:replan`, or `agent:approved`.
3. Runs the next stage for each one.

Use this after you label work, after you approve a plan, and after you merge.

## poll

```bash
cue poll
```

Compatibility alias for `cue process`. New scripts and documentation should use `process`.

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

It also reclaims stale claims: an `agent:in-dev` issue whose label is older than [`staleClaimMinutes`](/guide/config#fields) (default 90) with no run finishing it — a crashed or rebooted runner — is reset to `agent:approved` with an explanatory comment, so the next `process` simply picks it up again. The claim's age is read from the GitHub label event, so any machine can do the reclaiming.

Also runs at the start of every `process`. Call it on its own if you merged on GitHub and want local worktrees gone without kicking the rest of the pipeline.

## status

```bash
cue status
```

Prints issues in each active pipeline state, local spend per issue (from `.cue/runs/`), and the worktree root.

Stale `agent:in-dev` claims (crashed runs) are reset automatically by [`cleanup`](#cleanup) after `staleClaimMinutes`.

## ui

```bash
cue ui          # http://127.0.0.1:4224, opens a browser
cue ui 5000     # pick a port
cue ui --no-open
```

Serves the [local dashboard](/guide/dashboard) for the current repo. Localhost only, no authentication.

## upgrade

Updates a release-installed `cue` to the latest GitHub release, in place — the
downloaded binary is SHA-256-verified against the release's `checksums.txt`
before it replaces the running one.

```bash
cue upgrade
```

```
Cue v0.4.0 is out! You're on v0.3.0
[3.12s] Upgraded.
Welcome to Cue v0.4.0!
```

Works from any directory (no target repo needed). Source checkouts are not
upgradable this way — use `git pull` there instead. On Windows the previous
binary is left beside the new one as `cue.exe.old`.
