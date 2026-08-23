/**
 * Outbound webhook for the moments a human is waited on: a plan is ready for
 * approval, and a draft PR is ready (or freshly revised) for merge. One plain
 * JSON POST — `text` makes it Slack-compatible, `content` Discord-compatible,
 * and the structured fields serve everything else.
 *
 * Notifications are best-effort by contract: a down webhook must never fail a
 * stage, so every error is swallowed and the request is bounded by a timeout.
 */

export interface Notification {
  event: 'planned' | 'pr-opened' | 'revised';
  issue: number;
  title: string;
  repo: string;
  url?: string;
  text: string;
}

export type Notify = (n: Notification) => Promise<void>;

export const noNotify: Notify = async () => {};

const WEBHOOK_TIMEOUT_MS = 10_000;

export function makeWebhookNotifier(
  webhookUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Notify {
  if (!webhookUrl) return noNotify;
  return async (n) => {
    try {
      await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...n, content: n.text }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
    } catch {
      // Best-effort: the pipeline result is on GitHub either way.
    }
  };
}
