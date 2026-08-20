# Conductor — Agent Context

Conductor is a deterministic Bun + TypeScript runner that drives headless coding
agents (Claude Code via `claude -p`) through a GitHub-issue pipeline:
**Triage → human approves plan → Dev → Test gate → Review loop → Draft PR → human merges.**
GitHub is the state store: `agent:*` labels are the state machine, issue comments
carry handoffs (the plan), draft PRs are the output. See `README.md` for the
user-facing flow and label table.

## Commands

```bash
bun test               # full suite — runs entirely on fakes: no network, no gh, no claude
bun run lint           # oxlint (config: .oxlintrc.json)
bun run format         # oxfmt — always format after editing; format:check verifies
bun run check          # lint + format:check + tsc --noEmit + tests, all in one
bun run conductor <init|poll|run <n>|cleanup|status>   # the CLI (globally: `conductor`, run from inside a target repo)
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
│   ├── dev.ts          # worktree implementation + gate + draft PR; exports devTools()
│   └── review.ts       # JSON verdict + bounded fix loop; exports parseVerdict, Verdict
├── adapters/
│   ├── types.ts        # AgentAdapter / AgentRunOptions / AgentResult
│   └── claude.ts       # claude -p --output-format stream-json --verbose; env-scrubbed
├── github.ts           # typed wrapper over the `gh` CLI
├── worktree.ts         # git worktree per issue; bootstraps empty repos (--allow-empty)
├── gates.ts            # deterministic test/lint runner (sh -c in the worktree)
├── exec.ts             # THE ONLY place Bun.spawn is called; injectable Exec type
├── config.ts           # valibot schema + resolveConfig: .conductor/config.json, repo auto-detect from origin
└── log.ts              # per-invocation transcripts + cost under <target>/.conductor/runs/<issue>/
prompts/                # packaged default role prompts; <target>/.conductor/prompts/ overrides per file
tests/                  # one test file per module + integration.test.ts
tests/helpers/          # makeFakeExec (scripted subprocess replay), makeFakeAdapter
```

## Hard invariants — do not break these

- **All subprocess execution goes through the `Exec` type from `src/exec.ts`.**
  Never call `Bun.spawn` anywhere else; it is what makes every module testable.
- **Runtime dependency limit: valibot only.** Do not add packages without being asked.
- **Label names are exact:** `agent:ready`, `agent:planned`, `agent:approved`,
  `agent:replan`, `agent:in-dev`, `agent:in-review`, `agent:done`, `agent:failed`,
  `agent:stop`. They appear in code, tests, prompts, README, and on real repos —
  change all or none.
- **The plan-comment marker is exactly `<!-- conductor:plan -->`** (`PLAN_MARKER` in
  `stages/triage.ts`, defined once). The dev/replan stages find plans by newest
  comment containing it.
- **Branch naming:** `agent/issue-<number>` (WorktreeManager.branch).
- **The GitHub token must never reach agent subprocesses.** `ClaudeAdapter` builds a
  scrubbed env from an allowlist; there is a test asserting `GH_TOKEN` is absent.
  Keep it passing.
- **LLMs inside the nodes, plain code between the nodes.** Routing, gating, retries,
  and label transitions are deterministic TypeScript — never ask the model something
  a script can decide (e.g. whether tests passed).
- **Agents never run git/gh side effects.** The runner owns commit, push, PR
  creation, and labels; the prompts forbid the agent from doing so. Conductor never
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
- Every adapter invocation is logged via `RunLogger` to `.conductor/runs/<issue>/<stage>-*.json`
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
- Conductor runs **from inside the target repo** (cwd = repoPath); all per-project
  state lives in the target's `.conductor/` directory. Every config field is optional
  (`repo` auto-detects from the origin remote). Config changes must update the valibot
  schema in `config.ts` and the defaults table in README.
- Worktrees default to `~/.conductor/worktrees/<owner>-<repo>/issue-<n>` — deliberately
  OUTSIDE the target repo so IDE indexing and repo-root tool globs never see them.
  Do not move them into the repo; `worktreeRoot` in config is the user's override.
- The package is installed globally (`bin: conductor` → `src/cli.ts`, shebang + Bun).
  Prompts resolve relative to the _package_ (`import.meta.dir`), never cwd.
- A crashed run leaves `agent:in-dev` stuck; humans reset labels manually
  (`conductor status` mentions this).
- Design docs live under `docs/superpowers/` which is **gitignored on purpose** —
  don't try to commit them or "fix" the .gitignore.
