# Configuration

All project-specific state lives in the **target** repo, not in the Cue install:

```
.cue/
├── config.json    # optional — every field has a default
├── prompts/       # optional overrides: triage.md, replan.md, dev.md, review.md, fix.md
└── runs/          # transcripts + costs (gitignored)
```

`cue init` writes a minimal `config.json`. You can also start from an empty file or omit fields you do not care about. `repo` is auto-detected from `origin` when unset.

## Editor autocompletion

Cue publishes a JSON Schema for `config.json`. `cue init` writes it in as the first key, so VS Code (and any editor with JSON Schema support) autocompletes field names, enumerates the valid `adapter` values, shows each field's description on hover, and flags typos as you type:

```json
{
  "$schema": "https://hamedniroomand.github.io/cue/schema/config.json",
  "gate": { "test": "bun test" }
}
```

Already have a `.cue/config.json`? Re-run [`cue init`](/guide/commands#init) — it adds the `$schema` key in place. Note that the default `init` also walks you through the adapter and gate commands, pre-filled with your current values; `cue init --yes` skips the questions and only tops up `$schema`. Or paste the line in yourself.

The schema is deliberately a little stricter than the parser: it rejects unknown keys, so a misspelled field shows up as a squiggle in the editor instead of being silently ignored at runtime.

## Fields

| Field | Default | Notes |
| --- | --- | --- |
| `$schema` | written by `cue init` | Editor autocompletion only; Cue ignores it |
| `repo` | from the `origin` remote | `owner/name` |
| `adapter` | `"codex"` | Options: `"codex"`, `"antigravity"` (or `"agy"`), `"claude"` |
| `models` | Codex: `gpt-5.3-codex`; Antigravity: triage `gemini-3.7-flash-medium`, dev/review `gemini-3.7-flash-high`; Claude: triage/dev `haiku`, review `opus` | Passed to the selected CLI. Model names are adapter-specific, so setting `models` requires setting `adapter` explicitly too — Cue refuses the combination of explicit models with a defaulted adapter. |
| `maxTurns` | triage 15, dev 60, review 25 | Per-stage turn cap, enforced by Claude (`--max-turns`) only. Codex and Antigravity have no turn cap — the stage timeout is their only bound. |
| `gate` | `{ "test": "bun test" }` | Optional `lint` string. Run in the worktree via the OS shell (`sh -c`; `cmd /c` on Windows) — keep commands shell-portable |
| `setup` | unset | Shell command run once in every fresh or re-attached worktree **before** the agent starts — dependency install and similar bootstrap, e.g. `"bun install"` (or `"bun install && bun install --cwd ui"` for a repo with a second package). Same shell rules as `gate`. A non-zero exit fails the stage before any agent tokens are spent |
| `reviewFixIterations` | `2` | Bounded review → fix loop |
| `devBashAllowlist` | unset | Per-command shell scoping, e.g. `"bun *"`, `"git status"`. **Enforced by Claude only.** Codex and Antigravity cannot scope individual commands: their write stages get a full shell inside the sandbox (`workspace-write` / `accept-edits`), so this field does not restrict them. |
| `worktreeRoot` | `~/.cue/worktrees/<owner>-<repo>` | Deliberately **outside** the target repo |
| `baseBranch` | `"main"` | Branch draft PRs target |
| `staleClaimMinutes` | `90` | How long an `agent:in-dev` claim is considered live; `cue process` resets older ones to `agent:approved` |
| `webhookUrl` | unset | POSTed a JSON notification when a plan awaits approval or a draft PR awaits merge. Payload carries `text` (Slack-compatible) and `content` (Discord-compatible) plus structured fields. Best-effort: a down webhook never fails a stage |

Example:

```json
{
  "$schema": "https://hamedniroomand.github.io/cue/schema/config.json",
  "adapter": "codex",
  "gate": {
    "test": "npm test",
    "lint": "npm run lint"
  },
  "models": {
    "triage": "gpt-5.3-codex",
    "dev": "gpt-5.3-codex",
    "review": "gpt-5.3-codex"
  },
  "maxTurns": {
    "triage": 15,
    "dev": 60,
    "review": 25
  },
  "reviewFixIterations": 2,
  "devBashAllowlist": ["bun *", "git status", "git diff *"],
  "baseBranch": "main"
}
```

## Prompt overrides

Packaged role prompts live with the CLI. A file of the same name under `.cue/prompts/` wins. An override replaces the whole template, but each stage refuses to run a template that lost its essential placeholders:

| File | Stage | Required placeholders |
| --- | --- | --- |
| `triage.md` | Plan generation | `{{issue_title}}`, `{{issue_body}}` |
| `replan.md` | Plan revision from comments | `{{previous_plan}}`, `{{feedback}}` |
| `dev.md` | Implementation | `{{plan}}` |
| `review.md` | Verdict | `{{plan}}`, `{{diff}}` |
| `revise.md` | PR-feedback revision | `{{plan}}`, `{{feedback}}` |
| `fix.md` | Review-loop repair | `{{failure_output}}` |

Issue bodies and comments are untrusted input. The runner automatically fences only `{{issue_title}}` and `{{issue_body}}` in `<untrusted-data>` tags before rendering (escaping any fence lookalikes inside them). `{{feedback}}` in replan/revise is deliberately not fenced: a human reads the thread and applies the `agent:replan`/`agent:revise` label, and that gate is what makes those comments instructions. Still keep the security preamble if you edit a prompt.

## Worktrees

Default path: `~/.cue/worktrees/<owner>-<repo>/issue-<n>` on branch `agent/issue-<n>`.

They sit outside the target repo so IDE indexing and repo-root tool globs never see them. Do not move them into the repo; set `worktreeRoot` if you need a different location.

A fresh worktree has no installed dependencies (`node_modules` and the like live per-checkout). If your gate or your repo's git hooks need them, set `setup` — it runs deterministically in the worktree before the agent starts, so the agent never burns turns discovering a bare checkout.

The target repo may be empty: Cue bootstraps an empty initial commit (`--allow-empty`) and pushes it when `origin/<baseBranch>` is missing.

## Runs and cost

Every adapter invocation is logged under `.cue/runs/<issue>/<stage>-<timestamp>.json` with the prompt, full event transcript, duration, and cost. The [dashboard](/guide/dashboard) reads this directory. Do not commit it.

Claude and Antigravity report a dollar cost per run; Codex reports token usage but no cost, so Codex runs show no spend (unknown, not free).

Each agent subprocess runs with a scrubbed environment: the OS basics plus that adapter's own API keys — never another provider's credentials, and never `GH_TOKEN`.

## Codex

Set `"adapter": "codex"` and authenticate the `codex` CLI. Cue invokes `codex exec --json` for each stage. Planning and review run in Codex's `read-only` sandbox; dev and repair stages run in `workspace-write`. The replan stage gets `--search` so it can research alternatives on the web. Cue still owns every GitHub, commit, push, and pull-request operation.

## Antigravity

Set `"adapter": "antigravity"` (or `"adapter": "agy"` — normalized to `antigravity` internally) and authenticate the `agy` CLI. Cue invokes `agy -p <prompt> --output-format stream-json --dangerously-skip-permissions`, using Antigravity's `plan` mode for planning/review and `accept-edits` for implementation. `agy` has no web-search flag, so the replan stage logs a warning that web access is not guaranteed. Antigravity executes its tools; Cue owns transcripts, gates, GitHub operations, commits, pushes, and pull requests.
