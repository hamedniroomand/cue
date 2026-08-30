<p align="center">
  <img src="docs/content/public/logo.svg" width="140" alt="Cue logo" />
</p>

<h1 align="center">Cue</h1>

<p align="center">
  <a href="https://github.com/hamedniroomand/cue/actions/workflows/tests.yml"><img src="https://img.shields.io/github/actions/workflow/status/hamedniroomand/cue/tests.yml?branch=main&label=tests" alt="Tests" /></a>
  <a href="https://github.com/hamedniroomand/cue/releases"><img src="https://img.shields.io/github/v/release/hamedniroomand/cue" alt="Release" /></a>
  <a href="https://codecov.io/gh/hamedniroomand/cue"><img src="https://codecov.io/github/hamedniroomand/cue/graph/badge.svg?token=LMETC0IP4O" alt="Coverage" /></a>
  <img src="https://img.shields.io/github/license/hamedniroomand/cue" alt="License" />
</p>

<p align="center">
  Turn GitHub issues into tested, reviewed draft pull requests — using headless coding agents.
</p>

Cue (pronounced _kyoo_, like “cue the lights”) is a CLI that drives coding agents through a deterministic issue pipeline:

```
Issue (agent:ready) ──> Triage Plan ──> You Approve (agent:approved) ──> Dev & Test Gate ──> Code Review ──> Draft PR ──> You Merge
                                                                                                   ^                  │
                                                                                                   └──── agent:revise ┘
```

Instead of babysitting interactive agent sessions in your terminal, Cue runs coding agents through a deterministic pipeline where GitHub acts as the state store: labels drive the state machine, issue comments carry implementation plans, and draft PRs deliver the finished code.

**Documentation & Guides:** [hamedniroomand.github.io/cue](https://hamedniroomand.github.io/cue/)

## Why Cue?

- **Asynchronous & Non-Blocking**: Assign an issue with a label and move on. No watching streaming tokens in a terminal.
- **Human Control on Irreversible Steps**: You review and approve the implementation plan before code is written, and you merge the final PR. Agents never touch `main` or force-push.
- **Deterministic Quality Gates**: Real test and lint commands (`bun test`, `npm test`, `pytest`, etc.) validate changes — pass/fail is never left to LLM self-evaluation.
- **Isolated Worktrees & Scrubbed Secrets**: Agent edits happen in dedicated git worktrees outside your project root. GitHub tokens (`GH_TOKEN`) are completely scrubbed from agent subprocesses.
- **Multi-Engine Flexibility**: Works with OpenAI Codex (`codex`), Claude Code (`claude`), and Google Antigravity (`antigravity`).

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/hamedniroomand/cue/main/install.sh | bash
```

Or, if you already have [Bun](https://bun.com) ≥ 1.1:

```bash
bun install -g cue-agent
```

Requires authenticated `gh` and `codex` CLIs (or Claude / Antigravity). Then, inside any project repository:

```bash
cue init
```

Label an issue `agent:ready` and run `cue process`. Full walkthrough: [Getting started](https://hamedniroomand.github.io/cue/guide/getting-started).

## Documentation

- [Why Cue](https://hamedniroomand.github.io/cue/guide/why-cue) — how Cue differs from the built-in orchestration of agent CLIs
- [Getting started](https://hamedniroomand.github.io/cue/guide/getting-started) — prerequisites, installation, and first issue
- [Pipeline and labels](https://hamedniroomand.github.io/cue/guide/pipeline) — the state machine and human/Cue collaboration loop
- [Commands](https://hamedniroomand.github.io/cue/guide/commands) — `init`, `process`, `run`, `cleanup`, `status`, `ui`, `upgrade`
- [Configuration](https://hamedniroomand.github.io/cue/guide/config) — `.cue/config.json` schema and adapters
- [Dashboard](https://hamedniroomand.github.io/cue/guide/dashboard) — local web UI for transcripts, costs, and issue tracking
- [Contributing](https://hamedniroomand.github.io/cue/develop/setup) — setup and architecture for developing Cue

## License

MIT
