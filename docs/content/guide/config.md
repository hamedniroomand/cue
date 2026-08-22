# Configuration

All project-specific state lives in the **target** repo, not in the Cue install:

```
.cue/
├── config.json    # optional — every field has a default
├── prompts/       # optional overrides: triage.md, replan.md, dev.md, review.md, fix.md
└── runs/          # transcripts + costs (gitignored)
```

`cue init` writes a minimal `config.json`. You can also start from an empty file or omit fields you do not care about. `repo` is auto-detected from `origin` when unset.

## Fields

| Field | Default | Notes |
| --- | --- | --- |
| `repo` | from the `origin` remote | `owner/name` |
| `adapter` | `"claude"` | `"codex"` is planned and currently exits with a clear error |
| `models` | triage `haiku`, dev `sonnet`, review `sonnet` | Passed to the Claude CLI |
| `maxTurns` | triage 15, dev 60, review 25 | Per-stage turn cap |
| `gate` | `{ "test": "bun test" }` | Optional `lint` string. Run in the worktree via `sh -c` |
| `reviewFixIterations` | `2` | Bounded review → fix loop |
| `devBashAllowlist` | unset | Claude permission patterns such as `"bun *"`, `"git status"`. Unset = unrestricted Bash for dev/fix agents |
| `worktreeRoot` | `~/.cue/worktrees/<owner>-<repo>` | Deliberately **outside** the target repo |
| `baseBranch` | `"main"` | Branch draft PRs target |
| `staleClaimMinutes` | `90` | How long an `agent:in-dev` claim is considered live |

Example:

```json
{
  "gate": {
    "test": "npm test",
    "lint": "npm run lint"
  },
  "models": {
    "triage": "haiku",
    "dev": "sonnet",
    "review": "sonnet"
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

Packaged role prompts live with the CLI. A file of the same name under `.cue/prompts/` wins:

| File | Stage |
| --- | --- |
| `triage.md` | Plan generation |
| `replan.md` | Plan revision from comments |
| `dev.md` | Implementation |
| `review.md` | Verdict |
| `fix.md` | Review-loop repair |

Issue bodies and comments are untrusted input. Keep the security preamble if you edit a prompt.

## Worktrees

Default path: `~/.cue/worktrees/<owner>-<repo>/issue-<n>` on branch `agent/issue-<n>`.

They sit outside the target repo so IDE indexing and repo-root tool globs never see them. Do not move them into the repo; set `worktreeRoot` if you need a different location.

The target repo may be empty: Cue bootstraps an empty initial commit (`--allow-empty`) and pushes it when `origin/<baseBranch>` is missing.

## Runs and cost

Every adapter invocation is logged under `.cue/runs/<issue>/<stage>-<timestamp>.json` with the prompt, full event transcript, duration, and cost. The [dashboard](/guide/dashboard) reads this directory. Do not commit it.
