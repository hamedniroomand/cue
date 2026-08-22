---
layout: home

hero:
  name: Cue
  text: Headless coding agents, a fixed pipeline
  tagline: Turn GitHub issues into tested, reviewed draft PRs. Human-in-the-loop where it counts, headless execution where it's tedious.
  image:
    src: /logo.svg
    alt: Cue
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/hamedniroomand/cue

features:
  - icon: 🐙
    title: GitHub is the state store
    details: Labels are the state machine, issue comments carry the plan, draft PRs are the output. Runs are resumable from any machine and fully auditable in the issue thread.
  - icon: 🛡️
    title: Humans gate the irreversible steps
    details: You approve the implementation plan and merge the final PR. Cue never merges, never force-pushes, and never touches the base branch.
  - icon: 🧪
    title: Deterministic quality gates
    details: Real test and lint commands gate every change in the worktree. Code validation is deterministic TypeScript and shell execution — never LLM self-judgment.
  - icon: 🌲
    title: Isolated worktrees & scrubbed secrets
    details: Implementation happens in git worktrees outside the target repo. GitHub tokens are completely scrubbed from agent subprocess environments.
  - icon: 🤖
    title: Multi-engine flexibility
    details: Switch seamlessly between OpenAI Codex, Claude Code, and Google Antigravity. One unified config and workflow across all your projects.
  - icon: 📊
    title: Local zero-config dashboard
    details: cue ui displays active spend, the label board, streaming live logs, and recorded prompts and transcripts. Localhost only, no external backend.
---

<div class="vp-doc" style="max-width: 900px; margin: 48px auto 0; padding: 0 24px;">

## How it works

Cue turns interactive coding agents into an asynchronous PR factory. Instead of watching an agent type in your terminal, you interact entirely through GitHub issues and pull requests.

```mermaid
flowchart LR
  ready[1. Issue labeled agent:ready] --> triage[2. Headless Agent drafts Plan]
  triage --> plan[3. You review & approve plan]
  plan --> dev[4. Agent implements in Worktree]
  dev --> gate[5. Deterministic Test & Lint Gate]
  gate --> review[6. Automated Code Review Loop]
  review --> pr[7. Draft PR created]
  pr --> merge[8. You review & merge PR]
```

### Why Cue?

| Interactive Terminal Agents | The Cue Pipeline |
| :--- | :--- |
| **Blocks your terminal**: You babysit streaming output and prompt responses. | **Asynchronous**: Label an issue `agent:ready`, close your laptop, and check back later. |
| **Unchecked architecture**: Agent immediately edits files, sometimes taking the wrong approach. | **Plan approval first**: Agent drafts a plan (`agent:planned`). Implementation only starts once you approve (`agent:approved`). |
| **LLM self-evaluation**: Agent decides subjectively whether its changes work. | **Deterministic gates**: Real test scripts (`bun test`, `npm test`, `pytest`) must pass before a PR is opened. |
| **Dirty working tree**: Agent modifies your active git working copy. | **Worktree isolation**: Agent works in an isolated worktree outside your project root. |
| **Unsafe git operations**: Agents can commit, push, or pollute git history. | **Runner ownership**: Cue owns commits, pushes, and draft PRs; the agent never gets `GH_TOKEN`. |

</div>
