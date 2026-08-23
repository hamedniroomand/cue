import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Issue } from '@/github';
import { poll, runIssue } from '@/pipeline';
import type { CueEvent, StageContext } from '@/stages/context';
import { PLAN_MARKER } from '@/stages/triage';
import { UI_FILES } from '@/ui-manifest.g';

/** Built SPA output (ui/ is a react-router app in SPA mode). Resolved against
 *  the package, not cwd, because cue is installed globally. Read lazily —
 *  and overridable via env — so tests can point it at a fixture directory. */
function clientDir(): string {
  return process.env.CUE_CLIENT_DIR ?? resolve(import.meta.dir, '..', 'ui', 'build', 'client');
}

const NOT_BUILT = 'Cue dashboard is not built yet — run `bun run ui:build` in the Cue package.';

/** Serve the SPA, falling back to index.html so client-side routes survive a
 *  refresh. Compiled binaries serve from the embedded UI_FILES manifest;
 *  dev mode serves ui/build/client from disk. Requests that resolve outside
 *  the client dir are refused. */
async function serveClient(pathname: string): Promise<Response> {
  if (Object.keys(UI_FILES).length > 0) {
    const hit = UI_FILES[pathname === '/' ? '/index.html' : pathname];
    if (hit) return new Response(Bun.file(hit));
    const index = UI_FILES['/index.html'];
    if (index) {
      return new Response(Bun.file(index), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
  }
  const dir = clientDir();
  const index = Bun.file(join(dir, 'index.html'));
  if (pathname !== '/') {
    const target = resolve(dir, `.${pathname}`);
    // Separator-agnostic containment check: on Windows resolve() returns
    // backslashes, so a `startsWith(dir + "/")` guard would reject every
    // asset and silently serve index.html as text/html for all of them.
    const rel = relative(dir, target);
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      const file = Bun.file(target);
      if (await file.exists()) return new Response(file);
    }
  }
  if (await index.exists()) {
    return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return new Response(NOT_BUILT, { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

export const BOARD_LABELS = [
  'agent:ready',
  'agent:planned',
  'agent:approved',
  'agent:replan',
  'agent:in-dev',
  'agent:in-review',
  'agent:revise',
  'agent:failed',
];

const ACTIONABLE = ['agent:ready', 'agent:approved', 'agent:replan', 'agent:revise'];

export interface BoardIssue {
  number: number;
  title: string;
  labels: string[];
  cost: number;
  /** Total tokens across every recorded run. 0 when nothing ran here yet. */
  tokens: number;
}

export interface DashboardState {
  repo: string;
  worktreeRoot: string;
  models: { triage: string; dev: string; review: string };
  busy: string | null;
  columns: Array<{ label: string; issues: BoardIssue[] }>;
}

export async function buildState(ctx: StageContext, busy: string | null): Promise<DashboardState> {
  // One rollup sweep for the whole board — an issue with no runs on this
  // machine simply misses the lookup and reports zeros — and the label
  // queries fetched in parallel chunks; both keep /api/state fast.
  const [index, byLabel] = await Promise.all([
    ctx.logger.index(),
    ctx.github.listIssuesByLabel(BOARD_LABELS),
  ]);
  const totals = new Map(index.map((e) => [e.issue, e]));
  const columns = BOARD_LABELS.map((label) => ({
    label,
    issues: (byLabel.get(label) ?? []).map((i): BoardIssue => ({
      number: i.number,
      title: i.title,
      labels: i.labels,
      cost: totals.get(i.number)?.costUsd ?? 0,
      tokens: totals.get(i.number)?.tokens ?? 0,
    })),
  }));
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

export function startServer(
  ctx: StageContext,
  port: number,
  hostname = '127.0.0.1',
): { url: string; stop: () => void } {
  const encoder = new TextEncoder();
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let busy: string | null = null;

  const printer = ctx.onEvent;
  ctx.onEvent = (e: CueEvent) => {
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

  function launch(name: string, task: () => Promise<unknown>): Response {
    if (busy) return Response.json({ error: `busy: ${busy}` }, { status: 409 });
    busy = name;
    task()
      .catch((err) => {
        ctx.onEvent({
          ts: Date.now(),
          issue: 0,
          stage: name,
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        busy = null;
        ctx.onEvent({
          ts: Date.now(),
          issue: 0,
          stage: name,
          kind: 'done',
          message: `${name} finished`,
        });
      });
    return Response.json({ started: name });
  }

  const server = Bun.serve({
    hostname,
    port,
    idleTimeout: 0,
    routes: {
      '/api/state': async () => Response.json(await buildState(ctx, busy)),
      // Sourced from disk, not the label board: archived issues (agent:done,
      // closed) still have runs worth reading.
      '/api/runs': async () => Response.json(await ctx.logger.index()),
      '/api/runs/:issue': async (req: Bun.BunRequest<'/api/runs/:issue'>) =>
        Response.json(await ctx.logger.list(Number(req.params.issue))),
      '/api/runs/:issue/:run': async (req: Bun.BunRequest<'/api/runs/:issue/:run'>) => {
        const detail = await ctx.logger.read(Number(req.params.issue), req.params.run);
        if (!detail) return Response.json({ error: 'run not found' }, { status: 404 });
        return Response.json(detail);
      },
      '/api/poll': { POST: () => launch('poll', () => poll(ctx)) },
      // One-click plan approval: the human still gates, without leaving the
      // dashboard. Swap first — even when the runner is busy the approval
      // sticks and the next poll picks the issue up.
      '/api/approve/:issue': {
        POST: async (req: Bun.BunRequest<'/api/approve/:issue'>) => {
          const n = Number(req.params.issue);
          const issue = (await ctx.github.listIssues('agent:planned')).find((i) => i.number === n);
          if (!issue) {
            return Response.json(
              { error: `issue #${n} is not awaiting plan approval` },
              { status: 404 },
            );
          }
          await ctx.github.swapLabel(n, 'agent:planned', 'agent:approved');
          const approved: Issue = {
            ...issue,
            labels: [...issue.labels.filter((l) => l !== 'agent:planned'), 'agent:approved'],
          };
          if (busy) return Response.json({ approved: true, started: false });
          launch(`run #${n}`, () => runIssue(ctx, approved));
          return Response.json({ approved: true, started: true });
        },
      },
      // One-click retry for a failed issue. Routing is deterministic: back to
      // replan when a revision was pending, to dev when a plan already exists
      // (with a fresh worktree), to triage from scratch otherwise.
      '/api/retry/:issue': {
        POST: async (req: Bun.BunRequest<'/api/retry/:issue'>) => {
          const n = Number(req.params.issue);
          const issue = (await ctx.github.listIssues('agent:failed')).find((i) => i.number === n);
          if (!issue) {
            return Response.json({ error: `issue #${n} is not failed` }, { status: 404 });
          }
          const target = issue.labels.includes('agent:planned')
            ? 'agent:replan'
            : (await ctx.github.findComment(n, PLAN_MARKER))
              ? 'agent:approved'
              : 'agent:ready';
          // A dev retry starts clean: the failed run's worktree may hold
          // half-applied changes the fresh run must not inherit.
          if (target === 'agent:approved') await ctx.worktrees.remove(n);
          await ctx.github.swapLabel(n, 'agent:failed', target);
          const retried: Issue = {
            ...issue,
            labels: [...issue.labels.filter((l) => l !== 'agent:failed'), target],
          };
          if (busy) return Response.json({ retried: true, to: target, started: false });
          launch(`run #${n}`, () => runIssue(ctx, retried));
          return Response.json({ retried: true, to: target, started: true });
        },
      },
      // Request a revised plan: post the human's feedback (the replan stage
      // reads comments after the plan marker), then relabel and run.
      '/api/replan/:issue': {
        POST: async (req: Bun.BunRequest<'/api/replan/:issue'>) => {
          const n = Number(req.params.issue);
          const issue = (await ctx.github.listIssues('agent:planned')).find((i) => i.number === n);
          if (!issue) {
            return Response.json(
              { error: `issue #${n} is not awaiting plan approval` },
              { status: 404 },
            );
          }
          const body = (await req.json().catch(() => ({}))) as { feedback?: string };
          const feedback = body.feedback?.trim();
          if (feedback) await ctx.github.comment(n, feedback);
          await ctx.github.swapLabel(n, 'agent:planned', 'agent:replan');
          const replan: Issue = {
            ...issue,
            labels: [...issue.labels.filter((l) => l !== 'agent:planned'), 'agent:replan'],
          };
          if (busy) return Response.json({ replanRequested: true, started: false });
          launch(`run #${n}`, () => runIssue(ctx, replan));
          return Response.json({ replanRequested: true, started: true });
        },
      },
      '/api/run/:issue': {
        POST: async (req: Bun.BunRequest<'/api/run/:issue'>) => {
          const n = Number(req.params.issue);
          const issue = await findActionable(ctx, n);
          if (!issue) {
            return Response.json({ error: `issue #${n} is not actionable` }, { status: 404 });
          }
          return launch(`run #${n}`, () => runIssue(ctx, issue));
        },
      },
      '/api/events': () => {
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            clients.add(c);
            c.enqueue(encoder.encode(': connected\n\n'));
          },
          cancel() {
            clients.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
      '/*': (req: Request) => serveClient(new URL(req.url).pathname),
    },
  });

  return { url: server.url.origin, stop: () => server.stop(true) };
}
