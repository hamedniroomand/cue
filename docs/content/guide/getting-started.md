# Getting started

Cue (pronounced *kyoo*, like “cue the lights”) is a CLI tool that drives headless coding agents through a structured, safe GitHub-issue pipeline:

```
Triage → you approve the plan → Dev → Test gate → Review loop → Draft PR → you merge
```

## What is Cue?

Most AI coding tools run as interactive chat sessions inside your terminal or IDE. While useful for exploratory work, interactive agents require constant babysitting: you have to watch every token stream, monitor file changes, and manually catch hallucinations or wrong architectural decisions.

**Cue takes a different approach:** it turns headless coding agents (OpenAI Codex, Claude Code, Google Antigravity) into an **asynchronous PR factory** using GitHub as the state store.

### Key Value & Philosophy

1. **Asynchronous workflow**: Label an issue `agent:ready` and move on with other tasks. No terminal waiting.
2. **Human gates where it matters**:
   - **Plan Approval**: An agent drafts a detailed plan in the issue comments (`agent:planned`). You review and approve it (`agent:approved`) or request changes before any code is modified.
   - **PR Merge**: Cue only opens **draft** pull requests. Cue never merges to `main` and never force-pushes.
3. **Deterministic Quality Gates**: The runner executes your actual test suite (`bun test`, `npm test`, `pytest`, `cargo test`) in the background. Pass/fail is a deterministic script result, not an LLM self-assessment.
4. **Zero Git Blast Radius**: Implementation runs in dedicated git worktrees outside your repository root. The agent subprocess is never given your GitHub token (`GH_TOKEN`).
5. **No Cloud Backend or SaaS**: All state is held in GitHub labels, issue comments, and local `.cue/runs/` logs. You can resume runs from any machine.

---

## Prerequisites

You need these on the machine that will run Cue:

- [`gh`](https://cli.github.com) CLI, authenticated (`gh auth login`) with a token that can read/write issues, contents, and pull requests on the target repos
- the CLI for the agent that will drive the stages, authenticated: [`codex`](https://developers.openai.com/codex) (the default), [`claude`](https://claude.com/claude-code), or `agy` (Antigravity) — `cue init` asks which one

The release binaries do **not** require Bun or Node. You only need [Bun](https://bun.com) ≥ 1.1 if you [clone this repo to develop Cue itself](/develop/setup).

## Install the CLI

Self-contained binaries (macOS/Linux arm64/x64, Windows x64) ship on GitHub Releases. The installers verify a SHA-256 checksum.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/hamedniroomand/cue/main/install.sh | bash
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/hamedniroomand/cue/main/install.ps1 | iex"
```

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUE_VERSION` | latest release | A tag such as `v0.2.0` |
| `CUE_BIN_DIR` | `~/.local/bin` (`%LOCALAPPDATA%\Programs\cue` on Windows) | Where to put the `cue` binary |
| `CUE_REPO` | `hamedniroomand/cue` | `owner/repo` to download from |

Verify with:

```bash
cue --version
```

If the install directory is not on your `PATH`: the Windows installer adds it to your user `PATH` for you (open a new terminal afterwards); the macOS/Linux installer prints the line to add to your shell profile.

### Windows notes

Cue runs natively on Windows (WSL also works). Two extra prerequisites:

- [Git for Windows](https://gitforwindows.org) — Claude Code's Bash tool depends on it
- Long paths: worktrees live under `%USERPROFILE%\.cue\worktrees\…`, which plus a
  project's `node_modules` can exceed the legacy 260-character limit. Enable
  `git config --global core.longpaths true`, or point `worktreeRoot` in
  `.cue/config.json` at a short path such as `C:\w`.

Keep `gate` commands shell-portable: they run through `cmd` on Windows and `sh`
elsewhere (`bun test`, `npm test`, and `&&` chaining work in both).

## Adopt in a project

Run every Cue command **from inside the target repo**.

```bash
cd my-project
cue init
```

This creates the `agent:*` labels on the GitHub repo (detected from the `origin` remote) and scaffolds:

```
my-project/
└── .cue/
    ├── config.json    # project settings — every field optional
    ├── prompts/       # optional per-project prompt overrides
    └── runs/          # transcripts + costs per issue (gitignored)
```

In a terminal, `init` asks four questions — which agent CLI to use, the test command for the gate, an optional lint command, and whether to switch on [review learnings](#optional-living-specs-and-learnings) — each pre-filled with a sensible default (`codex`, `bun test`, none, `No`). Pass `--yes` (or run non-interactively) to skip the questions and keep the defaults; you can always edit `.cue/config.json` later, or re-run `cue init` to reconfigure. See [Commands → init](/guide/commands#init) for the questions and [Configuration](/guide/config) for every field.

## First issue

1. Open (or write) a GitHub issue that describes the work.
2. Apply the `agent:ready` label.
3. From the repo: `cue process`.
4. Triage posts a plan comment and the label becomes `agent:planned`.
5. Read the plan. If it looks right, swap the label to `agent:approved`. If not, [ask for a revision](/guide/pipeline#giving-feedback-on-a-plan).
6. `cue process` again. Dev implements in a worktree, the test gate runs, a draft PR opens, and the review agent comments a verdict. The label becomes `agent:in-review`.
7. You review the draft PR. If something needs changing, leave your feedback on the PR and label the issue `agent:revise` — the next `process` [sends it back through the agent](/guide/pipeline#giving-feedback-on-the-pr) and returns to `agent:in-review` with a fresh verdict.
8. Merge the draft PR. The next `process` (or `cue cleanup`) marks the issue `agent:done` and removes the worktree.

That is the whole human loop. Details, labels, and edge cases live in [Pipeline](/guide/pipeline). Command reference: [Commands](/guide/commands).

## Optional: living specs and learnings

Two knowledge layers are off by default and switched on by creating a file — there is nothing to configure:

- `openspec/specs/` or `.cue/specs/` makes specs the source of truth: plans gain a `## Spec changes` delta and dev updates the spec files in the same PR as the code.
- An empty `.cue/learnings.md` lets the review loop distill the fixes it had to force into durable one-line lessons that later runs carry in context. `cue init` offers to create this one for you; commit it, or the worktrees the dev and review stages run in will never see it.

See [Pipeline → Living specs & learnings](/guide/pipeline#living-specs-learnings-opt-in).
