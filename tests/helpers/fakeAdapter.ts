import type { AgentAdapter, AgentRunOptions } from '@/adapters/types';

export function makeFakeAdapter(responses: string[]): {
  adapter: AgentAdapter;
  runs: AgentRunOptions[];
} {
  const queue = [...responses];
  const runs: AgentRunOptions[] = [];
  const adapter: AgentAdapter = {
    async run(opts) {
      runs.push(opts);
      opts.onProgress?.('working');
      const text = queue.shift();
      if (text === undefined) throw new Error('fake adapter exhausted');
      return { text, costUsd: 0.01, turns: 1, raw: { fake: true } };
    },
  };
  return { adapter, runs };
}
