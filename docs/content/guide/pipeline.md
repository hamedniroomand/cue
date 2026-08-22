# Pipeline

Cue is a state machine over GitHub issue labels. You move issues into `agent:ready`, `agent:approved`, or `agent:replan`. Cue does the rest, then waits for you to merge.

```
human labels agent:ready
        ↓
   cue poll  →  triage posts a plan  →  agent:planned
        ↓
human reviews the plan
   ↙            ↘
agent:replan     agent:approved
   ↓                  ↓
replan posts     cue poll  →  worktree + implement
a revision              ↓
                  test / lint gate
                        ↓
                  draft PR + review loop  →  agent:in-review
                        ↓
                  human merges the PR
                        ↓
                  cleanup  →  agent:done
```

`poll` always starts by reconciling merged and closed PRs ([cleanup](/guide/commands#cleanup)), so a merge on GitHub is enough — you do not have to remember a separate "finish" command.

## The human / Cue loop

| Step | Who | Action |
| --- | --- | --- |
| 1 | human | Label an issue `agent:ready` |
| 2 | you | `cue poll` — triage posts a plan comment, label becomes `agent:planned` |
| 3 | human | Review the plan comment; if good, swap the label to `agent:approved` |
| 4 | you | `cue poll` — dev implements in a git worktree, tests gate the result, a draft PR opens, the review agent comments its verdict, label becomes `agent:in-review` |
| 5 | human | Review and merge the draft PR |

Multiple projects run independently — separate repos, separate labels, separate worktrees. Always run commands from inside the target repo.

## Label state machine

Label names are exact. They appear in code, tests, prompts, and on real repos — change all or none.

| Label | Meaning | Who sets it | Next actor |
| --- | --- | --- | --- |
| `agent:ready` | Maintainer wants the pipeline to pick this up | human | Cue → triage |
| `agent:planned` | Plan posted as an issue comment | Cue | human reviews plan |
| `agent:approved` | Human approved the plan | human | Cue → dev |
| `agent:replan` | Human wants a revised plan (feedback in comments) | human | Cue → replan |
| `agent:in-dev` | Dev stage claimed and running | Cue | Cue |
| `agent:in-review` | Draft PR open, review loop done | Cue | human merges |
| `agent:done` | PR merged; worktree/branch cleaned up | Cue (cleanup) | — |
| `agent:failed` | A stage failed, or the PR was closed unmerged | Cue | human |
| `agent:stop` | Kill switch — Cue skips this issue everywhere | human | — |

A crashed run leaves an issue stuck in `agent:in-dev`. Reset the label by hand to retry (`cue status` lists them).

## Giving feedback on a plan

Two ways, from lightest to heaviest:

1. **Ask the agent to revise (recommended).** Reply to the issue with normal comments ("find a simpler approach", "don't add a framework"), then apply the `agent:replan` label. The next `poll` re-runs triage with the previous plan and your feedback in context — it may also search the web for alternatives — and posts a revised plan (with a `## Revision notes` section). Repeat as many rounds as you like, then apply `agent:approved`.
2. **Edit the plan yourself.** Edit the plan comment directly, or post a new comment containing the `<!-- cue:plan -->` marker. The newest marker comment wins.

Plain reply comments are only read during a replan. The dev agent sees just the final plan.

## What each stage does

- **Triage** is read-only. It reads the issue (untrusted input) and posts a plan comment marked `<!-- cue:plan -->`.
- **Replan** is triage plus your comments and the previous plan.
- **Dev** creates `~/.cue/worktrees/<owner>-<repo>/issue-<n>` on branch `agent/issue-<n>`, implements the plan, then the runner commits, pushes, and opens a **draft** PR. The agent never runs `git` / `gh` side effects.
- **Gate** is deterministic: the runner executes `gate.test` (and optional `gate.lint`) inside the worktree. Pass/fail is not a model decision. One repair attempt if tests fail.
- **Review** posts a JSON verdict on the PR and can loop a bounded number of fix iterations (`reviewFixIterations`).
- **Cleanup** runs at the start of every `poll`: merged PR → `agent:done`; closed unmerged PR → `agent:failed`; worktree and local branch removed either way.

## Safety model

- Cue only acts on issues a maintainer explicitly labeled. Issue bodies and comments are untrusted input; the prompts say so.
- Humans gate the two irreversible moments: plan approval and PR merge. Cue never merges, never force-pushes, never touches the base branch.
- Agent subprocesses run with a scrubbed environment — the GitHub token is never exported to them. Only the runner's own `gh` calls use it.
- Triage and review agents get read-only tools. The dev agent's blast radius is its git worktree; the runner owns commit, push, and PR.
- The worktree boundary is enforced by prompt, not an OS sandbox. For hard enforcement, set [`devBashAllowlist`](/guide/config) in `.cue/config.json`.
- Caps everywhere: per-stage max turns and wall-clock timeouts, one repair attempt at the test gate, `reviewFixIterations` on the review loop, `agent:stop` to freeze an issue.
- Every invocation's prompt, transcript, duration, and cost land in `.cue/runs/<issue>/<stage>-<timestamp>.json` in the target repo (gitignored).
