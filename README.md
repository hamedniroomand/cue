# Conductor

Conductor is a globally-installed CLI (like `claude` or `gh`) that lets any developer
point a coding agent (Claude Code today, Codex planned) at GitHub issues and run them
through a fixed pipeline: **Triage → human approves plan → Dev → Test gate → Review
loop → Draft PR → human merges**. Each pipeline stage is one fresh headless
`claude -p` invocation with a role prompt from [prompts/](prompts/); everything
between stages — routing, gating, retries, state transitions — is plain TypeScript.

GitHub itself is the state store: labels are the state machine, issue comments carry
the handoff artifacts (the plan), and draft PRs are the output. That makes every run
resumable from any machine, auditable in the issue thread, and safe to share across a
team. All project-specific state lives in the target repo under `.conductor/`, so one
conductor install drives any number of projects.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.1
- `gh` CLI, authenticated (`gh auth login`) with a token scoped to the target repos
  (issues: read/write, contents: read/write, pull requests: read/write)
- `claude` CLI, authenticated

## Install the CLI (once per machine)

Self-contained binaries (macOS/Linux, arm64/x64 — no Bun or Node required) ship on
GitHub Releases, with a checksum-verifying installer:

```bash
curl -fsSL https://raw.githubusercontent.com/hamedniroomand/conductor/main/install.sh | bash
```

Options via env vars: `CONDUCTOR_VERSION` (a tag; default latest),
`CONDUCTOR_BIN_DIR` (default `~/.local/bin`), `CONDUCTOR_REPO`. Windows is
supported through WSL. Verify with `conductor --version`.

Working on conductor itself: `bun link` in this repo (needs [Bun](https://bun.com));
releases are cut by pushing a `v*` tag — CI builds the binaries
(`scripts/build-binaries.sh`) and attaches them to the release.

## Adopt in a project (once per repo)

```bash
cd my-project
conductor init
```

This creates the `agent:*` labels on the repo (detected from the `origin` remote) and
scaffolds:

```
my-project/
└── .conductor/
    ├── config.json    # project settings — every field optional, see below
    ├── prompts/       # optional per-project prompt overrides (triage.md, dev.md, …)
    └── runs/          # transcripts + costs per issue (auto-gitignored)
```

`config.json` starts as just `{ "gate": { "test": "bun test" } }` — set the gate to
this project's real test command. Everything else has defaults:

| Field                 | Default                                       |
| --------------------- | --------------------------------------------- |
| `repo`                | auto-detected from the `origin` remote        |
| `adapter`             | `"claude"` (`"codex"` planned)                |
| `models`              | triage `haiku`, dev `sonnet`, review `sonnet` |
| `maxTurns`            | triage 15, dev 60, review 25                  |
| `gate`                | `{ "test": "bun test" }` (+ optional `lint`)  |
| `reviewFixIterations` | 2                                             |
| `devBashAllowlist`    | unset — dev/fix agents get unrestricted Bash  |
| `worktreeRoot`        | `~/.conductor/worktrees/<owner>-<repo>`       |
| `baseBranch`          | `"main"`                                      |

## Usage

Run every command **from inside the target repo**. Multiple projects run
independently — separate repos, separate labels, separate worktrees.

| Step | Who   | Action                                                                                                                                                           |
| ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | human | Label an issue `agent:ready`                                                                                                                                     |
| 2    | you   | `conductor poll` — triage posts a plan comment, label becomes `agent:planned`                                                                                    |
| 3    | human | Review the plan comment; if good, swap label to `agent:approved`                                                                                                 |
| 4    | you   | `conductor poll` — dev implements in a git worktree, tests gate the result, a draft PR opens, review agent comments its verdict, label becomes `agent:in-review` |
| 5    | human | Review and merge the draft PR                                                                                                                                    |

Other commands:

```bash
conductor status    # issues per state + local spend per issue
conductor run 42    # run just issue #42 (must be agent:ready or agent:approved)
conductor cleanup   # reconcile merged/closed PRs (also runs at the start of every poll):
                            #   merged → agent:done, closed unmerged → agent:failed,
                            #   worktree + local branch removed either way
conductor ui        # web dashboard at http://127.0.0.1:4224 (optional: `conductor ui 5000`)
```

### Web dashboard

`conductor ui` serves a local dashboard (localhost only, no auth) for the current
repo, in two views:

- **Overview** — total agent spend, cost per pipeline stage, cost per issue, a
  cumulative spend trajectory, the `agent:*` label board, and a live log streamed over
  SSE while stages run.
- **Runs** — a transcript explorer over `.conductor/runs/`, split into **Active**
  (issues still on the label board) and **Done** (recorded runs whose issue has left the
  board — merged, closed, or `agent:done`). Pick an issue, pick a recorded stage run, and read the exact prompt that was sent, the flattened event
  transcript (tool calls, thinking, results), or the raw log entry. Denied tool calls
  are surfaced explicitly, since a stage's `--allowedTools` allowlist is a common cause
  of odd agent behaviour.

It's the same pipeline the CLI runs — GitHub labels and `.conductor/runs/` stay the
shared state either way. The dashboard is a react-router SPA (shadcn `base-nova`) built
to `ui/build/client` and served by the CLI:

```bash
bun run ui:build     # build the dashboard (required after changing ui/app/)
bun run ui:dev       # Vite dev server on :5173, proxying /api to a running `conductor ui`
bun run fixtures     # snapshot local .conductor runs so the SPA renders without the API
```

### Giving feedback on a plan

Two ways, from lightest to heaviest:

1. **Ask the agent to revise (recommended):** reply to the issue with normal comments
   ("find a simpler approach", "don't add a framework"), then apply the
   `agent:replan` label. The next `poll` re-runs triage with the previous plan and
   your feedback in context — it may also search the web for alternatives — and posts
   a revised plan (with a `## Revision notes` section). Repeat as many rounds as you
   like, then apply `agent:approved`.
2. **Edit the plan yourself:** edit the plan comment directly, or post a new comment
   containing the `<!-- conductor:plan -->` marker (the newest marker comment wins).

Plain reply comments are only read during a replan — the dev agent sees just the
final plan.

## Label state machine

| Label             | Meaning                                             | Who sets it         | Next actor         |
| ----------------- | --------------------------------------------------- | ------------------- | ------------------ |
| `agent:ready`     | Maintainer wants the pipeline to pick this up       | human               | conductor → triage |
| `agent:planned`   | Plan posted as issue comment                        | conductor           | human reviews plan |
| `agent:approved`  | Human approved the plan                             | human               | conductor → dev    |
| `agent:replan`    | Human wants a revised plan (feedback in comments)   | human               | conductor → replan |
| `agent:in-dev`    | Dev stage claimed and running                       | conductor           | conductor          |
| `agent:in-review` | Draft PR open, review loop done                     | conductor           | human merges       |
| `agent:done`      | PR merged; worktree/branch cleaned up               | conductor (cleanup) | —                  |
| `agent:failed`    | A stage failed, or the PR was closed unmerged       | conductor           | human              |
| `agent:stop`      | Kill switch — conductor skips this issue everywhere | human               | —                  |

A crashed run leaves an issue stuck in `agent:in-dev`; reset the label by hand to
retry (`conductor status` lists them).

## Safety model

- Conductor only ever acts on issues a maintainer explicitly labeled — issue bodies
  are treated as untrusted input and the prompts say so.
- Humans gate the two irreversible moments: plan approval and PR merge. Conductor
  never merges, never force-pushes, never touches the base branch.
- Agent subprocesses run with a scrubbed environment — the GitHub token is never
  exported to them; only the runner's own `gh` calls use it.
- Triage and review agents get read-only tools; the dev agent's blast radius is its
  git worktree, and the runner (not the agent) owns commit/push/PR.
- The worktree boundary is enforced by prompt, not OS sandbox: dev agents are told
  never to touch files outside the worktree, and plans must be self-contained so they
  never need to. For hard enforcement, set `devBashAllowlist` in
  `.conductor/config.json` (e.g. `["bun *", "git status"]`) to restrict the dev/fix
  agents' shell to those command patterns — unset means unrestricted Bash.
- Caps everywhere: per-stage max turns and wall-clock timeouts, one repair attempt at
  the test gate, `reviewFixIterations` on the review loop, `agent:stop` to freeze an
  issue.
- Every invocation's prompt, raw result, duration, and cost land in
  `.conductor/runs/<issue>/<stage>-<timestamp>.json` in the target repo (gitignored).

## Development

```bash
bun test   # entire suite runs on fakes — no network, no gh, no claude needed
```

Design spec: `docs/superpowers/specs/2026-08-20-agent-orchestration-pipeline-design.md`
(kept out of git). The Codex adapter (`src/adapters/codex.ts`) and a GitHub Actions
mirror are planned follow-ups; `"adapter": "codex"` currently exits with a clear error.
