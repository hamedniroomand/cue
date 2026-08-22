# Cue

Cue (pronounced _kyoo_, like “cue the lights”) is a globally-installed CLI that drives headless coding agents through a fixed GitHub-issue pipeline:

**Triage → human approves plan → Dev → Test gate → Review loop → Draft PR → human merges.**

GitHub is the state store: `agent:*` labels are the state machine, issue comments carry the plan, draft PRs are the output. One install drives any number of projects; per-project state lives in `.cue/`.

**Docs:** [hamedniroomand.github.io/cue](https://hamedniroomand.github.io/cue/)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/hamedniroomand/cue/main/install.sh | bash
```

Needs the `gh` and `codex` CLIs, both authenticated. Claude Code (`"adapter": "claude"`) and Antigravity (`"adapter": "antigravity"`) remain available in `.cue/config.json`. Then, inside a target repo:

```bash
cue init
```

Label an issue `agent:ready` and run `cue poll`. Full walkthrough: [Getting started](https://hamedniroomand.github.io/cue/guide/getting-started).

## Learn more

- [Pipeline and labels](https://hamedniroomand.github.io/cue/guide/pipeline) — the human / Cue loop
- [Commands](https://hamedniroomand.github.io/cue/guide/commands) — `init`, `poll`, `run`, `cleanup`, `status`, `ui`
- [Configuration](https://hamedniroomand.github.io/cue/guide/config) — `.cue/config.json`
- [Clone and develop](https://hamedniroomand.github.io/cue/develop/setup) — contributing to Cue itself

## License

MIT
