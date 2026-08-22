import type { AgentAdapter, AgentResult, AgentRunOptions } from '@/adapters/types';
import type { Exec } from '@/exec';
import { currentPlatform, scrubbedEnv, type Platform } from '@/platform';

/** Parse a JSONL stdout stream, ignoring non-JSON noise between events. */
export function parseJsonLines<T>(stdout: string): T[] {
  const events: T[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as T);
    } catch {
      // non-JSON noise on stdout is ignored
    }
  }
  return events;
}

/**
 * Shared shell for every headless-CLI adapter: scrub the env down to the
 * platform vars plus this adapter's own provider keys, run the CLI through
 * the injected Exec, stream progress from JSONL lines, and hand the parsed
 * event list to the adapter's extractor. Subclasses own only what genuinely
 * differs per vendor: the command line, the progress grammar, and how the
 * final result is pulled out of the stream.
 */
export abstract class JsonlAdapter<TEvent> implements AgentAdapter {
  /** Binary name, used in error messages. */
  protected abstract readonly bin: string;
  /** Provider credentials this adapter's subprocess may receive — and no other's. */
  protected abstract readonly envKeys: string[];
  /** Whether this CLI can be told to search the web. Adapters that cannot
   *  must still declare it, so a webSearch request is surfaced, not silently
   *  dropped. */
  protected abstract readonly supportsWebSearch: boolean;

  constructor(
    protected exec: Exec,
    protected platform: Platform = currentPlatform(),
  ) {}

  protected abstract command(opts: AgentRunOptions): string[];
  protected abstract progressFor(ev: TEvent): string[];
  protected abstract extract(events: TEvent[], opts: AgentRunOptions): AgentResult;

  async run(opts: AgentRunOptions): Promise<AgentResult> {
    if (opts.webSearch && !this.supportsWebSearch)
      opts.onProgress?.(
        `⚠ ${this.bin} has no web search flag — continuing without guaranteed web access`,
      );
    const onLine = opts.onProgress
      ? (line: string) => {
          try {
            for (const msg of this.progressFor(JSON.parse(line) as TEvent)) opts.onProgress!(msg);
          } catch {
            // partial or non-JSON line; skip
          }
        }
      : undefined;

    const r = await this.exec(this.command(opts), {
      cwd: opts.cwd,
      env: scrubbedEnv(this.platform, this.envKeys),
      timeoutMs: opts.timeoutMs,
      onLine,
    });
    if (r.code !== 0) {
      // A timeout kill often leaves stderr empty; the stdout tail is the next
      // best clue to what the agent was doing.
      const detail = r.stderr.slice(0, 500) || r.stdout.slice(-500);
      throw new Error(`${this.bin} exited ${r.code}: ${detail}`);
    }
    return this.extract(parseJsonLines<TEvent>(r.stdout), opts);
  }
}
