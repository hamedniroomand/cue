# Why Cue

Agent CLIs such as Claude Code and Codex have built-in orchestration. They can start subagents in a session. A strong model can send small tasks to models that cost less. This page tells you the difference between that function and Cue. It also tells you when you do not need Cue.

## Two different layers

Built-in orchestration and Cue operate at two different layers.

Built-in orchestration divides one task in one session. The session runs while your terminal is open. When the session stops, the orchestration stops. Its state is lost.

Cue controls the full life of a task. Cue reads GitHub issues and moves each issue through a fixed [pipeline](/guide/pipeline). The pipeline continues across days, machines, and restarts. GitHub labels keep the state.

Cue does not replace your agent CLI. Cue starts your agent CLI at each stage of the pipeline. If your agent CLI gets better orchestration, Cue also gets the benefit.

## What built-in orchestration can do

A session with subagents can do this:

- Divide one prompt into small tasks.
- Send each small task to a different model.
- Collect the results in the same session.

These functions are good, and Cue does not compete with them. But they exist only in one session, for one task, while you monitor the terminal.

## What Cue adds

Cue supplies functions that one session cannot supply.

| Function | One agent session | Cue |
| --- | --- | --- |
| Task source | One prompt that you type | A queue of GitHub issues |
| State | Lost when the session stops | Kept in GitHub labels |
| Plan approval | Not available | You approve the plan before the agent writes code |
| Test gate | The model examines its own work | Your real test commands decide pass or fail |
| Output | Text in your terminal | A draft pull request |
| Feedback loop | Not available | Label `agent:revise` sends your PR comments back to the agent |
| Runs while you are away | No | Yes |

### The state is safe

Cue writes the state of each issue to GitHub labels. Your machine can stop, and the state stays. You can continue on a different machine. You can see the state of all issues in the GitHub UI.

### You keep control

Cue stops at two points and waits for you:

1. You read the plan and set the label `agent:approved`.
2. You read the draft pull request and merge it.

The agent never touches your base branch. The agent cannot push code without a test gate.

### The gates are deterministic

Cue runs your real test and lint commands in an isolated worktree. The exit codes decide pass or fail. Cue does not ask the model if the code is correct. A model can make errors about its own work. An exit code cannot.

## The cost argument

Some persons use one strong model as an orchestrator. The strong model sends tasks to models that cost less. This decreases the cost of one session.

Cue does the same at the pipeline level. You can set a different model for each stage in `.cue/config.json`:

```json
{
  "adapter": "claude",
  "models": { "triage": "haiku", "dev": "sonnet", "review": "sonnet" }
}
```

A small model makes the plan, because triage is a small task. A strong model writes the code. This is the default configuration. See [Configuration](/guide/config).

There is a second cost benefit. One session keeps all steps in one context window. The context grows with each step, and the model reads the full history again at each step. In Cue, each stage starts with a new, small context. Each stage receives only the data that it needs. The triage stage receives the issue. The dev stage receives the approved plan. The review stage receives the diff. A small context costs less, and it gives better model performance.

There is a third cost benefit. An orchestrator model stays in the session for the full time. It uses tokens for coordination. In Cue, plain TypeScript does the coordination between stages. Code that is not a model costs zero tokens.

There is also a benefit in your time. In one session, you must give the orchestrator the full procedure: the tasks, the tests, and the review steps. In Cue, the procedure is fixed in the pipeline and the role prompts. You only write the issue and approve the plan.

## When you do not need Cue

Cue is not the correct tool for each situation. Be sure that Cue is applicable to you:

- You have one small task, and you are at your terminal. Use your agent CLI directly.
- You want an agent that is fully integrated with GitHub, and one supplier is sufficient. Use the GitHub Copilot coding agent.
- Your tasks have no tests. Cue's test gate then gives less value. Add tests first.

Use Cue when you want these things:

- A choice of agent engines, with the subscription that you already pay for.
- Agents that run on your machine, not on a third-party server.
- A plan that you approve before the agent writes code.
- Test gates that a model cannot bypass.
- A record of the cost of each run, in the [dashboard](/guide/dashboard).
