import { ArrowUpRightIcon, CircleSlashIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
} from "recharts";

import { PlannedActions } from "~/components/planned-actions";
import { SectionHeading, Shell } from "~/components/shell";
import { BoardSkeleton, ChartSkeleton, StatSkeleton } from "~/components/skeletons";
import { Stat } from "~/components/stat";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { ScrollArea } from "~/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Skeleton } from "~/components/ui/skeleton";
import {
  formatDuration,
  formatTokens,
  formatUsage,
  formatUsd,
  poll,
  shortLabel,
  STAGES,
} from "~/lib/cue";
import { useAllRuns, useCue, useRunIndex } from "~/lib/use-cue";
import { cn } from "~/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  triage: "var(--chart-1)",
  replan: "var(--chart-4)",
  dev: "var(--chart-2)",
  fix: "var(--chart-5)",
  review: "var(--chart-3)",
  "review-fix": "var(--chart-5)",
};

/**
 * Charts plot one metric at a time. Cost is meaningless for codex and
 * antigravity (neither reports dollars), so the axis is switchable and defaults
 * to whichever the recorded runs actually carry.
 */
type Metric = "cost" | "tokens";

const CHART_CONFIG: Record<Metric, ChartConfig> = {
  cost: {
    value: { label: "Cost (USD)", color: "var(--chart-1)" },
    cumulative: { label: "Cumulative (USD)", color: "var(--chart-2)" },
  },
  tokens: {
    value: { label: "Tokens", color: "var(--chart-1)" },
    cumulative: { label: "Cumulative tokens", color: "var(--chart-2)" },
  },
};

export default function Home() {
  const { state, events, live, refresh } = useCue();
  const index = useRunIndex();
  const runs = useAllRuns(state, index);

  // null = the run fetches have not landed. Everything derived from runs renders
  // a skeleton until then; rendering the zeros would be a truthful-looking lie.
  const loadingRuns = runs === null;
  const loadingBoard = state === null;

  const totals = useMemo(() => {
    const rows = runs ?? [];
    const spend = rows.reduce((t, r) => t + (r.costUsd ?? 0), 0);
    const tokens = rows.reduce((t, r) => t + (r.usage?.total ?? 0), 0);
    const failed = rows.filter((r) => r.outcome === "failed").length;
    const duration = rows.reduce((t, r) => t + r.durationMs, 0);
    const inFlight =
      state?.columns
        .filter((c) => c.label !== "agent:failed")
        .reduce((t, c) => t + c.issues.length, 0) ?? 0;
    return { spend, tokens, failed, duration, inFlight };
  }, [runs, state]);

  // null = the user has not picked, so follow the data: a codex/antigravity
  // pipeline reports no dollars and would otherwise render three empty charts.
  const [picked, setPicked] = useState<Metric | null>(null);
  const metric: Metric = picked ?? (totals.spend > 0 ? "cost" : "tokens");
  const valueOf = useCallback(
    (r: { costUsd?: number; usage?: { total: number } }) =>
      metric === "cost" ? (r.costUsd ?? 0) : (r.usage?.total ?? 0),
    [metric],
  );
  const byStage = useMemo(
    () =>
      STAGES.map((stage) => ({
        stage,
        value: (runs ?? []).filter((r) => r.stage === stage).reduce((t, r) => t + valueOf(r), 0),
      })).filter((d) => d.value > 0),
    [runs, valueOf],
  );

  const byIssue = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of runs ?? []) map.set(r.issue, (map.get(r.issue) ?? 0) + valueOf(r));
    return [...map.entries()]
      .map(([issue, value]) => ({ issue: `#${issue}`, value }))
      .filter((d) => d.value > 0)
      .toSorted((a, b) => b.value - a.value);
  }, [runs, valueOf]);

  const trajectory = useMemo(() => {
    const sorted = (runs ?? []).toSorted((a, b) => a.ts - b.ts);
    const rows: Array<{ at: string; cumulative: number }> = [];
    for (let i = 0, acc = 0; i < sorted.length; i++) {
      const r = sorted[i]!;
      acc += valueOf(r);
      rows.push({ at: `${r.stage} #${r.issue}`, cumulative: Number(acc.toFixed(4)) });
    }
    return rows;
  }, [runs, valueOf]);

  function exportReport() {
    const blob = new Blob([JSON.stringify({ state, runs: runs ?? [] }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cue-report.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell state={state} onPoll={() => void poll()} onExport={exportReport}>
      <div className="flex flex-col gap-12">
        {/* ------------------------------------------------ executive summary */}
        <section className="reveal overflow-hidden rounded-xl bg-surface text-surface-foreground ring-1 ring-foreground/10">
          <div className="grid gap-8 p-6 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center">
            <div className="flex flex-col gap-4">
              <span className="font-mono text-label-md text-surface-muted uppercase">
                Executive Summary
              </span>
              {loadingRuns ? (
                <Skeleton className="h-[43px] w-56 bg-white/15 lg:h-[67px] lg:w-72" />
              ) : (
                <h1 className="text-display-md text-balance lg:text-display-lg">
                  {metric === "cost" ? formatUsd(totals.spend) : formatTokens(totals.tokens)}
                </h1>
              )}
              <p className="max-w-xl text-body-md text-surface-muted">
                {metric === "cost"
                  ? "Total agent spend across every recorded run."
                  : "Total tokens processed across every recorded run — the comparable figure when an adapter reports no dollar cost."}{" "}
                Monitor stage throughput, usage distribution, and per-run transcripts for the issue
                pipeline.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="font-mono">{live ? "live" : "snapshot"}</Badge>
                {loadingRuns ? (
                  <>
                    <Skeleton className="h-5 w-20 rounded-4xl bg-white/15" />
                    <Skeleton className="h-5 w-24 rounded-4xl bg-white/15" />
                  </>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className="border-white/25 font-mono text-surface-foreground"
                    >
                      {runs.length} runs
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-white/25 font-mono text-surface-foreground"
                    >
                      {metric === "cost"
                        ? `${formatTokens(totals.tokens)} tokens`
                        : formatUsd(totals.spend)}
                    </Badge>
                  </>
                )}
                <Button size="sm" nativeButton={false} render={<Link to="/runs" />}>
                  Explore transcripts
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </div>

            {/* Trajectory lives inside the focal panel: orange on slate is the
                highest-contrast pairing the spec's palette offers. */}
            <div className="flex min-w-0 flex-col gap-2">
              <span className="font-mono text-label-md text-surface-muted uppercase">
                Trajectory · cumulative {metric === "cost" ? "spend" : "tokens"}
              </span>
              {loadingRuns ? (
                <ChartSkeleton className="h-52" surface />
              ) : trajectory.length === 0 ? (
                <p className="py-12 text-center text-xs text-surface-muted">
                  No runs recorded yet.
                </p>
              ) : (
                <ChartContainer config={CHART_CONFIG[metric]} className="h-52 w-full">
                  <AreaChart data={trajectory} margin={{ left: -20, top: 8 }}>
                    <defs>
                      <linearGradient id="traj" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f0a077" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#f0a077" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="rgb(255 255 255 / 0.15)" />
                    <XAxis dataKey="at" hide />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      dataKey="cumulative"
                      type="monotone"
                      stroke="#f0a077"
                      strokeWidth={2}
                      fill="url(#traj)"
                    />
                  </AreaChart>
                </ChartContainer>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {loadingRuns ? (
            <StatSkeleton style={{ animationDelay: "60ms" }} />
          ) : (
            <Stat
              label="Total tokens"
              value={formatTokens(totals.tokens)}
              hint="input + cache + output, all runs"
              style={{ animationDelay: "60ms" }}
            />
          )}
          {/* The only board-derived tile: it lands with /api/state, not the runs. */}
          {loadingBoard ? (
            <StatSkeleton style={{ animationDelay: "120ms" }} />
          ) : (
            <Stat
              label="Issues in flight"
              value={String(totals.inFlight)}
              hint="on the board, excluding failed"
              style={{ animationDelay: "120ms" }}
            />
          )}
          {loadingRuns ? (
            <>
              <StatSkeleton style={{ animationDelay: "180ms" }} />
              <StatSkeleton style={{ animationDelay: "240ms" }} />
              <StatSkeleton style={{ animationDelay: "300ms" }} />
            </>
          ) : (
            <>
              <Stat
                label="Agent time"
                value={formatDuration(totals.duration)}
                hint="summed wall-clock across runs"
                style={{ animationDelay: "180ms" }}
              />
              <Stat
                label="Runs recorded"
                value={String(runs.length)}
                hint="stage invocations logged"
                style={{ animationDelay: "240ms" }}
              />
              <Stat
                label="Failed"
                value={String(totals.failed)}
                hint="stages that hit agent:failed"
                accent={totals.failed > 0}
                style={{ animationDelay: "300ms" }}
              />
            </>
          )}
        </section>

        {/* ---------------------------------------------------- capital charts */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            action={
              <ToggleGroup
                value={[metric]}
                onValueChange={(v) => setPicked((v[0] as Metric | undefined) ?? metric)}
                size="sm"
                variant="outline"
              >
                <ToggleGroupItem value="cost" className="font-mono text-[10px] uppercase">
                  cost
                </ToggleGroupItem>
                <ToggleGroupItem value="tokens" className="font-mono text-[10px] uppercase">
                  tokens
                </ToggleGroupItem>
              </ToggleGroup>
            }
          >
            Usage Overview
          </SectionHeading>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="lift reveal">
              <CardHeader>
                <CardTitle className="text-sm">Stage Breakdown</CardTitle>
                <CardDescription>
                  {metric === "cost" ? "Spend" : "Tokens"} per pipeline stage
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingRuns ? (
                  <ChartSkeleton className="h-56" />
                ) : byStage.length === 0 ? (
                  <NoData />
                ) : (
                  <ChartContainer config={CHART_CONFIG[metric]} className="h-56 w-full">
                    <BarChart data={byStage} margin={{ left: -20, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis
                        dataKey="stage"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={10}
                        className="font-mono text-[10px]"
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {byStage.map((d) => (
                          <Cell key={d.stage} fill={STAGE_COLORS[d.stage] ?? "var(--chart-1)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lift reveal" style={{ animationDelay: "80ms" }}>
              <CardHeader>
                <CardTitle className="text-sm">Issue Distribution</CardTitle>
                <CardDescription>
                  {metric === "cost" ? "Spend" : "Tokens"} attributed per issue
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingRuns ? (
                  <div className="grid h-56 place-items-center">
                    <Skeleton className="size-40 rounded-full" />
                  </div>
                ) : byIssue.length === 0 ? (
                  <NoData />
                ) : (
                  <ChartContainer config={CHART_CONFIG[metric]} className="h-56 w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent nameKey="issue" />} />
                      <Pie
                        data={byIssue}
                        dataKey="value"
                        nameKey="issue"
                        innerRadius={48}
                        strokeWidth={2}
                      >
                        {byIssue.map((d, i) => (
                          <Cell key={d.issue} fill={`var(--chart-${(i % 5) + 1})`} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ------------------------------------------------------- board + log */}
        <section className="flex flex-col gap-4">
          <SectionHeading>Pipeline</SectionHeading>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="reveal min-w-0">
              <CardHeader>
                <CardTitle className="text-sm">Label state machine</CardTitle>
                <CardDescription>
                  GitHub labels are the state store — humans gate plan approval and merge.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingBoard ? (
                  <BoardSkeleton />
                ) : (
                  <div className="grid auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
                    {state.columns.map((column) => (
                      <div key={column.label} className="flex min-w-0 flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-mono text-label-md text-muted-foreground uppercase">
                            {shortLabel(column.label)}
                          </span>
                          <Badge variant="secondary" className="tabular-nums">
                            {column.issues.length}
                          </Badge>
                        </div>
                        <div className="flex flex-col gap-2">
                          {column.issues.map((issue) => (
                            <div key={issue.number} className="flex flex-col gap-1.5">
                              <Link
                                to={`/runs/${issue.number}`}
                                className="lift flex flex-col gap-1.5 rounded-lg bg-secondary p-2.5 ring-1 ring-border transition-colors hover:bg-accent"
                              >
                                <span className="font-mono text-label-md text-primary">
                                  #{issue.number}
                                </span>
                                <span className="line-clamp-2 text-xs leading-snug">
                                  {issue.title}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                                  {formatUsage(issue.cost, issue.tokens)}
                                </span>
                              </Link>
                              {column.label === "agent:planned" && (
                                <PlannedActions issue={issue.number} onDone={refresh} />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="reveal min-w-0" style={{ animationDelay: "80ms" }}>
              <CardHeader>
                <CardTitle className="text-sm">Live log</CardTitle>
                <CardDescription>Streamed from /api/events</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  {events.length === 0 ? (
                    <p className="font-mono text-xs text-muted-foreground">waiting for a run…</p>
                  ) : (
                    <div className="flex flex-col gap-0.5 font-mono text-xs">
                      {events.map((event, i) => (
                        <p
                          key={i}
                          className={cn(
                            "leading-5",
                            event.kind === "error" && "text-destructive",
                            (event.kind === "start" || event.kind === "done") &&
                              "font-semibold text-foreground",
                            event.kind === "progress" && "text-muted-foreground",
                          )}
                        >
                          <span className="text-primary">
                            [{event.stage}
                            {event.issue ? ` #${event.issue}` : ""}]
                          </span>{" "}
                          {event.message}
                        </p>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function NoData() {
  return (
    <Empty className="h-56">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleSlashIcon />
        </EmptyMedia>
        <EmptyTitle>No runs yet</EmptyTitle>
        <EmptyDescription>Run a stage to record cost data.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
