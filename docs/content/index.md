---
layout: home

hero:
  name: Conductor
  text: Headless coding agents, a fixed pipeline
  tagline: Triage → human approves plan → Dev → Test gate → Review → Draft PR → human merges. GitHub is the state store.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/hamedniroomand/conductor

features:
  - title: GitHub is the state store
    details: Labels are the state machine, issue comments carry the plan, draft PRs are the output. Runs are resumable from any machine and auditable in the issue thread.
  - title: Humans gate the irreversible steps
    details: A person approves the plan and merges the PR. Conductor never merges, never force-pushes, and never touches the base branch.
  - title: Agents at the nodes, code between them
    details: Each stage is one fresh headless claude -p invocation. Routing, test gates, retries, and label transitions are deterministic TypeScript.
  - title: Isolated worktrees
    details: Implementation happens in a git worktree outside the target repo. The runner owns commit, push, and PR creation — agents do not.
  - title: One install, many projects
    details: Install the CLI once. Per-project state lives in .conductor/ inside each target repo — config, prompt overrides, and run transcripts.
  - title: Local dashboard
    details: conductor ui shows spend, the label board, a live log, and every recorded prompt and transcript. Localhost only, no auth.
---
