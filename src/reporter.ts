import { consola } from 'consola';
import { colors } from 'consola/utils';

import { cliSpinner, type Spinner } from '@/spinner';
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

/**
 * Builds the CLI's event printer. `poll` is the one stage with dead air — the
 * cleanup pass and three `gh` issue queries happen between its `start` and its
 * queue summary — so it drives the spinner. Every other stage narrates itself,
 * so its events stay as scrollback lines, printed with the frame parked.
 */
export function makeEventPrinter(spinner: Spinner): (e: CueEvent) => void {
  return (e) => {
    const line = formatEvent(e);
    if (e.stage === 'poll' && spinner.enabled) {
      if (e.kind === 'start') {
        spinner.start(line);
        return;
      }
      // Resolve the live frame; poll's closing summary arrives long after the
      // queue summary already ended it, so it falls through to a plain line.
      if (spinner.spinning) {
        if (e.kind === 'error') spinner.fail(line);
        else spinner.succeed(line);
        return;
      }
    }
    spinner.interject(() => consola[eventMethod(e.kind)](line));
  };
}

export const printEvent = makeEventPrinter(cliSpinner);
