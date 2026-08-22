import { consola } from 'consola';
import { colors } from 'consola/utils';

import type { CueEvent } from '@/stages/context';

export type EventMethod = 'start' | 'success' | 'error' | 'log';

export function eventMethod(kind: CueEvent['kind']): EventMethod {
  switch (kind) {
    case 'start':
      return 'start';
    case 'done':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'log';
  }
}

// Stable per-stage colors so interleaved poll output stays scannable.
const STAGE_COLORS: Record<string, (text: string) => string> = {
  triage: colors.cyan,
  replan: colors.magenta,
  dev: colors.blue,
  fix: colors.blue,
  review: colors.yellow,
  'review-fix': colors.yellow,
  cleanup: colors.green,
};

const pad = (n: number) => String(n).padStart(2, '0');

function clock(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatEvent(e: CueEvent): string {
  const paint = STAGE_COLORS[e.stage] ?? colors.white;
  const tag = e.issue ? `${e.stage} #${e.issue}` : e.stage;
  return `${colors.dim(clock(e.ts))} ${colors.bold(paint(tag))} ${e.message}`;
}

export function printEvent(e: CueEvent): void {
  consola[eventMethod(e.kind)](formatEvent(e));
}
