/**
 * Snapshot of real .cue run logs, used when /api is unreachable so the
 * dashboard renders (and can be reviewed) without a cue process.
 * Regenerate with: bun run fixtures
 */
import type { DashboardState, RunDetail, RunIndexEntry, RunSummary } from "~/lib/cue";
import data from "./data.json";

export interface Fixtures {
  state: DashboardState;
  index: RunIndexEntry[];
  runs: Record<number, RunSummary[]>;
  details: Record<number, RunDetail[]>;
}

export default data as unknown as Fixtures;
