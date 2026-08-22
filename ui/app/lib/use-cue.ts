import { useCallback, useEffect, useRef, useState } from "react";

import type { CueEvent, DashboardState, RunIndexEntry, RunSummary } from "./cue";
import { fetchRunIndex, fetchRuns, fetchState } from "./cue";

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
 */
export function useAllRuns(state: DashboardState | null, index: RunIndexEntry[] | null) {
  const [runs, setRuns] = useState<Array<RunSummary & { issue: number }>>([]);
  const seen = useRef("");

  useEffect(() => {
    if (!state && !index) return;
    const issues = [
      ...new Set([
        ...(index ?? []).map((e) => e.issue),
        ...(state?.columns ?? []).flatMap((c) => c.issues.map((i) => i.number)),
      ]),
    ].toSorted((a, b) => a - b);
    const key = issues.join(",");
    if (key === seen.current) return;
    seen.current = key;
    void Promise.all(
      issues.map(async (issue) => (await fetchRuns(issue)).map((r) => ({ ...r, issue }))),
    ).then((all) => setRuns(all.flat().toSorted((a, b) => b.ts - a.ts)));
  }, [state, index]);

  return runs;
}
