import { join, resolve } from "node:path";
import type { Issue } from "./github";
import { poll, runIssue } from "./pipeline";
import type { ConductorEvent, StageContext } from "./stages/context";

/** Built SPA output (ui/ is a react-router app in SPA mode). Resolved against
 *  the package, not cwd, because conductor is installed globally. */
const CLIENT_DIR = resolve(import.meta.dir, "..", "ui", "build", "client");

const NOT_BUILT =
  "conductor dashboard is not built yet — run `bun run ui:build` in the conductor package.";

/** Serve the SPA, falling back to index.html so client-side routes survive a
 *  refresh. Requests that resolve outside CLIENT_DIR are refused. */
async function serveClient(pathname: string): Promise<Response> {
  const index = Bun.file(join(CLIENT_DIR, "index.html"));
  if (pathname !== "/") {
    const target = resolve(CLIENT_DIR, `.${pathname}`);
    if (target.startsWith(CLIENT_DIR + "/")) {
      const file = Bun.file(target);
      if (await file.exists()) return new Response(file);
    }
  }
  if (await index.exists()) {
    return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
  return new Response(NOT_BUILT, { status: 503, headers: { "Content-Type": "text/plain" } });
}

const BOARD_LABELS = [
  "agent:ready",
  "agent:planned",
  "agent:approved",
  "agent:replan",
  "agent:in-dev",
  "agent:in-review",
  "agent:failed",
];

const ACTIONABLE = ["agent:ready", "agent:approved", "agent:replan"];

export interface BoardIssue {
  number: number;
  title: string;
  labels: string[];
  cost: number;
}

export interface DashboardState {
  repo: string;
  worktreeRoot: string;
  models: { triage: string; dev: string; review: string };
  busy: string | null;
  columns: Array<{ label: string; issues: BoardIssue[] }>;
}

export async function buildState(ctx: StageContext, busy: string | null): Promise<DashboardState> {
  const columns = [];
  for (const label of BOARD_LABELS) {
    const issues = await ctx.github.listIssues(label);
    const board: BoardIssue[] = [];
    for (const i of issues) {
      board.push({
        number: i.number,
        title: i.title,
        labels: i.labels,
        cost: await ctx.logger.totalCost(i.number),
      });
    }
    columns.push({ label, issues: board });
  }
  return {
    repo: ctx.config.repo,
    worktreeRoot: ctx.config.worktreeRoot,
    models: ctx.config.models,
    busy,
    columns,
  };
}

async function findActionable(ctx: StageContext, n: number): Promise<Issue | undefined> {
  for (const label of ACTIONABLE) {
    const issue = (await ctx.github.listIssues(label)).find((i) => i.number === n);
    if (issue) return issue;
  }
  return undefined;
}

export function startServer(ctx: StageContext, port: number): { url: string; stop: () => void } {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let busy: string | null = null;

  const printer = ctx.onEvent;
  ctx.onEvent = (e: ConductorEvent) => {
    printer(e);
    const chunk = encoder.encode(`data: ${JSON.stringify(e)}\n\n`);
    for (const client of clients) {
      try {
        client.enqueue(chunk);
      } catch {
        clients.delete(client);
      }
    }
  };

  function launch(name: string, task: () => Promise<void>): Response {
    if (busy) return Response.json({ error: `busy: ${busy}` }, { status: 409 });
    busy = name;
    task()
      .catch((err) => {
        ctx.onEvent({
          ts: Date.now(),
          issue: 0,
          stage: name,
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        busy = null;
        ctx.onEvent({
          ts: Date.now(),
          issue: 0,
          stage: name,
          kind: "done",
          message: `${name} finished`,
        });
      });
    return Response.json({ started: name });
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    routes: {
      "/api/state": async () => Response.json(await buildState(ctx, busy)),
      // Sourced from disk, not the label board: archived issues (agent:done,
      // closed) still have runs worth reading.
      "/api/runs": async () => Response.json(await ctx.logger.index()),
      "/api/runs/:issue": async (req: Bun.BunRequest<"/api/runs/:issue">) =>
        Response.json(await ctx.logger.list(Number(req.params.issue))),
      "/api/runs/:issue/:run": async (req: Bun.BunRequest<"/api/runs/:issue/:run">) => {
        const detail = await ctx.logger.read(Number(req.params.issue), req.params.run);
        if (!detail) return Response.json({ error: "run not found" }, { status: 404 });
        return Response.json(detail);
      },
      "/api/poll": { POST: () => launch("poll", () => poll(ctx)) },
      "/api/run/:issue": {
        POST: async (req: Bun.BunRequest<"/api/run/:issue">) => {
          const n = Number(req.params.issue);
          const issue = await findActionable(ctx, n);
          if (!issue) {
            return Response.json({ error: `issue #${n} is not actionable` }, { status: 404 });
          }
          return launch(`run #${n}`, () => runIssue(ctx, issue));
        },
      },
      "/api/events": () => {
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            clients.add(c);
            c.enqueue(encoder.encode(": connected\n\n"));
          },
          cancel() {
            clients.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
      "/*": (req: Request) => serveClient(new URL(req.url).pathname),
    },
  });

  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}
