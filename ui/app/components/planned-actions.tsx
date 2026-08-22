import { useState } from "react";

import { Button } from "~/components/ui/button";
import { approveIssue, replanIssue } from "~/lib/cue";

/**
 * One-click gate for agent:planned issues — the human still approves, without
 * leaving the dashboard. Replan expands an inline feedback box; the comment
 * lands on the issue before the replan stage reads it. Rendered on the board
 * (home) and on the run explorer, where the plan itself is read.
 */
export function PlannedActions({
  issue,
  onDone,
}: {
  issue: number;
  onDone: () => void | Promise<void>;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);

  async function send(action: () => Promise<void>) {
    setSending(true);
    try {
      await action();
    } finally {
      setSending(false);
      setFeedbackOpen(false);
      setFeedback("");
      void onDone();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-6 flex-1 text-[10px]"
          disabled={sending}
          onClick={() => void send(() => approveIssue(issue))}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 flex-1 text-[10px]"
          disabled={sending}
          onClick={() => setFeedbackOpen((open) => !open)}
        >
          Replan
        </Button>
      </div>
      {feedbackOpen && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should the revised plan do differently?"
            rows={3}
            className="w-full resize-none rounded-md bg-secondary p-2 text-xs ring-1 ring-border focus:ring-ring focus:outline-none"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-6 text-[10px]"
            disabled={sending}
            onClick={() => void send(() => replanIssue(issue, feedback))}
          >
            Request revision
          </Button>
        </div>
      )}
    </div>
  );
}
