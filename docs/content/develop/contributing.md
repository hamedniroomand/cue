# Contributing

The test suite is the contract. Write the failing test first, then the code. The entire suite runs on fakes — no network, no `gh`, no `claude`.

## Commands

From the Cue checkout:

```bash
bun test                 # full suite
bun run lint             # oxlint (.oxlintrc.json)
bun run format           # oxfmt — run after editing
bun run format:check
bun run check            # lint + format:check + tests
bun run cue <cmd>  # CLI against cwd (usually a target repo)
```

`tsconfig` has `noUncheckedIndexedAccess`, so indexed access needs a guard or a deliberate `!`. Tests use `bun test` (the code depends on Bun APIs) — do not migrate them to another framework.

Always run `bun run check` before claiming a change works.

## Tests and fakes

- Subprocess-touching code: `makeFakeExec` in `tests/helpers/` — scripted `{ match, result }` replay, `"*"` wildcards, prefix matching.
- Agent-touching code: `makeFakeAdapter`.
- `tests/triage.test.ts` exports `makeCtx` — the shared `StageContext` factory used by dev, review, replan, pipeline, cleanup, and integration tests. Extend it rather than duplicating setup.

TypeScript is strict. `any` is allowed only at `gh` / `claude` JSON parse boundaries, and is narrowed immediately. Errors throw with actionable messages.

## What to keep in sync

If you change any of these, update **all** of them:

- Label names — code, tests, prompts, docs, real repos
- `PLAN_MARKER` — defined once in `stages/triage.ts`
- Config fields — valibot schema in `src/config.ts` and the [defaults table](/guide/config#fields)

`docs/superpowers/` is gitignored on purpose. Do not commit design specs or "fix" that ignore rule.

## Dashboard

`ui/` is excluded from the root `tsconfig`, oxlint, and oxfmt configs. It has its own:

```bash
bun run ui:build      # after any change under ui/app/
bun run ui:dev
bun run ui:lint
bun run ui:format
bun run ui:check      # tsc
```

`bun run check` does **not** cover the SPA — run both when you touch `ui/`.

The dashboard uses react-router in **library** mode (`createBrowserRouter` in `app/main.tsx`) on plain Vite with the React Compiler on. Do not reintroduce `@react-router/dev`.

`RunEntry.result` is polymorphic: older logs store a single `result` event as an object; newer ones store the whole event array. Anything reading a transcript must go through `normalizeEvents` in `ui/app/lib/cue.ts`.

## Docs

User and contributor docs are this VitePress site (`docs/content/`). The root README stays short and points here. Diagrams use fenced `mermaid` blocks (`vitepress-plugin-mermaid`).

```bash
bun run docs:dev
bun run docs:build
```

## Releasing

1. Land the change on `main`.
2. Push a `v*` tag (for example `v0.3.0`).
3. CI (`.github/workflows/release.yml`) builds binaries with `scripts/build-binaries.sh` and attaches `dist/cue-*` plus `checksums.txt`.
4. Users upgrade with the same `install.sh` one-liner, or `CUE_VERSION=v0.3.0`.

Do not commit `src/ui-manifest.g.ts` after a local binary build — the script restores the empty stub; leave it that way.
