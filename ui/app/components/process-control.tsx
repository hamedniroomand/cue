import { ChevronDownIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { ButtonGroup } from "~/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  actionableIssues,
  processButtonLabel,
  resolveProcessTarget,
  type DashboardState,
} from "~/lib/cue";

/**
 * Header stand-in for `cue process` / `cue run [n]`. Nothing selected polls
 * every actionable issue; picking one from the dropdown changes the button
 * to Run #n. Clear returns to Process now. The list is the same set the CLI
 * picker shows (ready / approved / replan).
 */
export function ProcessControl({
  state,
  onPoll,
  onRun,
}: {
  state: DashboardState | null;
  onPoll: () => void;
  onRun: (issue: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const issues = useMemo(() => actionableIssues(state), [state]);
  const target = resolveProcessTarget(selected, issues);
  const busy = state?.busy != null;

  if (selected != null && target.kind === "poll") setSelected(null);

  function go() {
    if (target.kind === "run") onRun(target.issue);
    else onPoll();
  }

  return (
    <ButtonGroup className="shrink-0" aria-label="Process pipeline">
      <Button size="sm" disabled={busy} onClick={go}>
        <RefreshCwIcon data-icon="inline-start" className="hidden sm:block" />
        {processButtonLabel(target)}
      </Button>
      {target.kind === "run" && (
        <Button
          size="icon-sm"
          disabled={busy}
          aria-label="Clear issue selection"
          onClick={() => setSelected(null)}
        >
          <XIcon />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button size="icon-sm" disabled={busy} />}
          aria-label="Select an issue to run"
        >
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          {issues.length === 0 ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>No actionable issues</DropdownMenuLabel>
              <DropdownMenuItem disabled>Needs ready, approved, or replan</DropdownMenuItem>
            </DropdownMenuGroup>
          ) : (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Run a single issue</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={selected != null ? String(selected) : ""}
                onValueChange={(value) => setSelected(Number(value))}
              >
                {issues.map((issue) => (
                  <DropdownMenuRadioItem key={issue.number} value={String(issue.number)}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">
                        #{issue.number} {issue.title}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {issue.label} → {issue.action}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
