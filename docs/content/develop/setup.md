# Clone and setup

This page is for people changing Conductor itself. If you only want to run agents against your own repos, [install the release binary](/guide/getting-started#install-the-cli) and stop there.

## Prerequisites

- [Bun](https://bun.com) ≥ 1.1
- `gh` and `claude` CLIs if you will drive a real pipeline (the test suite does not need them)

## Clone

```bash
git clone https://github.com/hamedniroomand/conductor.git
cd conductor
bun install
```

The CLI entrypoint is `src/cli.ts` (`bin: conductor` in `package.json`).

## Run from the checkout

Without installing globally:

```bash
bun run conductor --help
bun run conductor status   # from inside a *target* repo — see below
```

To put `conductor` on your `PATH` from this checkout (needs Bun):

```bash
bun link
```

`bun link` makes the shebang script resolve to this tree, so prompt files and the dashboard build come from your working copy.

## Point it at a target repo

Conductor always runs with **cwd = the target project**, not this checkout. Per-project state lives in that project's `.conductor/`.

```bash
cd /path/to/some-other-repo
conductor init
conductor status
```

Two directories, two jobs:

| Directory | What it is |
| --- | --- |
| This git clone | The conductor **product** — TypeScript, prompts, dashboard source |
| The target repo | The **project** issues are about — `.conductor/config.json`, labels, worktrees, draft PRs |

Do not run `conductor poll` against the conductor repo unless you intend to let agents open PRs here.

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
