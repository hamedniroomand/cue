/**
 * Loading placeholders for the API-driven sections.
 *
 * One rule throughout: a skeleton fills the same box the real content occupies,
 * so nothing shifts when the data lands. That is why these mirror the real
 * Card/Stat/chart shells rather than being loose grey blocks.
 */
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { BOARD_LABELS, shortLabel } from "~/lib/cue";
import { cn } from "~/lib/utils";

/** Header badge / model chip placeholder. */
export function ChipSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-5 w-20 rounded-4xl", className)} />;
}

/** Mirrors <Stat>: mono label, big tabular value, muted hint. */
export function StatSkeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card className={cn("reveal justify-between", className)} style={style}>
      <CardHeader>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-20" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

/**
 * Bar-shaped chart placeholder. `surface` swaps to translucent white for the
 * dark executive-summary panel, where bg-muted is invisible.
 */
export function ChartSkeleton({
  className,
  bars = 7,
  surface,
}: {
  className?: string;
  bars?: number;
  surface?: boolean;
}) {
  // Deterministic pseudo-random heights: a chart silhouette reads as loading
  // data far better than one flat block, and no RNG keeps renders stable.
  const heights = Array.from({ length: bars }, (_, i) => 35 + ((i * 37) % 60));
  return (
    <div className={cn("flex w-full items-end gap-2", className)} aria-hidden>
      {heights.map((h) => (
        <Skeleton
          key={h}
          className={cn("flex-1 rounded-t-md rounded-b-none", surface && "bg-white/15")}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The label state machine before /api/state lands. The columns are known
 * statically (BOARD_LABELS, guarded against the server's list by
 * tests/board.test.ts), so the real headers render immediately and only the
 * cards are placeholders.
 */
export function BoardSkeleton() {
  return (
    <div className="grid auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
      {BOARD_LABELS.map((label, column) => (
        <div key={label} className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-label-md text-muted-foreground uppercase">
              {shortLabel(label)}
            </span>
            <Badge variant="secondary" className="tabular-nums">
              <Skeleton className="h-2 w-2" />
            </Badge>
          </div>
          <div className="flex flex-col gap-2">
            {/* Staggered card counts so the placeholder reads as a board, not a grid. */}
            {Array.from({ length: column % 3 === 1 ? 2 : 1 }, (_, card) => (
              <div
                key={`${label}-${card}`}
                className="flex flex-col gap-1.5 rounded-lg bg-secondary p-2.5 ring-1 ring-border"
              >
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-12" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
