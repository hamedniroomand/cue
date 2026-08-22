import { useState } from "react";

import { Button } from "~/components/ui/button";
import { retryIssue } from "~/lib/cue";

/**
 * One-click retry for agent:failed issues. The server routes deterministically:
 * back to replan when a revision was pending, to dev with a fresh worktree when
 * a plan exists, to triage from scratch otherwise.
 */
export function RetryAction({
  issue,
  onDone,
}: {
  issue: number;
  onDone: () => void | Promise<void>;
}) {
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await retryIssue(issue);
    } finally {
      setSending(false);
      void onDone();
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-6 w-full text-[10px]"
      disabled={sending}
      onClick={() => void send()}
    >
      Retry
    </Button>
  );
}
