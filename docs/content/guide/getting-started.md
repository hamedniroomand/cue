# Getting started

Cue (pronounced *kyoo*, like “cue the lights”) is a globally-installed CLI (like `claude` or `gh`). Point it at a GitHub repo, label an issue `agent:ready`, and it drives a coding agent through a fixed pipeline:

**Triage → you approve the plan → Dev → Test gate → Review loop → Draft PR → you merge.**

Each stage is one fresh headless `codex exec` invocation with a role prompt. Everything between stages — routing, gating, retries, label transitions — is plain TypeScript. GitHub itself holds the state, so a run can resume on another machine and the whole thread is the audit log.

One Cue install drives any number of projects. All project-specific state lives in the target repo under `.cue/`.

## Prerequisites

You need these on the machine that will run Cue:

- [`gh`](https://cli.github.com) CLI, authenticated (`gh auth login`) with a token that can read/write issues, contents, and pull requests on the target repos
- [`codex`](https://developers.openai.com/codex) CLI, authenticated

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

If you already have the [CUE language](https://cuelang.org) CLI installed, its `cue` binary will collide on `PATH`. Install this CLI to a dedicated `CUE_BIN_DIR`, or put that directory earlier on `PATH`.

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

`config.json` starts as `{ "gate": { "test": "bun test" } }`. Change `gate.test` to this project's real test command. See [Configuration](/guide/config) for the rest of the defaults.

## First issue

1. Open (or write) a GitHub issue that describes the work.
2. Apply the `agent:ready` label.
3. From the repo: `cue poll`.
4. Triage posts a plan comment and the label becomes `agent:planned`.
5. Read the plan. If it looks right, swap the label to `agent:approved`. If not, [ask for a revision](/guide/pipeline#giving-feedback-on-a-plan).
6. `cue poll` again. Dev implements in a worktree, the test gate runs, a draft PR opens, and the review agent comments a verdict. The label becomes `agent:in-review`.
7. You review and merge the draft PR. The next `poll` (or `cue cleanup`) marks the issue `agent:done` and removes the worktree.

That is the whole human loop. Details, labels, and edge cases live in [Pipeline](/guide/pipeline). Command reference: [Commands](/guide/commands).
