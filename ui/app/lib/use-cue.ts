import { useCallback, useEffect, useRef, useState } from "react";

import type { CueEvent, DashboardState, RunIndexEntry, RunSummary } from "./cue";
import { fetchRunIndex, fetchRuns, fetchState, runIssueSet } from "./cue";

const MAX_LOG_LINES = 400;

/** Board state plus the live SSE event tail from /api/events. */
export function useCue() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [events, setEvents] = useState<CueEvent[]>([]);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    setState(await fetchState());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let source: EventSource;
    try {
      source = new EventSource("/api/events");
    } catch {
      return;
    }
    source.addEventListener("open", () => setLive(true));
    source.addEventListener("error", () => setLive(false));
    source.addEventListener("message", (msg) => {
      const event = JSON.parse((msg as MessageEvent<string>).data) as CueEvent;
      setEvents((prev) => [...prev.slice(-MAX_LOG_LINES + 1), event]);
      if (event.kind === "done" || event.kind === "error") void refresh();
    });
    return () => source.close();
  }, [refresh]);

  return { state, events, live, refresh };
}

/** Issues with runs recorded on disk, including ones no longer on the board. */
export function useRunIndex() {
  const [index, setIndex] = useState<RunIndexEntry[] | null>(null);

  useEffect(() => {
    void fetchRunIndex().then(setIndex);
  }, []);

  return index;
}

/**
 * Every recorded run, newest first. Sourced from the disk index unioned with the
 * board, so completed (agent:done) work still counts toward the totals.
 *
 * `null` until the runs have landed. Returning [] while loading would render
 * every derived total as a truthful-looking zero, which is what the skeletons
 * exist to prevent — so the empty board must resolve to [], never stay null.
 * Hence `seen` starts as null: "" is a legitimate key (no issues at all).
 */
export function useAllRuns(state: DashboardState | null, index: RunIndexEntry[] | null) {
  const [runs, setRuns] = useState<Array<RunSummary & { issue: number }> | null>(null);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const issues = runIssueSet(state, index);
    if (!issues) return;
    const key = issues.join(",");
    if (key === seen.current) return;
    seen.current = key;
    void Promise.all(
      issues.map(async (issue) => (await fetchRuns(issue)).map((r) => ({ ...r, issue }))),
    ).then((all) => setRuns(all.flat().toSorted((a, b) => b.ts - a.ts)));
  }, [state, index]);

  return runs;
}
