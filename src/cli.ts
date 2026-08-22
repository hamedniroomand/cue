#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { consola } from 'consola';

import { ClaudeAdapter } from '@/adapters/claude';
import type { AgentAdapter } from '@/adapters/types';
import { runCleanup } from '@/cleanup';
import { resolveConfig } from '@/config';
import { VERSION } from '@/embedded';
import { realExec } from '@/exec';
import { GitHub } from '@/github';
import { RunLogger } from '@/log';
import { nextAction, poll, runIssue } from '@/pipeline';
import { currentPlatform } from '@/platform';
import { printEvent } from '@/reporter';
import type { StageContext } from '@/stages/context';
import { WorktreeManager } from '@/worktree';

const LABELS: Array<[name: string, color: string, desc: string]> = [
  ['agent:ready', '0E8A16', 'Cue: pick this up for triage'],
  ['agent:planned', 'FBCA04', 'Cue: plan posted, awaiting human approval'],
  ['agent:approved', '0052CC', 'Cue: plan approved, ready for dev'],
  ['agent:replan', 'F9D0C4', 'Cue: human requested a revised plan (leave feedback as comments)'],
  ['agent:in-dev', '5319E7', 'Cue: dev stage running'],
  ['agent:in-review', 'D93F0B', 'Cue: draft PR open, awaiting human merge'],
  ['agent:done', 'C5DEF5', 'Cue: PR merged, pipeline complete'],
  ['agent:failed', 'B60205', 'Cue: a stage failed, see issue comments'],
  ['agent:stop', '000000', 'Cue: kill switch, never touch this issue'],
];

async function makeContext(): Promise<StageContext> {
  const cwd = process.cwd();
  const config = await resolveConfig(realExec, cwd);
  const platform = currentPlatform();
  if (config.adapter === 'codex') throw new Error('codex adapter not implemented yet');
  const adapter: AgentAdapter = new ClaudeAdapter(realExec, platform);
  return {
    config,
    github: new GitHub(realExec, config.repo),
    adapter,
    logger: new RunLogger(join(cwd, '.cue', 'runs')),
    exec: realExec,
    platform,
    worktrees: new WorktreeManager(realExec, config),
    // Project overrides win over the prompts packaged with cue itself.
    promptsDirs: [join(cwd, '.cue', 'prompts'), join(import.meta.dir, '..', 'prompts')],
    onEvent: printEvent,
  };
}

async function scaffold(cwd: string): Promise<void> {
  await mkdir(join(cwd, '.cue', 'prompts'), { recursive: true });
  const configFile = Bun.file(join(cwd, '.cue', 'config.json'));
  if (!(await configFile.exists())) {
    await Bun.write(configFile, `${JSON.stringify({ gate: { test: 'bun test' } }, null, 2)}\n`);
    consola.success("created .cue/config.json — adjust the gate to this project's test command");
  }
  const gitignorePath = join(cwd, '.gitignore');
  const gitignoreFile = Bun.file(gitignorePath);
  const current = (await gitignoreFile.exists()) ? await gitignoreFile.text() : '';
  if (!current.includes('.cue/runs/')) {
    await Bun.write(gitignorePath, `${current.replace(/\n?$/, '\n')}.cue/runs/\n`);
    consola.success('added .cue/runs/ to .gitignore');
  }
}

async function init(ctx: StageContext): Promise<void> {
  await scaffold(ctx.config.repoPath);
  consola.start(`creating agent:* labels on ${ctx.config.repo}`);
  for (const [name, color, desc] of LABELS) {
    const r = await realExec([
      'gh',
      'label',
      'create',
      name,
      '--repo',
      ctx.config.repo,
      '--color',
      color,
      '--description',
      desc,
      '--force',
    ]);
    if (r.code !== 0) throw new Error(`label create ${name} failed: ${r.stderr}`);
    consola.success(`label ${name} ok`);
  }
}

async function status(ctx: StageContext): Promise<void> {
  const states = [
    'agent:ready',
    'agent:planned',
    'agent:approved',
    'agent:in-dev',
    'agent:in-review',
    'agent:failed',
  ];
  for (const label of states) {
    const issues = await ctx.github.listIssues(label);
    for (const i of issues) {
      const cost = await ctx.logger.totalCost(i.number);
      consola.log(`${label.padEnd(16)} #${i.number} ${i.title} ($${cost.toFixed(2)} local spend)`);
    }
  }
  consola.log(`\nworktrees: ${ctx.config.worktreeRoot}`);
  consola.info('stale agent:in-dev issues (crashed runs) must be relabeled manually.');
}

const HELP = `cue — drive headless coding agents through a GitHub-issue pipeline

Usage: cue <command> (run from inside a target repo)

Commands:
  init         create the agent:* labels and scaffold .cue/ in this repo
  poll         reconcile finished PRs, then run every actionable issue
  run <n>      run the next pipeline stage for issue #n
  cleanup      reconcile merged/closed PRs: labels, worktrees, local branches
  status       issues per pipeline state, local spend, worktree root
  ui [port]    web dashboard on http://127.0.0.1:<port> (default 4224); opens your
               browser automatically — pass --no-open to skip

Flags:
  -h, --help      show this help
  -v, --version   print the cue version

Labels drive the pipeline: agent:ready → triage plans, a human approves
(agent:approved) → dev implements + review verdicts + draft PR, a human merges.
agent:replan requests a revised plan; agent:stop freezes an issue.
Full state machine and configuration:
https://hamedniroomand.github.io/cue/`;

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url];
  try {
    await realExec(cmd);
  } catch {
    consola.warn('could not open a browser automatically — use the URL above');
  }
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(VERSION);
    return;
  }
  const known = ['init', 'poll', 'run', 'cleanup', 'status', 'ui'];
  if (!command || !known.includes(command)) {
    if (command) consola.error(`unknown command: ${command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  const ctx = await makeContext();
  switch (command) {
    case 'init':
      await init(ctx);
      break;
    case 'poll':
      await poll(ctx);
      break;
    case 'run': {
      const n = Number(arg);
      if (!Number.isInteger(n)) throw new Error('usage: cue run <issue-number>');
      consola.start(`looking up issue #${n} on ${ctx.config.repo}`);
      const issues = [
        ...(await ctx.github.listIssues('agent:ready')),
        ...(await ctx.github.listIssues('agent:approved')),
        ...(await ctx.github.listIssues('agent:replan')),
      ];
      const issue = issues.find((i) => i.number === n);
      if (!issue)
        throw new Error(
          `issue #${n} is not in an actionable state (needs agent:ready, agent:approved, or agent:replan)`,
        );
      consola.info(`running ${nextAction(issue.labels)} for #${n}`);
      await runIssue(ctx, issue);
      break;
    }
    case 'cleanup':
      await runCleanup(ctx);
      break;
    case 'ui': {
      const uiArgs = process.argv.slice(3);
      const portArg = uiArgs.find((a) => !a.startsWith('--'));
      const port = portArg ? Number(portArg) : 4224;
      if (!Number.isInteger(port) || port <= 0) throw new Error('usage: cue ui [port] [--no-open]');
      const { startServer } = await import('@/server');
      const { url } = startServer(ctx, port);
      consola.info(`cue ui for ${ctx.config.repo}: ${url}`);
      if (!uiArgs.includes('--no-open')) await openBrowser(url);
      break;
    }
    case 'status':
      await status(ctx);
      break;
  }
}

main().catch((err) => {
  consola.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
