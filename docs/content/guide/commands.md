# Commands

Every command runs **from inside the target repo** (cwd is the project Cue should act on). The repo is auto-detected from the `origin` remote unless you set `repo` in `.cue/config.json`.

```bash
cue --help
cue --version
```

## init

```bash
cue init          # asks four questions, then sets everything up
cue init --yes    # skip the questions, keep current/default values
```

Creates the `agent:*` labels on the GitHub repo and scaffolds `.cue/` in the current directory:

- `.cue/config.json` — with a [`$schema`](/guide/config#editor-autocompletion) line for editor autocompletion
- `.cue/prompts/` — empty directory for optional prompt overrides
- `.cue/runs/` added to `.gitignore` if it is not already listed

### The questions

In a terminal, `init` asks for the three settings Cue cannot guess, then offers the one opt-in feature nothing else would mention:

| Question | Pre-filled with |
| --- | --- |
| Which agent CLI drives the stages? | your current `adapter`, else `codex` |
| Test command for the gate | your current `gate.test`, else `bun test` |
| Lint command (blank for none) | your current `gate.lint`, else nothing |
| Let review record durable lessons in `.cue/learnings.md`? | `No` |

Answering **Yes** to the last one creates an empty `.cue/learnings.md`, which switches on [review-distilled learnings](/guide/pipeline#living-specs-learnings-opt-in). It writes no config field — the layer is presence-detected, so the file *is* the setting. **Commit the file**: dev, revise and review read it from the worktree, which is created from `origin`, so an uncommitted one is invisible to them.

The question is skipped entirely once `.cue/learnings.md` exists, and `init` never deletes or truncates it — a re-run cannot lose recorded lessons. To switch the layer off, delete the file yourself.

Everything else keeps its default and is edited in the file, where the schema autocompletes it. Answers are pre-filled and editable, so pressing Enter through the whole thing leaves `config.json` byte-identical — `init` doubles as a reconfigure command without risking a tuned setup. Ctrl+C aborts before anything is written.

Switching adapter drops any `models` you had set, because model names are adapter-specific; Cue says so when it happens, and the new adapter's defaults apply.

**Non-interactive runs never prompt.** When stdin or stdout is not a TTY — CI, a pipe, `cue init | tee` — or when you pass `--yes`, `init` skips the questions entirely and behaves as it always has.

Safe to re-run: labels that already exist are refreshed in place, and an existing config is only rewritten if your answers actually changed something.

## process

```bash
cue process
```

The main loop. It:

1. Reconciles finished PRs ([cleanup](#cleanup)).
2. Lists issues labeled `agent:ready`, `agent:replan`, `agent:approved`, or `agent:revise`.
3. Runs the next stage for each one.

Use this after you label work, after you approve a plan, and after you merge.

## poll

```bash
cue poll
```

Compatibility alias for `cue process`. New scripts and documentation should use `process`.

## run

```bash
cue run [n]
```

Runs the next pipeline stage for a single issue. Pass an issue number (`cue run 42`) or run `cue run` without arguments to select from an interactive list of actionable issues (`agent:ready`, `agent:approved`, `agent:replan`, or `agent:revise`), sorted newest to oldest (latest pre-selected).

**Non-interactive runs never prompt.** When stdin or stdout is not a TTY — CI, a pipe — `cue run` without a number errors with the usage line. Pass the issue number instead.

Useful when you want to drive one issue without scanning the whole board.

## cleanup

```bash
cue cleanup
```

Reconciles merged and closed PRs for Cue-managed issues:

- merged → `agent:done`
- closed unmerged → `agent:failed`
- worktree and local `agent/issue-<n>` branch removed either way

It also reclaims stale claims: an `agent:in-dev` issue whose label is older than [`staleClaimMinutes`](/guide/config#fields) (default 90) with no run finishing it — a crashed or rebooted runner — is reset to `agent:approved` with an explanatory comment, so the next `process` simply picks it up again. The claim's age is read from the GitHub label event, so any machine can do the reclaiming. An issue carrying both `agent:failed` and `agent:in-dev` is healed instead — the leftover claim is removed and the failure waits for a human, however old the claim is.

Also runs at the start of every `process`. Call it on its own if you merged on GitHub and want local worktrees gone without kicking the rest of the pipeline.

## status

```bash
cue status
```

Prints issues in each active pipeline state, local spend per issue (from `.cue/runs/`), and the worktree root.

Stale `agent:in-dev` claims (crashed runs) are reset automatically by [`cleanup`](#cleanup) after `staleClaimMinutes`.

## checkout

Issue branches live in worktrees under `worktreeRoot`, so a plain `git checkout agent/issue-<n>` in the target repo fails with "already used by worktree". `cue checkout` reviews a branch in the target repo itself by detaching HEAD onto it, then restores your previous branch when you are done.

```bash
cue checkout 42     # detach onto agent/issue-42 to review it
cue checkout        # interactive picker (TTY only)
cue checkout exit   # leave review mode, restore the previous branch
```

`cue checkout <n>` refuses if the working tree is dirty, if you are already in review mode, or if HEAD is already detached. It records the branch you were on in the local git config (`cue.review.prev`) — no state file, nothing to gitignore. It always fetches `origin/agent/issue-<n>` first and detaches onto the fetched tip, so you review the branch's latest pushed state even when a stale local copy exists; when the fetch fails (offline, or the branch was never pushed) it falls back to the local branch.

`cue checkout` with no argument opens an interactive list of local `agent/issue-*` branches, with issue titles recovered from `.cue/runs/` (no `gh` call needed). If you are already in review mode, it offers to exit instead of listing branches.

`cue checkout exit` restores the branch recorded in `cue.review.prev` and clears it. It refuses if the working tree is dirty, so review-time edits are never silently lost, and errors if you are not in review mode.

**Non-interactive runs never prompt.** When stdin or stdout is not a TTY, `cue checkout` without an argument errors with the usage line — pass an issue number or `exit` instead.

## ui

```bash
cue ui          # http://127.0.0.1:4224, opens a browser
cue ui 5000     # pick a port
cue ui --no-open
```

Serves the [local dashboard](/guide/dashboard) for the current repo. Localhost only, no authentication.

## upgrade

Updates a release-installed `cue` to the latest GitHub release, in place — the
downloaded binary is SHA-256-verified against the release's `checksums.txt`
before it replaces the running one.

```bash
cue upgrade
```

```
Cue v0.4.0 is out! You're on v0.3.0
[3.12s] Upgraded.
Welcome to Cue v0.4.0!
```

Works from any directory (no target repo needed). Source checkouts are not
upgradable this way — use `git pull` there instead. On Windows the previous
binary is left beside the new one as `cue.exe.old`.
