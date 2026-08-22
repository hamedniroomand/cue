import ora, { type Ora } from 'ora';

/**
 * A single-slot terminal spinner for the waits Cue cannot narrate: the `gh`
 * round-trips at the top of `poll` and the issue lookup in `run`.
 *
 * Only one frame is ever live. Everything else Cue prints goes through
 * `interject`, which parks the frame so a log line cannot land mid-animation.
 * Disabled (and never constructed) when stdout is not a TTY, so CI logs,
 * pipes, and `cue ui`'s SSE stream stay byte-identical to before.
 */
export interface Spinner {
  readonly enabled: boolean;
  /** True while a frame is live — the caller must print, not succeed, when false. */
  readonly spinning: boolean;
  start(text: string): void;
  update(text: string): void;
  /** Ends the frame with a ✔. A no-op when nothing is spinning. */
  succeed(text: string): void;
  /** Ends the frame with a ✖. A no-op when nothing is spinning. */
  fail(text: string): void;
  /** Runs `print` with the frame parked, then resumes it if it was live. */
  interject(print: () => void): void;
}

export interface SpinnerOptions {
  enabled?: boolean;
  make?: (text: string) => Ora;
}

export function createSpinner(options: SpinnerOptions = {}): Spinner {
  // oxlint-disable-next-line no-unnecessary-boolean-literal-compare -- node types isTTY as boolean, but it is undefined (not false) on a pipe
  const enabled = options.enabled ?? process.stdout.isTTY === true;
  const make = options.make ?? ((text: string) => ora(text));
  // Created on first start(), so importing this module costs nothing and a
  // disabled spinner never touches the terminal at all.
  let live: Ora | null = null;

  const end = (method: 'succeed' | 'fail', text: string) => {
    if (!live) return;
    live[method](text);
    live = null;
  };

  return {
    enabled,
    get spinning() {
      return live !== null;
    },
    start(text) {
      if (!enabled) return;
      if (live) live.stop();
      live = make(text).start(text);
    },
    update(text) {
      if (live) live.text = text;
    },
    succeed(text) {
      end('succeed', text);
    },
    fail(text) {
      end('fail', text);
    },
    interject(print) {
      const resume = live;
      if (resume) resume.stop();
      print();
      if (resume) resume.start();
    },
  };
}

/** Wraps an awaited task in a frame, guaranteeing it is cleared either way. */
export async function withSpinner<T>(
  spinner: Spinner,
  text: string,
  task: () => Promise<T>,
): Promise<T> {
  spinner.start(text);
  try {
    const value = await task();
    spinner.succeed(text);
    return value;
  } catch (err) {
    spinner.fail(text);
    throw err;
  }
}

/**
 * A seam for modules that have pending phases but must not import ora — they
 * take a PhaseRunner and stay testable with `noPhase`.
 */
export type PhaseRunner = <T>(text: string, task: () => Promise<T>) => Promise<T>;

/** Runs the task with no terminal output. The default everywhere but the CLI. */
export const noPhase: PhaseRunner = (_text, task) => task();

export const spinnerPhase =
  (spinner: Spinner): PhaseRunner =>
  (text, task) =>
    withSpinner(spinner, text, task);

/** The CLI's one spinner — shared so the reporter and cli.ts cannot both spin. */
export const cliSpinner = createSpinner();

/** The CLI's phase runner, bound to that one spinner. */
export const cliPhase: PhaseRunner = spinnerPhase(cliSpinner);
