#!/usr/bin/env bun
import { join } from 'node:path';

import { consola } from 'consola';

import { ADAPTERS } from '@/adapters/registry';
import { formatTokens } from '@/adapters/usage';
import { runCleanup } from '@/cleanup';
import { resolveConfig } from '@/config';
import {
  PromptCancelled,
  clackAsk,
  promptConfig,
  promptSelectIssue,
  shouldPrompt,
} from '@/configure';
import { VERSION } from '@/embedded';
import { realExec } from '@/exec';
import { GitHub, type Issue } from '@/github';
import { RunLogger } from '@/log';
import { makeWebhookNotifier } from '@/notify';
import { nextAction, poll, runIssue } from '@/pipeline';
import { currentPlatform } from '@/platform';
import { printEvent } from '@/reporter';
import { readRawConfig, scaffold } from '@/scaffold';
import { cliPhase, cliSpinner, withSpinner } from '@/spinner';
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
  return {
    config,
    github: new GitHub(realExec, config.repo),
    adapter: ADAPTERS[config.adapter].make(realExec, platform),
    logger: new RunLogger(join(cwd, '.cue', 'runs')),
    exec: realExec,
    platform,
    worktrees: new WorktreeManager(realExec, config),
    // Project overrides win over the prompts packaged with cue itself.
    promptsDirs: [join(cwd, '.cue', 'prompts'), join(import.meta.dir, '..', 'prompts')],
    onEvent: printEvent,
    notify: makeWebhookNotifier(config.webhookUrl),
  };
}

/**
 * Interactive unless stdin/stdout are not both TTYs (CI, pipes, `cue init | tee`)
 * or `--yes` was passed — a scripted init must never block on a prompt.
 */
async function initAnswers(
  cwd: string,
  flags: string[],
): Promise<Record<string, unknown> | undefined> {
  if (!shouldPrompt(flags, { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY })) {
    return undefined;
  }
  const current = await readRawConfig(cwd);
  try {
    const { config, notes } = await promptConfig(current, clackAsk);
    for (const note of notes) consola.warn(note);
    return config;
  } catch (err) {
    // consolaAsk rejects on Ctrl+C, so bail out before anything is written.
    throw new Error('init cancelled — nothing was written', { cause: err });
  }
}

async function init(ctx: StageContext): Promise<void> {
  const answers = await initAnswers(ctx.config.repoPath, process.argv.slice(3));
  for (const change of await scaffold(ctx.config.repoPath, answers)) consola.success(change);
  const labels = `creating ${String(LABELS.length)} agent:* labels on ${ctx.config.repo}`;
  // A disabled spinner is silent, so piped/CI runs need these two lines to keep
  // the label phase visible the way the old per-label output did.
  if (!cliSpinner.enabled) consola.start(labels);
  await withSpinner(cliSpinner, labels, async () => {
    for (const [name, color, desc] of LABELS) {
      cliSpinner.update(`${labels} — ${name}`);
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
    }
  });
  if (!cliSpinner.enabled) consola.success(`${String(LABELS.length)} agent:* labels ready`);
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
  // Six `gh` queries (parallel, chunked) plus one rollup sweep: collect first
  // under one frame, then print, so the rows never land mid-animation.
  const rows = await withSpinner(
    cliSpinner,
    `reading ${ctx.config.repo} pipeline state`,
    async () => {
      const [index, byLabel] = await Promise.all([
        ctx.logger.index(),
        ctx.github.listIssuesByLabel(states),
      ]);
      const totals = new Map(index.map((e) => [e.issue, e]));
      const lines: string[] = [];
      for (const label of states) {
        for (const i of byLabel.get(label) ?? []) {
          const t = totals.get(i.number);
          // Codex and antigravity report no dollar cost, so a missing spend
          // means "unknown", not "free" — tokens are the comparable figure.
          const parts = [
            t?.costUsd ? `$${t.costUsd.toFixed(2)}` : '',
            t?.tokens ? `${formatTokens(t.tokens)} tokens` : '',
          ].filter(Boolean);
          const usage = parts.length > 0 ? ` (${parts.join(', ')} local)` : '';
          lines.push(`${label.padEnd(16)} #${i.number} ${i.title}${usage}`);
        }
      }
      return lines;
    },
  );
  for (const row of rows) consola.log(row);
  consola.log(`\nworktrees: ${ctx.config.worktreeRoot}`);
  consola.info(
    'stale agent:in-dev claims (crashed runs) are reset to agent:approved by `cue process` after staleClaimMinutes.',
  );
}

const HELP = `cue — drive headless coding agents through a GitHub-issue pipeline

Usage: cue <command> (run from inside a target repo)

Commands:
  init         configure .cue/ and create the agent:* labels in this repo
               (asks for adapter + test/lint commands; --yes keeps the defaults)
  process      reconcile finished PRs, then run every actionable issue
  poll         alias for process (kept for compatibility)
  run [n]      run the next pipeline stage for issue #n (interactive list if omitted)
  cleanup      reconcile merged/closed PRs: labels, worktrees, local branches
  status       issues per pipeline state, local spend, worktree root
  upgrade      update cue to the latest GitHub release (release installs only)
  ui [port]    web dashboard on http://127.0.0.1:<port> (default 4224); opens your
               browser automatically — pass --no-open to skip

Flags:
  -y, --yes       init: skip the questions and keep the current/default config
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
    // oxlint-disable-next-line no-console -- plain stdout so --help pipes cleanly (no consola decoration)
    console.log(HELP);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    // oxlint-disable-next-line no-console -- plain stdout so --version pipes cleanly
    console.log(VERSION);
    return;
  }
  if (command === 'upgrade') {
    // Only a compiled release binary can replace itself; a source checkout
    // (bun run src/cli.ts) would point execPath at bun, not cue.
    const compiled = import.meta.dir.includes('$bunfs') || import.meta.dir.includes('~BUN');
    if (!compiled) {
      throw new Error(
        'cue upgrade only works for release installs — use git pull on a source checkout',
      );
    }
    const { runUpgrade } = await import('@/upgrade');
    await runUpgrade({
      currentVersion: VERSION,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      phase: cliPhase,
      // oxlint-disable-next-line no-console -- plain stdout, matching bun upgrade's output style
      log: (m) => cliSpinner.interject(() => console.log(m)),
    });
    return;
  }
  const known = ['init', 'process', 'poll', 'run', 'cleanup', 'status', 'ui', 'upgrade'];
  if (!command || !known.includes(command)) {
    if (command) consola.error(`unknown command: ${command}\n`);
    // oxlint-disable-next-line no-console -- plain stdout so --help pipes cleanly
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  const ctx = await makeContext();
  switch (command) {
    case 'init':
      await init(ctx);
      break;
    case 'process':
    case 'poll':
      await poll(ctx);
      break;
    case 'run': {
      if (arg !== undefined) {
        const n = Number(arg);
        if (!Number.isInteger(n)) throw new Error('usage: cue run [issue-number]');
        const issues = await withSpinner(
          cliSpinner,
          `looking up issue #${n} on ${ctx.config.repo}`,
          async () => [
            ...(await ctx.github.listIssues('agent:ready')),
            ...(await ctx.github.listIssues('agent:approved')),
            ...(await ctx.github.listIssues('agent:replan')),
          ],
        );
        const issue = issues.find((i) => i.number === n);
        if (!issue)
          throw new Error(
            `issue #${n} is not in an actionable state (needs agent:ready, agent:approved, or agent:replan)`,
          );
        consola.info(`running ${nextAction(issue.labels)} for #${n}`);
        await runIssue(ctx, issue);
        break;
      }

      if (!shouldPrompt([], { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY })) {
        throw new Error('usage: cue run <issue-number>');
      }

      const issues = await withSpinner(
        cliSpinner,
        `reading ${ctx.config.repo} actionable issues`,
        async () => {
          const byLabel = await ctx.github.listIssuesByLabel([
            'agent:ready',
            'agent:approved',
            'agent:replan',
          ]);
          const ready = byLabel.get('agent:ready') ?? [];
          const approved = byLabel.get('agent:approved') ?? [];
          const replans = byLabel.get('agent:replan') ?? [];
          const seen = new Set<number>();
          const deduped: Issue[] = [];
          for (const item of [...ready, ...approved, ...replans]) {
            if (!seen.has(item.number)) {
              seen.add(item.number);
              deduped.push(item);
            }
          }
          return deduped;
        },
      );

      if (issues.length === 0) {
        consola.info(
          `no actionable issues found on ${ctx.config.repo} (needs agent:ready, agent:approved, or agent:replan)`,
        );
        break;
      }

      try {
        const selected = await promptSelectIssue(issues, clackAsk);
        if (selected) {
          consola.info(`running ${nextAction(selected.labels)} for #${selected.number}`);
          await runIssue(ctx, selected);
        }
      } catch (err) {
        if (err instanceof PromptCancelled) break;
        throw err;
      }
      break;
    }
    case 'cleanup':
      await withSpinner(cliSpinner, `reconciling ${ctx.config.repo} draft PRs`, () =>
        runCleanup(ctx),
      );
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
