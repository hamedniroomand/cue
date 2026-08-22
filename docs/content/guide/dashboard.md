# Dashboard

`cue ui` serves a local dashboard for the **current** repo. It is localhost only and has no authentication.

```bash
cue ui          # http://127.0.0.1:4224
cue ui 5000
cue ui --no-open
```

It is the same pipeline as the CLI. GitHub labels and `.cue/runs/` stay the shared state either way.

## Overview

- Total agent spend, cost per pipeline stage, cost per issue
- Cumulative spend trajectory
- The `agent:*` label board (active issues only — `agent:done` is omitted on purpose)
- A live log streamed over SSE while stages run

You can trigger `process` and `run` from the dashboard; they execute the same TypeScript as the CLI.

## Runs

A transcript explorer over `.cue/runs/`, split into:

- **Active** — issues still on the label board
- **Done** — recorded runs whose issue has left the board (merged, closed, or `agent:done`)

Pick an issue, pick a recorded stage run, then read:

- the exact prompt that was sent
- the flattened event transcript (tool calls, thinking, results)
- the raw log entry

Denied tool calls are surfaced explicitly. A stage's `--allowedTools` allowlist is a common cause of odd agent behaviour.

Finished work is invisible on the label board by design. Anything listing runs reads the on-disk issue index, so archived and even deleted issues stay browsable with no `gh` call.

## Developing the dashboard

The SPA lives in `ui/` (react-router in library mode, React Compiler, shadcn `base-nova`). The CLI serves the production build from `ui/build/client`.

```bash
bun run ui:build     # required after changing ui/app/
bun run ui:dev       # Vite on :5173, proxies /api to a running cue ui
bun run fixtures     # snapshot local .cue runs so the SPA renders without the API
```

Contributor notes: [Contributing](/develop/contributing#dashboard).
