import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '@/server';

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
async function serve() {
  const { ctx } = await makeCtx([], []);
  // Bun.serve({ port: 0 }) fails to bind on Windows, so an ephemeral port
  // request cannot be used here: pick random high ports and retry collisions.
  for (let attempt = 0; ; attempt++) {
    const port = 20_000 + Math.floor(Math.random() * 40_000);
    try {
      const { url, stop } = startServer(ctx, port);
      return { ctx, url, stop };
    } catch (err) {
      if (attempt >= 9) throw err;
    }
  }
}

describe('dashboard server', () => {
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
