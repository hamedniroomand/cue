# Clone and setup

This page is for people changing Cue itself. If you only want to run agents against your own repos, [install the release binary](/guide/getting-started#install-the-cli) and stop there.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.1
- `gh` and `codex` CLIs if you will drive a real pipeline (the test suite does not need them)

## Clone

```bash
git clone https://github.com/hamedniroomand/cue.git
cd cue
bun install
```

The CLI entrypoint is `src/cli.ts` (`bin: cue` in `package.json`).

## Run from the checkout

Without installing globally:

```bash
bun run cue --help
bun run cue status   # from inside a *target* repo — see below
```

To put `cue` on your `PATH` from this checkout (needs Bun):

```bash
bun link
```

`bun link` makes the shebang script resolve to this tree, so prompt files and the dashboard build come from your working copy.

## Point it at a target repo

Cue always runs with **cwd = the target project**, not this checkout. Per-project state lives in that project's `.cue/`.

```bash
cd /path/to/some-other-repo
cue init
cue status
```

Two directories, two jobs:

| Directory | What it is |
| --- | --- |
| This git clone | The Cue **product** — TypeScript, prompts, dashboard source |
| The target repo | The **project** issues are about — `.cue/config.json`, labels, worktrees, draft PRs |

Do not run `cue poll` against this checkout unless you intend to let agents open PRs here.

## Verify the checkout

```bash
bun test              # full suite — fakes only: no network, no gh, no claude
bun run lint
bun run format:check
bun run check         # lint + format:check + tests
```

`bun test` is the default quality bar. You do not need GitHub or Claude credentials to develop the runner.

## Docs site

This site is VitePress, sources under `docs/content/`:

```bash
bun run docs:dev      # local preview
bun run docs:build    # writes docs/.vitepress/dist
bun run docs:preview
```

Pushes to `main` that touch `docs/` publish to GitHub Pages via `.github/workflows/docs.yml`.
