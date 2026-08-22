import { describe, expect, test } from 'bun:test';

import { makeWebhookNotifier, noNotify, type Notification } from '@/notify';

const NOTE: Notification = {
  event: 'planned',
  issue: 7,
  title: 'Fix login',
  repo: 'acme/widgets',
  url: 'https://github.com/acme/widgets/issues/7',
  text: 'plan ready for #7',
};

describe('makeWebhookNotifier', () => {
  test('POSTs the notification as JSON, with text duplicated as content', async () => {
    const posts: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      posts.push({ url: String(url), init: init! });
      return new Response('ok');
    }) as typeof fetch;

    const notify = makeWebhookNotifier('https://hooks.example/abc', fetchImpl);
    await notify(NOTE);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://hooks.example/abc');
    expect(posts[0]!.init.method).toBe('POST');
    const body = JSON.parse(posts[0]!.init.body as string);
    // `text` feeds Slack-compatible receivers, `content` Discord-compatible
    // ones; the structured fields serve everything else.
    expect(body).toMatchObject({ ...NOTE, content: NOTE.text });
  });

  test('never throws: a down webhook must not fail the stage', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const notify = makeWebhookNotifier('https://hooks.example/abc', failing);
    await notify(NOTE); // must not throw
  });

  test('an unset url resolves to the silent notifier', () => {
    expect(makeWebhookNotifier(undefined)).toBe(noNotify);
  });
});
