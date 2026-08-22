# Conductor

A globally-installed CLI that drives headless coding agents through a fixed GitHub-issue pipeline:

**Triage → human approves plan → Dev → Test gate → Review loop → Draft PR → human merges.**

GitHub is the state store: `agent:*` labels are the state machine, issue comments carry the plan, draft PRs are the output. One install drives any number of projects; per-project state lives in `.conductor/`.

**Docs:** [hamedniroomand.github.io/conductor](https://hamedniroomand.github.io/conductor/)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/hamedniroomand/conductor/main/install.sh | bash
```

Needs the `gh` and `claude` CLIs, both authenticated. Then, inside a target repo:

```bash
conductor init
```

Label an issue `agent:ready` and run `conductor poll`. Full walkthrough: [Getting started](https://hamedniroomand.github.io/conductor/guide/getting-started).

## Learn more

- [Pipeline and labels](https://hamedniroomand.github.io/conductor/guide/pipeline) — the human / conductor loop
- [Commands](https://hamedniroomand.github.io/conductor/guide/commands) — `init`, `poll`, `run`, `cleanup`, `status`, `ui`
- [Configuration](https://hamedniroomand.github.io/conductor/guide/config) — `.conductor/config.json`
- [Clone and develop](https://hamedniroomand.github.io/conductor/develop/setup) — contributing to Conductor itself

## License

MIT
