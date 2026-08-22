import { ActivityIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { NavLink } from "react-router";

import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import type { DashboardState } from "~/lib/cue";
import { cn } from "~/lib/utils";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/runs", label: "Runs" },
];

/** Ambient depth layer: two soft radial washes plus a hairline grid.
 *  Pure CSS — deliberately no canvas/WebGL, so the CLI ships no 3D deps. */
function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[36rem] rounded-full bg-primary/20 blur-[120px]" />
      <div className="absolute -right-32 -bottom-48 size-[32rem] rounded-full bg-brand-accent/15 blur-[120px]" />
      <div
        className="absolute inset-0"
        style={{
          opacity: "var(--grid-opacity)",
          backgroundImage:
            "linear-gradient(to right, var(--grid-line) 1px, transparent 1px), linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent)",
        }}
      />
    </div>
  );
}

export function Shell({
  state,
  onPoll,
  onExport,
  children,
}: {
  state: DashboardState | null;
  onPoll?: () => void;
  onExport?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh">
      <Ambient />
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[92rem] items-center gap-3 px-4 md:gap-6 md:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-primary-foreground">
              <ActivityIcon className="size-3.5" />
            </span>
            {/* Wordmark text is the first thing to go; the icon still identifies the app. */}
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">Cue</span>
          </div>

          <nav className="flex shrink-0 items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-lg px-2.5 py-1.5 font-mono text-label-md uppercase transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="grow" />

          {state && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="hidden font-mono text-label-md text-muted-foreground xl:inline">
                      {state.models.triage}/{state.models.dev}/{state.models.review}
                    </span>
                  }
                />
                <TooltipContent>triage / dev / review models</TooltipContent>
              </Tooltip>
              <Badge
                variant="outline"
                className="hidden max-w-56 truncate font-mono lg:inline-flex"
              >
                {state.repo}
              </Badge>
              {state.busy ? (
                <Badge className="animate-pulse">{state.busy}</Badge>
              ) : (
                <Badge variant="secondary" className="hidden font-mono sm:inline-flex">
                  idle
                </Badge>
              )}
            </>
          )}

          <ThemeToggle />

          {onExport && (
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={onExport}>
              <DownloadIcon data-icon="inline-start" />
              Export
            </Button>
          )}
          {onPoll && (
            <Button size="sm" className="shrink-0" disabled={state?.busy != null} onClick={onPoll}>
              <RefreshCwIcon data-icon="inline-start" className="hidden sm:block" />
              Poll now
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[92rem] px-4 py-10 md:px-6">{children}</main>
    </div>
  );
}

/** Section label followed by a rule that fills the rest of the row.
 *  Separator carries `data-horizontal:w-full`, so it must sit in its own flex
 *  child — as a direct `grow` sibling it resolves to 100% of the whole row and
 *  pushes the line past the viewport. */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <SectionLabel>{children}</SectionLabel>
      <div className="min-w-0 flex-1">
        <Separator />
      </div>
    </div>
  );
}

/** Small mono section label, per the spec's label-md role. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 font-mono text-label-md whitespace-nowrap text-muted-foreground uppercase">
      {children}
    </span>
  );
}
