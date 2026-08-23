export type Action = 'triage' | 'dev' | 'replan' | 'skip';

/** Labels that `cue run` / `cue process` will pick up, in queue order. */
export const ACTIONABLE_LABELS = ['agent:ready', 'agent:approved', 'agent:replan'] as const;

/**
 * First matching label wins. stop freezes the issue; replan beats a leftover
 * ready/approved; ready beats approved so a re-opened ticket is re-triaged.
 */
const PRIORITY: Array<[label: string, action: Action]> = [
  ['agent:stop', 'skip'],
  ['agent:replan', 'replan'],
  ['agent:ready', 'triage'],
  ['agent:approved', 'dev'],
];

export function nextAction(labels: string[]): Action {
  return PRIORITY.find(([label]) => labels.includes(label))?.[1] ?? 'skip';
}

/** The label `nextAction` actually selected — not GitHub's first `agent:*`. */
export function actioningLabel(labels: string[]): string | undefined {
  return PRIORITY.find(([label]) => labels.includes(label))?.[0];
}
