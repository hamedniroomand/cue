import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BOARD_LABELS, buildState, fanOut, startServer } from '@/server';
import { UI_FILES } from '@/ui-manifest.g';

import { makeCtx } from './triage.test';

// The server serves ui/build/client, which does not exist on a fresh checkout
// (CI runs `check` before `ui:build`). Point it at a fixture dir instead so
// these tests never depend on a real dashboard build.
beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cue-client-'));
  await Bun.write(join(dir, 'index.html'), '<!doctype html><title>cue fixture</title>');
  process.env.CUE_CLIENT_DIR = dir;
});

/** Boot the dashboard server on an ephemeral port. */
/** Bind the dashboard for a test. Plain 127.0.0.1 (any port, any API) fails
 *  under Bun on GitHub's windows runners, so try loopback spellings in order
 *  and log the first that binds — the CI output then documents which one
 *  works there. Locally 127.0.0.1 wins on the first attempt. */
let boundHost: string | undefined;
async function serve() {
  const { ctx } = await makeCtx([], []);
  const errors: string[] = [];
  for (const host of boundHost ? [boundHost] : ['127.0.0.1', 'localhost', '::1']) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { url, stop } = startServer(ctx, 0, host);
        if (boundHost !== host) {
          boundHost = host;
          console.error(`dashboard tests: bound via ${host}`);
        }
        return { ctx, url, stop };
      } catch (err) {
        errors.push(`${host}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  throw new Error(`no loopback hostname bindable:\n${errors.join('\n')}`);
}

// Bun 1.4.0 (the Rust rewrite) cannot listen() on Windows CI: every loopback
// bind — any hostname, any port, Bun.serve and node:net alike — fails with
// EADDRINUSE errno 0. Pinning bun 1.3.14 is not an option (it cannot read the
// v2 lockfile 1.4 writes), so skip the only listening suite there until the
// upstream regression is fixed, then remove this guard.
const bunWindowsListenBroken = process.platform === 'win32';

describe.skipIf(bunWindowsListenBroken)('dashboard server', () => {
  test('startServer binds the requested hostname and reports it in the url', async () => {
    const { ctx } = await makeCtx([], []);
    const { url, stop } = startServer(ctx, 0, 'localhost');
    try {
      expect(url).toContain('localhost');
      const res = await fetch(`${url}/api/runs`);
      expect(res.status).toBe(200);
    } finally {
      stop();
    }
  });

  test('serves the SPA at / and falls back to index.html for client routes', async () => {
    const { url, stop } = await serve();
    try {
      for (const path of ['/', '/runs', '/runs/3']) {
        const res = await fetch(`${url}${path}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
      }
    } finally {
      stop();
    }
  });

  test('serves real assets from the client dir with their own content type', async () => {
    await Bun.write(join(process.env.CUE_CLIENT_DIR!, 'assets', 'app.js'), 'console.log(1);');
    const { url, stop } = await serve();
    try {
      const res = await fetch(`${url}/assets/app.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).not.toContain('text/html');
      expect(await res.text()).toBe('console.log(1);');
    } finally {
      stop();
    }
  });

  test('refuses to serve files outside the built client directory', async () => {
    const { url, stop } = await serve();
    try {
      const res = await fetch(`${url}/../package.json`);
      const body = await res.text();
      // Traversal is answered with the SPA shell, never the package manifest.
      expect(body).not.toContain('"name": "cue"');
      expect(body).not.toContain('"bin"');
    } finally {
      stop();
    }
  });

  test('GET /api/runs/:issue/:run returns the recorded prompt and transcript', async () => {
    const { ctx, url, stop } = await serve();
    try {
      const path = await ctx.logger.log(4, 'triage', {
        prompt: 'the exact prompt',
        result: [{ type: 'result', result: 'done' }],
        costUsd: 0.01,
        durationMs: 1234,
        outcome: 'ok',
      });
      const id = path.split(/[\\/]/).pop()!.replace('.json', '');

      const res = await fetch(`${url}/api/runs/4/${id}`);
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.stage).toBe('triage');
      expect(detail.prompt).toBe('the exact prompt');
      expect(detail.durationMs).toBe(1234);
      expect(detail.result).toEqual([{ type: 'result', result: 'done' }]);
    } finally {
      stop();
    }
  });

  test('GET /api/runs/:issue/:run 404s for unknown and traversal ids', async () => {
    const { url, stop } = await serve();
    try {
      for (const id of ['nope-1', '..%2Fsecret']) {
        const res = await fetch(`${url}/api/runs/4/${id}`);
        expect(res.status).toBe(404);
      }
    } finally {
      stop();
    }
  });

  test('POST /api/approve/:issue swaps agent:planned → agent:approved and starts the run', async () => {
    const PLANNED = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:planned' }] },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:planned'],
          result: { stdout: PLANNED },
        },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:planned',
            '--add-label',
            'agent:approved',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/approve/7`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ approved: true, started: true });
    } finally {
      stop();
    }
  });

  test('POST /api/approve/:issue 404s when the issue is not awaiting approval', async () => {
    const { ctx } = await makeCtx(
      [{ match: ['gh', 'issue', 'list'], result: { stdout: '[]' } }],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/approve/7`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  test('POST /api/replan/:issue posts the feedback, swaps to agent:replan, starts the run', async () => {
    const PLANNED = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:planned' }] },
    ]);
    const { ctx, calls } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:planned'],
          result: { stdout: PLANNED },
        },
        { match: ['gh', 'issue', 'comment', '7'] },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:planned',
            '--add-label',
            'agent:replan',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/replan/7`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'avoid heavy frameworks please' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ replanRequested: true, started: true });
      expect(
        calls.some(
          (c) => c.includes('comment') && c.join(' ').includes('avoid heavy frameworks please'),
        ),
      ).toBe(true);
    } finally {
      stop();
    }
  });

  test('POST /api/replan/:issue without feedback skips the comment', async () => {
    const PLANNED = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:planned' }] },
    ]);
    const { ctx, calls } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:planned'],
          result: { stdout: PLANNED },
        },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '7',
            '--repo',
            '*',
            '--remove-label',
            'agent:planned',
            '--add-label',
            'agent:replan',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/replan/7`, { method: 'POST' });
      expect(res.status).toBe(200);
      // The call after the planned-list must be the label swap, not a comment.
      // (The launched run may append calls later; only the handler's own
      // sequence is scripted, and a comment would have failed the replay.)
      expect(calls[1]).toEqual(expect.arrayContaining(['--add-label', 'agent:replan']));
    } finally {
      stop();
    }
  });

  test('POST /api/retry/:issue with a plan resets a fresh worktree and re-queues dev', async () => {
    const FAILED = JSON.stringify([
      { number: 12, title: 'CORS', body: 'b', labels: [{ name: 'agent:failed' }] },
    ]);
    const PLAN_VIEW = {
      stdout: JSON.stringify({ comments: [{ body: '<!-- cue:plan -->\nplan' }] }),
    };
    const { ctx, calls } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:failed'],
          result: { stdout: FAILED },
        },
        { match: ['gh', 'issue', 'view', '12'], result: PLAN_VIEW },
        { match: ['git', '-C', '/repos/widgets', 'worktree', 'remove'] },
        { match: ['git', '-C', '/repos/widgets', 'branch', '-D'] },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '12',
            '--repo',
            '*',
            '--remove-label',
            'agent:failed',
            '--add-label',
            'agent:approved',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/retry/12`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ retried: true, to: 'agent:approved', started: true });
      expect(calls[4]).toEqual(expect.arrayContaining(['--add-label', 'agent:approved']));
    } finally {
      stop();
    }
  });

  test('POST /api/retry/:issue without a plan re-queues triage from scratch', async () => {
    const FAILED = JSON.stringify([
      { number: 12, title: 'CORS', body: 'b', labels: [{ name: 'agent:failed' }] },
    ]);
    const { ctx, calls } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:failed'],
          result: { stdout: FAILED },
        },
        { match: ['gh', 'issue', 'view', '12'], result: { stdout: '{"comments":[]}' } },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '12',
            '--repo',
            '*',
            '--remove-label',
            'agent:failed',
            '--add-label',
            'agent:ready',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/retry/12`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ retried: true, to: 'agent:ready', started: true });
      // No worktree surgery for a triage retry.
      expect(calls.some((c) => c.includes('worktree'))).toBe(false);
    } finally {
      stop();
    }
  });

  test('POST /api/retry/:issue on a failed replan goes back to agent:replan', async () => {
    const FAILED = JSON.stringify([
      {
        number: 12,
        title: 'CORS',
        body: 'b',
        labels: [{ name: 'agent:planned' }, { name: 'agent:failed' }],
      },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:failed'],
          result: { stdout: FAILED },
        },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '12',
            '--repo',
            '*',
            '--remove-label',
            'agent:failed',
            '--add-label',
            'agent:replan',
          ],
        },
      ],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/retry/12`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ retried: true, to: 'agent:replan', started: true });
    } finally {
      stop();
    }
  });

  test('POST /api/retry/:issue 404s when the issue is not failed', async () => {
    const { ctx } = await makeCtx(
      [{ match: ['gh', 'issue', 'list'], result: { stdout: '[]' } }],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/retry/12`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  // The board used to re-sweep the runs directory once per issue for cost, and
  // never reported tokens at all — so a claude issue showed dollars only.
  test('buildState rolls cost AND tokens onto board issues from one index sweep', async () => {
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', 'acme/widgets', '--label', 'agent:ready'],
          result: {
            stdout: JSON.stringify([
              { number: 4, title: 'Contact Us page', body: '', labels: [{ name: 'agent:ready' }] },
              { number: 5, title: 'Never run here', body: '', labels: [{ name: 'agent:ready' }] },
            ]),
          },
        },
        // BOARD_LABELS drives one `gh issue list` per column; the rest are empty.
        ...Array.from({ length: BOARD_LABELS.length - 1 }, () => ({
          match: ['gh', 'issue', 'list'],
          result: { stdout: '[]' },
        })),
      ],
      [],
    );
    await ctx.logger.log(4, 'triage', {
      prompt: 'Issue #4: Contact Us page',
      result: [
        {
          type: 'result',
          usage: {
            input_tokens: 73,
            cache_read_input_tokens: 283110,
            cache_creation_input_tokens: 15283,
            output_tokens: 3074,
          },
        },
      ],
      costUsd: 0.074,
      durationMs: 90,
      outcome: 'ok',
    });

    const state = await buildState(ctx, null);
    const ready = state.columns.find((c) => c.label === 'agent:ready')!.issues;
    expect(ready.find((i) => i.number === 4)).toMatchObject({ cost: 0.074, tokens: 301540 });
    // An issue with nothing recorded on this machine reports zeros, not undefined.
    expect(ready.find((i) => i.number === 5)).toMatchObject({ cost: 0, tokens: 0 });
  });

  test('GET /api/runs indexes issues from disk, including ones off the board', async () => {
    const { ctx, url, stop } = await serve();
    try {
      await ctx.logger.log(4, 'triage', {
        prompt: 'Issue #4: Configure Bun and linter\n\nbody',
        result: null,
        costUsd: 0.25,
        durationMs: 90,
        outcome: 'ok',
      });

      const res = await fetch(`${url}/api/runs`);
      expect(res.status).toBe(200);
      const index = await res.json();
      expect(index).toHaveLength(1);
      expect(index[0].issue).toBe(4);
      expect(index[0].runs).toBe(1);
      expect(index[0].title).toBe('Configure Bun and linter');
      // The fake gh returns no issues at all, so this cannot have come from the board.
      expect(index[0].costUsd).toBeCloseTo(0.25);
    } finally {
      stop();
    }
  });

  test('GET /api/runs/:issue lists the recorded runs for that issue', async () => {
    const { ctx, url, stop } = await serve();
    try {
      await ctx.logger.log(4, 'triage', {
        prompt: 'p',
        result: null,
        costUsd: 0.01,
        durationMs: 10,
        outcome: 'ok',
      });
      const res = await fetch(`${url}/api/runs/4`);
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ stage: 'triage', outcome: 'ok' });
    } finally {
      stop();
    }
  });

  test('GET /api/state returns the board snapshot', async () => {
    const { ctx } = await makeCtx(
      Array.from({ length: BOARD_LABELS.length }, () => ({
        match: ['gh', 'issue', 'list'],
        result: { stdout: '[]' },
      })),
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/state`);
      expect(res.status).toBe(200);
      const state = await res.json();
      expect(state.repo).toBe('acme/widgets');
      expect(state.columns.map((c: { label: string }) => c.label)).toEqual(BOARD_LABELS);
    } finally {
      stop();
    }
  });

  test('POST /api/run/:issue starts an actionable issue', async () => {
    const READY = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:ready' }] },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: READY },
        },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:ready'] },
      ],
      [],
    );
    ctx.adapter = { run: () => new Promise(() => {}) };
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const started = await fetch(`${url}/api/run/7`, { method: 'POST' });
      expect(started.status).toBe(200);
      expect(await started.json()).toEqual({ started: 'run #7' });
    } finally {
      stop();
    }
  });

  test('POST /api/run/:issue finds an issue sitting on a later actionable label', async () => {
    const APPROVED = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:approved' }] },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: '[]' },
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:approved'],
          result: { stdout: APPROVED },
        },
      ],
      [],
    );
    ctx.adapter = { run: () => new Promise(() => {}) };
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/run/7`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ started: 'run #7' });
    } finally {
      stop();
    }
  });

  test('POST /api/run/:issue 404s when the issue is not actionable', async () => {
    const { ctx } = await makeCtx(
      Array.from({ length: 4 }, () => ({
        match: ['gh', 'issue', 'list'],
        result: { stdout: '[]' },
      })),
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const missing = await fetch(`${url}/api/run/99`, { method: 'POST' });
      expect(missing.status).toBe(404);
    } finally {
      stop();
    }
  });

  test('POST /api/replan/:issue 404s when the issue is not awaiting approval', async () => {
    const { ctx } = await makeCtx(
      [{ match: ['gh', 'issue', 'list'], result: { stdout: '[]' } }],
      [],
    );
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const res = await fetch(`${url}/api/replan/7`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      stop();
    }
  });

  test('a second launch is 409 while the first is still running', async () => {
    const READY = JSON.stringify([
      { number: 7, title: 'Fix login', body: 'b', labels: [{ name: 'agent:ready' }] },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: READY },
        },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:ready'] },
      ],
      [],
    );
    ctx.adapter = { run: () => new Promise(() => {}) };
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      const first = await fetch(`${url}/api/run/7`, { method: 'POST' });
      expect(first.status).toBe(200);
      await Bun.sleep(30);
      const conflict = await fetch(`${url}/api/poll`, { method: 'POST' });
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: 'busy: run #7' });
    } finally {
      stop();
    }
  });

  test('approve, retry, and replan record the label change but do not start while busy', async () => {
    const READY = JSON.stringify([
      { number: 7, title: 'Hang', body: 'b', labels: [{ name: 'agent:ready' }] },
    ]);
    const PLANNED = JSON.stringify([
      { number: 8, title: 'Plan', body: 'b', labels: [{ name: 'agent:planned' }] },
    ]);
    const FAILED = JSON.stringify([
      { number: 9, title: 'Fail', body: 'b', labels: [{ name: 'agent:failed' }] },
    ]);
    const { ctx } = await makeCtx(
      [
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
          result: { stdout: READY },
        },
        { match: ['gh', 'issue', 'edit', '7', '--repo', '*', '--remove-label', 'agent:ready'] },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:planned'],
          result: { stdout: PLANNED },
        },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '8',
            '--repo',
            '*',
            '--remove-label',
            'agent:planned',
            '--add-label',
            'agent:approved',
          ],
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:failed'],
          result: { stdout: FAILED },
        },
        { match: ['gh', 'issue', 'view', '9'], result: { stdout: '{"comments":[]}' } },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '9',
            '--repo',
            '*',
            '--remove-label',
            'agent:failed',
            '--add-label',
            'agent:ready',
          ],
        },
        {
          match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:planned'],
          result: { stdout: PLANNED },
        },
        {
          match: [
            'gh',
            'issue',
            'edit',
            '8',
            '--repo',
            '*',
            '--remove-label',
            'agent:planned',
            '--add-label',
            'agent:replan',
          ],
        },
      ],
      [],
    );
    ctx.adapter = { run: () => new Promise(() => {}) };
    const { url, stop } = startServer(ctx, 0, boundHost ?? '127.0.0.1');
    try {
      expect((await fetch(`${url}/api/run/7`, { method: 'POST' })).status).toBe(200);
      await Bun.sleep(30);
      const approved = await fetch(`${url}/api/approve/8`, { method: 'POST' });
      expect(await approved.json()).toEqual({ approved: true, started: false });
      const retried = await fetch(`${url}/api/retry/9`, { method: 'POST' });
      expect(await retried.json()).toEqual({ retried: true, to: 'agent:ready', started: false });
      const replan = await fetch(`${url}/api/replan/8`, { method: 'POST' });
      expect(await replan.json()).toEqual({ replanRequested: true, started: false });
    } finally {
      stop();
    }
  });

  test('GET /api/events streams a hello and then each CueEvent', async () => {
    const { ctx, url, stop } = await serve();
    try {
      const res = await fetch(`${url}/api/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const hello = await reader.read();
      expect(dec.decode(hello.value)).toContain('connected');
      ctx.onEvent({ ts: 1, issue: 0, stage: 'poll', kind: 'progress', message: 'hello-sse' });
      const next = await reader.read();
      expect(dec.decode(next.value)).toContain('hello-sse');
      await reader.cancel();
    } finally {
      stop();
    }
  });

  test('a dead SSE client is pruned without breaking delivery to live clients', async () => {
    let dead!: ReadableStreamDefaultController<Uint8Array>;
    let live!: ReadableStreamDefaultController<Uint8Array>;
    const deadStream = new ReadableStream<Uint8Array>({ start: (c) => void (dead = c) });
    const liveStream = new ReadableStream<Uint8Array>({ start: (c) => void (live = c) });
    dead.close(); // enqueue on a closed controller throws
    const clients = new Set([dead, live]);
    fanOut(clients, new TextEncoder().encode('data: x\n\n'));
    expect(clients.has(dead)).toBe(false);
    expect(clients.has(live)).toBe(true);
    expect((await deadStream.getReader().read()).done).toBe(true);
    const { value } = await liveStream.getReader().read();
    expect(new TextDecoder().decode(value)).toBe('data: x\n\n');
  });

  test('a failing launched task emits an error event then done', async () => {
    const { ctx, url, stop } = await serve();
    const events: Array<{ kind: string; message: string }> = [];
    const prev = ctx.onEvent;
    ctx.onEvent = (e) => {
      events.push(e);
      prev(e);
    };
    try {
      const res = await fetch(`${url}/api/poll`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ started: 'poll' });
      await Bun.sleep(50);
      expect(events.some((e) => e.kind === 'error')).toBe(true);
      expect(events.some((e) => e.kind === 'done' && e.message.includes('poll finished'))).toBe(
        true,
      );
    } finally {
      stop();
    }
  });

  test('returns 503 when the dashboard client is missing', async () => {
    const prev = process.env.CUE_CLIENT_DIR;
    process.env.CUE_CLIENT_DIR = await mkdtemp(join(tmpdir(), 'cue-empty-client-'));
    try {
      const { url, stop } = await serve();
      try {
        const res = await fetch(`${url}/`);
        expect(res.status).toBe(503);
        expect(await res.text()).toContain('not built');
      } finally {
        stop();
      }
    } finally {
      process.env.CUE_CLIENT_DIR = prev;
    }
  });

  test('serves from the embedded UI_FILES manifest when it is populated', async () => {
    const dir = process.env.CUE_CLIENT_DIR!;
    await Bun.write(join(dir, 'assets', 'app.js'), 'console.log(1);');
    UI_FILES['/index.html'] = join(dir, 'index.html');
    UI_FILES['/assets/app.js'] = join(dir, 'assets', 'app.js');
    try {
      const { url, stop } = await serve();
      try {
        const index = await fetch(`${url}/`);
        expect(index.status).toBe(200);
        expect(await index.text()).toContain('cue fixture');
        const asset = await fetch(`${url}/assets/app.js`);
        expect(asset.status).toBe(200);
        expect(await asset.text()).toBe('console.log(1);');
        const fallback = await fetch(`${url}/runs/3`);
        expect(fallback.status).toBe(200);
        expect(fallback.headers.get('content-type')).toContain('text/html');
      } finally {
        stop();
      }
    } finally {
      delete UI_FILES['/index.html'];
      delete UI_FILES['/assets/app.js'];
    }
  });

  test('falls through to disk when the embedded manifest has no index.html', async () => {
    const dir = process.env.CUE_CLIENT_DIR!;
    await Bun.write(join(dir, 'assets', 'app.js'), 'console.log(1);');
    UI_FILES['/assets/app.js'] = join(dir, 'assets', 'app.js');
    try {
      const { url, stop } = await serve();
      try {
        const res = await fetch(`${url}/runs/3`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
      } finally {
        stop();
      }
    } finally {
      delete UI_FILES['/assets/app.js'];
    }
  });
});
