import { ArrowUpRightIcon, CircleSlashIcon } from "lucide-react"
import { useMemo } from "react"
import { Link } from "react-router"
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
} from "recharts"

import { SectionHeading, SectionLabel, Shell } from "~/components/shell"
import { Stat } from "~/components/stat"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty"
import { ScrollArea } from "~/components/ui/scroll-area"
import {
  formatDuration,
  formatUsd,
  poll,
  shortLabel,
  STAGES,
} from "~/lib/conductor"
import { useAllRuns, useConductor, useRunIndex } from "~/lib/use-conductor"
import { cn } from "~/lib/utils"

const STAGE_COLORS: Record<string, string> = {
  triage: "var(--chart-1)",
  replan: "var(--chart-4)",
  dev: "var(--chart-2)",
  fix: "var(--chart-5)",
  review: "var(--chart-3)",
  "review-fix": "var(--chart-5)",
}

const chartConfig = {
  cost: { label: "Cost (USD)", color: "var(--chart-1)" },
  cumulative: { label: "Cumulative (USD)", color: "var(--chart-2)" },
} satisfies ChartConfig

export default function Home() {
  const { state, events, live } = useConductor()
  const index = useRunIndex()
  const runs = useAllRuns(state, index)

  const totals = useMemo(() => {
    const spend = runs.reduce((t, r) => t + (r.costUsd ?? 0), 0)
    const failed = runs.filter((r) => r.outcome === "failed").length
    const duration = runs.reduce((t, r) => t + r.durationMs, 0)
    const inFlight =
      state?.columns
        .filter((c) => c.label !== "agent:failed")
        .reduce((t, c) => t + c.issues.length, 0) ?? 0
    return { spend, failed, duration, inFlight }
  }, [runs, state])

  const byStage = useMemo(
    () =>
      STAGES.map((stage) => ({
        stage,
        cost: runs
          .filter((r) => r.stage === stage)
          .reduce((t, r) => t + (r.costUsd ?? 0), 0),
      })).filter((d) => d.cost > 0),
    [runs]
  )

  const byIssue = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of runs)
      map.set(r.issue, (map.get(r.issue) ?? 0) + (r.costUsd ?? 0))
    return [...map.entries()]
      .map(([issue, cost]) => ({ issue: `#${issue}`, cost }))
      .toSorted((a, b) => b.cost - a.cost)
  }, [runs])

  const trajectory = useMemo(() => {
    let acc = 0
    return runs
      .toSorted((a, b) => a.ts - b.ts)
      .map((r) => {
        acc += r.costUsd ?? 0
        return {
          at: `${r.stage} #${r.issue}`,
          cumulative: Number(acc.toFixed(4)),
        }
      })
  }, [runs])

  function exportReport() {
    const blob = new Blob([JSON.stringify({ state, runs }, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "conductor-report.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Shell state={state} onPoll={() => void poll()} onExport={exportReport}>
      <div className="flex flex-col gap-12">
        {/* ------------------------------------------------ executive summary */}
        <section className="reveal grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
          <div className="flex flex-col gap-4">
            <SectionLabel>Executive Summary</SectionLabel>
            <h1 className="text-display-md text-balance lg:text-display-lg">
              {formatUsd(totals.spend)}
            </h1>
            <p className="max-w-xl text-body-md text-muted-foreground">
              Total agent spend across every recorded run. Monitor stage
              throughput, structural cost distribution, and per-run transcripts
              for the issue pipeline.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={live ? "default" : "outline"}
                className="font-mono"
              >
                {live ? "live" : "snapshot"}
              </Badge>
              <Badge variant="secondary" className="font-mono">
                {runs.length} runs
              </Badge>
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link to="/runs" />}
              >
                Explore transcripts
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Stat
              label="Issues in flight"
              value={String(totals.inFlight)}
              hint="on the board, excluding failed"
              style={{ animationDelay: "60ms" }}
            />
            <Stat
              label="Agent time"
              value={formatDuration(totals.duration)}
              hint="summed wall-clock across runs"
              style={{ animationDelay: "120ms" }}
            />
            <Stat
              label="Runs recorded"
              value={String(runs.length)}
              hint="stage invocations logged"
              style={{ animationDelay: "180ms" }}
            />
            <Stat
              label="Failed"
              value={String(totals.failed)}
              hint="stages that hit agent:failed"
              accent={totals.failed > 0}
              style={{ animationDelay: "240ms" }}
            />
          </div>
        </section>

        {/* ---------------------------------------------------- capital charts */}
        <section className="flex flex-col gap-4">
          <SectionHeading>Capital Overview</SectionHeading>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card className="lift reveal">
              <CardHeader>
                <CardTitle className="text-sm">Cost Breakdown</CardTitle>
                <CardDescription>Spend per pipeline stage</CardDescription>
              </CardHeader>
              <CardContent>
                {byStage.length === 0 ? (
                  <NoData />
                ) : (
                  <ChartContainer config={chartConfig} className="h-56 w-full">
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
                      <Bar dataKey="cost" radius={[6, 6, 0, 0]}>
                        {byStage.map((d) => (
                          <Cell
                            key={d.stage}
                            fill={STAGE_COLORS[d.stage] ?? "var(--chart-1)"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lift reveal" style={{ animationDelay: "80ms" }}>
              <CardHeader>
                <CardTitle className="text-sm">Revenue Sources</CardTitle>
                <CardDescription>Spend attributed per issue</CardDescription>
              </CardHeader>
              <CardContent>
                {byIssue.length === 0 ? (
                  <NoData />
                ) : (
                  <ChartContainer config={chartConfig} className="h-56 w-full">
                    <PieChart>
                      <ChartTooltip
                        content={<ChartTooltipContent nameKey="issue" />}
                      />
                      <Pie
                        data={byIssue}
                        dataKey="cost"
                        nameKey="issue"
                        innerRadius={48}
                        strokeWidth={2}
                      >
                        {byIssue.map((d, i) => (
                          <Cell
                            key={d.issue}
                            fill={`var(--chart-${(i % 5) + 1})`}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lift reveal" style={{ animationDelay: "160ms" }}>
              <CardHeader>
                <CardTitle className="text-sm">Trajectory</CardTitle>
                <CardDescription>Cumulative spend by run order</CardDescription>
              </CardHeader>
              <CardContent>
                {trajectory.length === 0 ? (
                  <NoData />
                ) : (
                  <ChartContainer config={chartConfig} className="h-56 w-full">
                    <AreaChart data={trajectory} margin={{ left: -20, top: 8 }}>
                      <defs>
                        <linearGradient id="traj" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="var(--chart-2)"
                            stopOpacity={0.5}
                          />
                          <stop
                            offset="100%"
                            stopColor="var(--chart-2)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="at" hide />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        dataKey="cumulative"
                        type="monotone"
                        stroke="var(--chart-2)"
                        strokeWidth={2}
                        fill="url(#traj)"
                      />
                    </AreaChart>
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
                  GitHub labels are the state store — humans gate plan approval
                  and merge.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
                  {state?.columns.map((column) => (
                    <div
                      key={column.label}
                      className="flex min-w-0 flex-col gap-2"
                    >
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
                          <Link
                            key={issue.number}
                            to={`/runs/${issue.number}`}
                            className="lift flex flex-col gap-1.5 rounded-lg bg-secondary/50 p-2.5 ring-1 ring-border transition-colors hover:bg-secondary"
                          >
                            <span className="font-mono text-label-md text-primary">
                              #{issue.number}
                            </span>
                            <span className="line-clamp-2 text-xs leading-snug">
                              {issue.title}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                              {formatUsd(issue.cost)}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
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
                    <p className="font-mono text-xs text-muted-foreground">
                      waiting for a run…
                    </p>
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
                            event.kind === "progress" && "text-muted-foreground"
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
  )
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
  )
}
