import {
  AlertTriangleIcon,
  BrainIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  FileTextIcon,
  GaugeIcon,
  ShieldOffIcon,
  TerminalIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router"

import { SectionLabel, Shell } from "~/components/shell"
import { Badge } from "~/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty"
import { ScrollArea } from "~/components/ui/scroll-area"
import { Separator } from "~/components/ui/separator"
import { Skeleton } from "~/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import type { RunDetail, RunSummary, TranscriptRow } from "~/lib/conductor"
import {
  fetchRun,
  fetchRuns,
  formatDuration,
  formatUsd,
  normalizeEvents,
  poll,
  shortLabel,
  statsFor,
  toRows,
} from "~/lib/conductor"
import { useConductor, useRunIndex } from "~/lib/use-conductor"
import { cn } from "~/lib/utils"

const runId = (r: RunSummary) => `${r.stage}-${r.ts}`

export default function Runs() {
  const params = useParams()
  const { state } = useConductor()
  const index = useRunIndex()
  const issue = params.issue ? Number(params.issue) : null

  /**
   * Active = still on the label board. Done = has runs recorded on disk but has
   * left the board (agent:done, or closed). The board alone hides completed work.
   */
  const { active, done } = useMemo(() => {
    const board = (state?.columns ?? []).flatMap((c) =>
      c.issues.map((i) => ({
        number: i.number,
        title: i.title,
        cost: i.cost,
        label: shortLabel(c.label),
      }))
    )
    const onBoard = new Set(board.map((i) => i.number))
    const archived = (index ?? [])
      .filter((e) => !onBoard.has(e.issue))
      .map((e) => ({
        number: e.issue,
        title: e.title ?? `Issue #${e.issue}`,
        cost: e.costUsd,
        label: "done",
      }))
    return {
      active: board.toSorted((a, b) => a.number - b.number),
      done: archived.toSorted((a, b) => b.number - a.number),
    }
  }, [state, index])

  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (issue == null) return
    setRuns(null)
    setSelected(null)
    setDetail(null)
    void fetchRuns(issue).then((list) => {
      const sorted = list.toSorted((a, b) => b.ts - a.ts)
      setRuns(sorted)
      if (sorted[0]) setSelected(runId(sorted[0]))
    })
  }, [issue])

  useEffect(() => {
    if (issue == null || !selected) return
    setLoading(true)
    void fetchRun(issue, selected)
      .then(setDetail)
      .finally(() => setLoading(false))
  }, [issue, selected])

  // Land on whichever tab actually holds the issue being viewed.
  const [tab, setTab] = useState("active")
  useEffect(() => {
    if (issue != null && done.some((i) => i.number === issue)) setTab("done")
  }, [issue, done])

  return (
    <Shell state={state} onPoll={() => void poll()}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <SectionLabel>Run Explorer</SectionLabel>
          <h1 className="text-display-md">Transcripts</h1>
          <p className="max-w-2xl text-body-md text-muted-foreground">
            Every adapter invocation is recorded under{" "}
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs">
              .conductor/runs/&lt;issue&gt;/&lt;stage&gt;-&lt;ts&gt;.json
            </code>{" "}
            with the exact prompt sent, the full event stream, cost, and
            duration.
          </p>
        </div>

        <Separator />

        <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
          {/* ------------------------------------------------- issue + run list */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Issues</CardTitle>
                <CardDescription>
                  Pick an issue to load its runs
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsList className="w-full">
                    <TabsTrigger value="active">
                      Active
                      <Badge variant="secondary" className="tabular-nums">
                        {active.length}
                      </Badge>
                    </TabsTrigger>
                    <TabsTrigger value="done">
                      Done
                      <Badge variant="secondary" className="tabular-nums">
                        {done.length}
                      </Badge>
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="active">
                    <IssueList
                      issues={active}
                      selected={issue}
                      empty="No issues on the label board."
                    />
                  </TabsContent>
                  <TabsContent value="done">
                    <IssueList
                      issues={done}
                      selected={issue}
                      empty={
                        index === null
                          ? "Loading recorded runs…"
                          : "No completed runs recorded on this machine."
                      }
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {issue != null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Runs · issue #{issue}
                  </CardTitle>
                  <CardDescription>Newest first</CardDescription>
                </CardHeader>
                <CardContent>
                  {runs === null ? (
                    <div className="flex flex-col gap-2">
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-12 w-full" />
                    </div>
                  ) : runs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No runs recorded on this machine.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {runs.map((r) => {
                        const id = runId(r)
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setSelected(id)}
                            className={cn(
                              "flex flex-col gap-1 rounded-lg px-2.5 py-2 text-left ring-1 transition-colors",
                              selected === id
                                ? "bg-secondary ring-primary/40"
                                : "ring-border hover:bg-secondary/50"
                            )}
                          >
                            <span className="flex items-center gap-1.5">
                              <Badge
                                variant={
                                  r.outcome === "ok"
                                    ? "secondary"
                                    : "destructive"
                                }
                                className="font-mono"
                              >
                                {r.stage}
                              </Badge>
                              <span className="grow" />
                              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                                {r.costUsd != null ? formatUsd(r.costUsd) : "—"}
                              </span>
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {new Date(r.ts).toLocaleString()} ·{" "}
                              {formatDuration(r.durationMs)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ------------------------------------------------------ run detail */}
          <div className="min-w-0">
            {issue == null ? (
              <Empty className="h-96 rounded-xl ring-1 ring-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>Select an issue</EmptyTitle>
                  <EmptyDescription>
                    Choose an issue on the left to browse its recorded stage
                    runs.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : loading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-96 w-full" />
              </div>
            ) : detail ? (
              <RunView detail={detail} />
            ) : (
              <Empty className="h-96 rounded-xl ring-1 ring-border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileTextIcon />
                  </EmptyMedia>
                  <EmptyTitle>No run selected</EmptyTitle>
                  <EmptyDescription>
                    Pick a run from the list to see its transcript.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      </div>
    </Shell>
  )
}

interface IssueRow {
  number: number
  title: string
  cost: number
  label: string
}

function IssueList({
  issues,
  selected,
  empty,
}: {
  issues: IssueRow[]
  selected: number | null
  empty: string
}) {
  if (issues.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">{empty}</p>
  }
  return (
    <div className="flex flex-col gap-1">
      {issues.map((i) => (
        <Link
          key={i.number}
          to={`/runs/${i.number}`}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
            selected === i.number
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
          )}
        >
          <span className="font-mono text-label-md text-primary">
            #{i.number}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs">{i.title}</span>
          <span className="font-mono text-[10px] tabular-nums">
            {formatUsd(i.cost)}
          </span>
          <ChevronRightIcon className="size-3 shrink-0" />
        </Link>
      ))}
    </div>
  )
}

function RunView({ detail }: { detail: RunDetail }) {
  const events = useMemo(() => normalizeEvents(detail.result), [detail])
  const rows = useMemo(() => toRows(events), [events])
  const stats = useMemo(() => statsFor(events), [events])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Badge
              variant={detail.outcome === "ok" ? "secondary" : "destructive"}
              className="font-mono"
            >
              {detail.stage}
            </Badge>
            {detail.outcome === "ok" ? (
              <CheckCircle2Icon className="size-4 text-[var(--success)]" />
            ) : (
              <XCircleIcon className="size-4 text-destructive" />
            )}
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(detail.ts).toLocaleString()}
            </span>
          </CardTitle>
          <CardDescription>
            {detail.error ?? "Recorded adapter invocation"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metric
              icon={GaugeIcon}
              label="cost"
              value={detail.costUsd != null ? formatUsd(detail.costUsd) : "—"}
            />
            <Metric
              icon={GaugeIcon}
              label="duration"
              value={formatDuration(detail.durationMs)}
            />
            <Metric
              icon={TerminalIcon}
              label="turns"
              value={stats.turns != null ? String(stats.turns) : "—"}
            />
            <Metric
              icon={WrenchIcon}
              label="tool calls"
              value={String(stats.tools)}
            />
            <Metric
              icon={ShieldOffIcon}
              label="denied"
              value={String(stats.denied)}
              accent={stats.denied > 0}
            />
          </div>
          {stats.denied > 0 && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-brand-accent/10 p-3 text-xs text-muted-foreground ring-1 ring-brand-accent/25">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-brand-accent" />
              <span>
                {stats.denied} tool call{stats.denied === 1 ? "" : "s"} were
                denied by the stage&apos;s{" "}
                <code className="font-mono">--allowedTools</code> allowlist. The
                agent had to work around the restriction.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="transcript">
        <TabsList>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{rows.length} events</CardTitle>
              <CardDescription>
                Flattened from the stream-json event log ({events.length} raw
                lines)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This run recorded only a final result event — no transcript
                  was captured.
                </p>
              ) : (
                <ScrollArea className="h-[34rem]">
                  <div className="flex flex-col gap-2 pr-3">
                    {rows.map((row) => (
                      <Row key={row.key} row={row} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="prompt">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Prompt sent to the adapter
              </CardTitle>
              <CardDescription>
                Rendered from the stage template — issue text is untrusted input
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[34rem]">
                <pre className="pr-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {detail.prompt}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Raw log entry</CardTitle>
              <CardDescription>
                Exactly what RunLogger wrote to disk
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[34rem]">
                <pre className="pr-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(detail.result, null, 2)}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 font-mono text-label-md text-muted-foreground uppercase">
        <Icon className="size-3" />
        {label}
      </span>
      <span
        className={cn(
          "text-lg font-medium tabular-nums",
          accent && "text-brand-accent"
        )}
      >
        {value}
      </span>
    </div>
  )
}

const ROW_META: Record<
  TranscriptRow["kind"],
  {
    icon: React.ComponentType<{ className?: string }>
    tone: string
    title: string
  }
> = {
  init: { icon: TerminalIcon, tone: "text-primary", title: "session" },
  text: { icon: FileTextIcon, tone: "text-foreground", title: "message" },
  thinking: {
    icon: BrainIcon,
    tone: "text-muted-foreground",
    title: "thinking",
  },
  tool: { icon: WrenchIcon, tone: "text-chart-3", title: "tool" },
  tool_result: {
    icon: ChevronRightIcon,
    tone: "text-muted-foreground",
    title: "result",
  },
  denied: { icon: ShieldOffIcon, tone: "text-brand-accent", title: "denied" },
  rate_limit: {
    icon: AlertTriangleIcon,
    tone: "text-chart-5",
    title: "rate limit",
  },
  result: {
    icon: CheckCircle2Icon,
    tone: "text-[var(--success)]",
    title: "final result",
  },
}

function Row({ row }: { row: TranscriptRow }) {
  const meta = ROW_META[row.kind]
  const Icon = meta.icon

  const body =
    row.kind === "init"
      ? row.model
      : row.kind === "text" || row.kind === "thinking" || row.kind === "result"
        ? row.text
        : row.kind === "tool"
          ? `${row.name} · ${row.detail}`
          : row.detail

  const failed = row.kind === "tool_result" && row.failed

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg px-2.5 py-2 ring-1 ring-transparent",
        row.kind === "denied" && "bg-brand-accent/5 ring-brand-accent/20",
        row.kind === "result" && "bg-secondary/40 ring-border",
        failed && "bg-destructive/5 ring-destructive/20"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          failed ? "text-destructive" : meta.tone
        )}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-[10px] text-muted-foreground uppercase">
          {meta.title}
        </span>
        <p
          className={cn(
            "min-w-0 text-xs leading-relaxed break-words whitespace-pre-wrap",
            row.kind === "tool" || row.kind === "tool_result"
              ? "font-mono"
              : "",
            row.kind === "thinking" && "text-muted-foreground italic"
          )}
        >
          {body}
        </p>
      </div>
    </div>
  )
}
