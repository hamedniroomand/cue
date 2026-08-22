import { AdapterError } from '@/adapters/base';
import type { AgentResult, AgentRunOptions } from '@/adapters/types';
import type { StageContext } from '@/stages/context';

/**
 * Run the adapter and record the invocation, win or lose. A crashed run keeps
 * its prompt, partial transcript (via AdapterError), duration, and error on
 * disk — so the dashboard shows what the agent was doing when the stage died
 * instead of losing the run entirely.
 */
export async function loggedRun(
  ctx: StageContext,
  issue: number,
  stage: string,
  opts: AgentRunOptions,
): Promise<AgentResult> {
  const start = Date.now();
  try {
    const res = await ctx.adapter.run(opts);
    await ctx.logger.log(issue, stage, {
      prompt: opts.prompt,
      result: res.raw,
      costUsd: res.costUsd,
      durationMs: Date.now() - start,
      outcome: 'ok',
    });
    return res;
  } catch (err) {
    await ctx.logger.log(issue, stage, {
      prompt: opts.prompt,
      result: err instanceof AdapterError ? err.events : null,
      durationMs: Date.now() - start,
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
