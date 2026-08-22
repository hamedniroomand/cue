# Cue — Agent Context

Cue is a deterministic Bun + TypeScript runner that drives headless coding
agents (Claude Code via `claude -p`) through a GitHub-issue pipeline:
**Triage → human approves plan → Dev → Test gate → Review loop → Draft PR → human merges.**
GitHub is the state store: `agent:*` labels are the state machine, issue comments
carry handoffs (the plan), draft PRs are the output. User-facing flow and
label table: `docs/content/` (VitePress) and https://hamedniroomand.github.io/cue/

## Commands

```bash
bun test               # full suite — runs entirely on fakes: no network, no gh, no claude
bun run lint           # oxlint (config: .oxlintrc.json)
bun run format         # oxfmt — always format after editing; format:check verifies
bun run check          # lint + format:check + tsc --noEmit + tests, all in one
bun run cue <init|poll|run <n>|cleanup|status|ui [port]>   # the CLI (globally: `cue`, run from inside a target repo)
```

Always run `bun run check` before claiming any change works. tsconfig has
`noUncheckedIndexedAccess`, so indexed access needs a guard or a deliberate `!`.
Tests use `bun test` (the code depends on Bun APIs) — do not migrate them to another
test framework.

## Architecture

```
src/
├── cli.ts              # entrypoint + label definitions; builds the real StageContext
├── pipeline.ts         # nextAction (label → stage routing), runIssue (failure → agent:failed), poll
├── cleanup.ts          # reconciles merged/closed PRs: agent:done / agent:failed + worktree removal
├── stages/
│   ├── context.ts      # StageContext — the DI bundle every stage receives
│   ├── triage.ts       # read-only plan generation; exports PLAN_MARKER
│   ├── replan.ts       # plan revision from human feedback comments (has WebSearch)
│   ├── dev.ts          # worktree implementation + gate + draft PR
│   └── review.ts       # JSON verdict + bounded fix loop; exports parseVerdict, Verdict
├── adapters/
│   ├── types.ts        # AgentAdapter / AgentRunOptions (semantic: access/webSearch/bashAllowlist) / AgentResult
│   ├── base.ts         # JsonlAdapter: shared run loop (env scrub, exec, JSONL parse, progress)
│   ├── registry.ts     # ADAPTERS: name → { make, defaultModels }; the one list of adapters
│   ├── summarize.ts    # shared tool-input summarizer (also imported by ui/app/lib/transcript.ts)
│   ├── antigravity.ts  # agy -p --output-format stream-json --dangerously-skip-permissions
│   ├── claude.ts       # claude -p --output-format stream-json --verbose; maps access → --allowedTools
│   └── codex.ts        # codex exec --json; sandbox read-only / workspace-write; --search for webSearch
├── server.ts           # `cue ui`: Bun.serve — state/runs API, SSE events, poll/run triggers, serves ui/build/client
├── github.ts           # typed wrapper over the `gh` CLI
├── worktree.ts         # git worktree per issue; bootstraps empty repos (--allow-empty)
├── gates.ts            # deterministic test/lint runner (sh -c in the worktree)
├── exec.ts             # THE ONLY place Bun.spawn is called; injectable Exec type
├── platform.ts         # POSIX/WINDOWS personality (gate shell, agent env allowlist), injected via StageContext
├── config.ts           # valibot schema + resolveConfig: .cue/config.json, repo auto-detect from origin
└── log.ts              # per-invocation transcripts + cost under <target>/.cue/runs/<issue>/
prompts/                # packaged default role prompts; <target>/.cue/prompts/ overrides per file
scripts/fixtures.ts     # snapshots local .cue runs into ui/app/fixtures/data.json
ui/                     # dashboard: react-router (library mode) + React Compiler, shadcn `base-nova`
├── app/routes/home.tsx     # overview: spend summary, cost charts, label board, live log
├── app/routes/runs.tsx     # run explorer: per-run prompt / transcript / raw tabs
├── app/lib/cue.ts    # API client; re-exports app/lib/transcript.ts (normalizer, root-tested)
└── app/fixtures/           # committed run snapshot, used when /api is unreachable
tests/                  # one test file per module + integration.test.ts
tests/helpers/          # makeFakeExec (scripted subprocess replay), makeFakeAdapter
```

## Hard invariants — do not break these

- **All subprocess execution goes through the `Exec` type from `src/exec.ts`.**
  Never call `Bun.spawn` anywhere else; it is what makes every module testable.
- **Lean dependencies.** The CLI package's only runtime deps are valibot and consola. The dashboard is a
  separate package (`ui/package.json`) that owns react, react-router, tailwind and the
  shadcn stack — its deps never enter the CLI's. Do not add packages to either without
  being asked.
- **Label names are exact:** `agent:ready`, `agent:planned`, `agent:approved`,
  `agent:replan`, `agent:in-dev`, `agent:in-review`, `agent:done`, `agent:failed`,
  `agent:stop`. They appear in code, tests, prompts, README, and on real repos —
  change all or none.
- **The plan-comment marker is exactly `<!-- cue:plan -->`** (`PLAN_MARKER` in
  `stages/triage.ts`, defined once). The dev/replan stages find plans by newest
  comment containing it.
- **Branch naming:** `agent/issue-<number>` (WorktreeManager.branch).
- **The GitHub token must never reach agent subprocesses.** `JsonlAdapter.run`
  (adapters/base.ts) scrubs the env via `scrubbedEnv` (platform.ts): OS vars plus the
  adapter's own `envKeys` — never another provider's API key, never `GH_TOKEN`. Every
  adapter test asserts `GH_TOKEN` is absent. Keep them passing.
- **LLMs inside the nodes, plain code between the nodes.** Routing, gating, retries,
  and label transitions are deterministic TypeScript — never ask the model something
  a script can decide (e.g. whether tests passed).
- **Agents never run git/gh side effects.** The runner owns commit, push, PR
  creation, and labels; the prompts forbid the agent from doing so. Cue never
  merges and never touches the base branch.
- **Humans gate two moments:** plan approval (`agent:planned → agent:approved`) and
  PR merge. Do not automate either.
- **Issue bodies and comments are untrusted input** (prompt-injection surface). Every
  prompt states this; keep the security preamble when editing prompts.

## Conventions

- TDD with the existing fakes: write the failing test first. Subprocess-touching code
  is tested with `makeFakeExec` (scripted `{match, result}` replay — `"*"` wildcards,
  prefix matching); agent-touching code with `makeFakeAdapter`. Follow the style in
  any existing test file.
- `tests/triage.test.ts` exports `makeCtx` — the shared StageContext factory used by
  dev/review/replan/pipeline/cleanup/integration tests. Extend it rather than
  duplicating setup.
- TypeScript strict; no `any` except at `gh`/`claude` JSON parse boundaries,
  immediately narrowed to a typed shape.
- Errors: throw with actionable messages; `runIssue` is the single place that turns a
  stage error into an issue comment + `agent:failed`.
- Every adapter invocation is logged via `RunLogger` to `.cue/runs/<issue>/<stage>-*.json`
  (gitignored) with prompt, full event transcript, cost, duration.
- GitHub interactions are tolerant only where distributed state demands it
  (`prState`, `WorktreeManager.remove` — a worktree may live on another machine);
  everything else fails loudly.

## Gotchas

- The pilot/target repo may be empty: `WorktreeManager.create` bootstraps an empty
  initial commit (`--allow-empty`) and pushes it when `origin/<baseBranch>` is missing.
- `claude` CLI flag spellings (`--allowedTools`, `--max-turns`, `--output-format
stream-json --verbose`) are version-dependent; if the adapter breaks after a CLI
  update, check `claude --help` first.
- Cue runs **from inside the target repo** (cwd = repoPath); all per-project
  state lives in the target's `.cue/` directory. Every config field is optional
  (`repo` auto-detects from the origin remote). Config changes must update the valibot
  schema in `config.ts` and the defaults table in `docs/content/guide/config.md`.
- Worktrees default to `~/.cue/worktrees/<owner>-<repo>/issue-<n>` — deliberately
  OUTSIDE the target repo so IDE indexing and repo-root tool globs never see them.
  Do not move them into the repo; `worktreeRoot` in config is the user's override.
- The package is installed globally (`bin: cue` → `src/cli.ts`, shebang + Bun).
  Prompts resolve relative to the _package_ (`import.meta.dir`), never cwd.
- **Release binaries embed all assets.** Prompts embed via `with { type: "file" }`
  imports in `src/embedded.ts`; the dashboard embeds via `src/ui-manifest.g.ts`,
  which is a committed EMPTY stub — `scripts/build-binaries.sh` regenerates it from
  `ui/build/client` (via `scripts/embed-ui.ts`), compiles per-target binaries into
  `dist/`, then restores the stub. Never commit a generated manifest. New disk assets
  (prompts, ui output) must join this embedding path or compiled installs break.
- Releases: push a `v*` tag → `.github/workflows/release.yml` runs
  `scripts/build-binaries.sh` and attaches `dist/cue-*` + `checksums.txt`;
  `install.sh` at the repo root is the user-facing installer (checksum-verified).
- A crashed run leaves `agent:in-dev` stuck; humans reset labels manually
  (`cue status` mentions this).
- `ui/` uses **react-router in LIBRARY mode** (`createBrowserRouter` in
  `app/main.tsx`; routes registered there, NOT file-based) on plain Vite with
  `@vitejs/plugin-react({ compiler: true })` — the **React Compiler automatic
  memoization is ON** (via oxc-transform-react). Do not reintroduce
  `@react-router/dev` (the framework plugin owns the Vite pipeline and blocks the
  compiler). Built to `ui/build/client`, served statically by `src/server.ts` with an
  index.html fallback so client routes survive a refresh. `CLIENT_DIR` resolves
  against `import.meta.dir`, not cwd, because cue is installed globally. After
  changing anything under `ui/app/`, run `bun run ui:build`.
- `ui/` is excluded from the root `tsconfig.json`, oxlint and oxfmt configs, but has
  its OWN: `ui/.oxlintrc.json` (react plugin incl. the React Compiler rules;
  `set-state-in-effect` is deliberately a warning) and `ui/.oxfmtrc.json` (with
  `sortTailwindcss` class sorting — prettier is gone). Run via `bun run ui:lint`,
  `bun run ui:format`, `bun run ui:check` (tsc).
  `bun run check` does NOT cover the SPA — run both.
- **Horizontal-overflow traps in the dashboard.** Two bit us already: (1) `Separator`
  carries `data-horizontal:w-full`, so as a direct `grow` flex sibling it resolves to
  100% of the whole row and pushes the line past the viewport — put it in its own
  `flex-1` wrapper (that is what `SectionHeading` in `shell.tsx` is for); (2) a grid item
  defaults to `min-width: auto`, so a track sizes to its content's min-content and an
  inner `overflow-x-auto` scroller can never constrain itself — use
  `grid-cols-[minmax(0,…)]` plus `min-w-0` on the cards. Verify with
  `document.documentElement.scrollWidth - clientWidth === 0` at 375, 1024 and 1440,
  on both routes; the header needs its own responsive collapse at narrow widths.
- **The label board is not the run archive.** `BOARD_LABELS` in `server.ts` deliberately
  omits `agent:done`, so a completed issue has no board row. Anything listing runs must
  read `RunLogger.index()` (`GET /api/runs`) — the on-disk issue index — not
  `state.columns`, or finished work becomes invisible. The explorer splits the two into
  Active (on the board) and Done (recorded but off the board) tabs; the Overview totals
  union both. `index()` recovers issue titles from the recorded prompts, matching both
  `Issue #<n>: <title>` (triage/replan) and `Issue: <title>` (dev), so archived and even
  deleted issues stay browsable with no `gh` call.
- **`RunEntry.result` is polymorphic.** Older logs store the single `result` event as an
  object; newer ones store the whole event array. Anything reading a transcript must go
  through `normalizeEvents` (`ui/app/lib/transcript.ts`, re-exported by cue.ts and
  covered by `tests/transcript.test.ts`). Getting this wrong renders old
  runs blank while new ones look fine.
- `RunLogger.read` matches the `<stage>-<ts>` id against a directory listing instead of
  joining it into a path — `/api/runs/:issue/:run` takes that id straight from the URL.
  Keep it that way; there is a traversal test.
- Stages emit through `ctx.onEvent` (CueEvent in stages/context.ts) — never
  console.log directly from a stage. The CLI prints events; `cue ui` also
  broadcasts them over SSE.
- Design docs live under `docs/superpowers/` which is **gitignored on purpose** —
  don't try to commit them or "fix" the .gitignore.
