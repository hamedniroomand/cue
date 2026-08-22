import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BOARD_LABELS, buildState, startServer } from '@/server';

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
});
