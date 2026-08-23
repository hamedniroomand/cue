import { describe, expect, test } from 'bun:test';

import { GitHub } from '@/github';

import { makeFakeExec } from './helpers/fakeExec';

const ISSUE_JSON = JSON.stringify([
  {
    number: 7,
    title: 'Fix login',
    body: 'It breaks',
    labels: [{ name: 'agent:ready' }, { name: 'bug' }],
  },
]);

describe('GitHub', () => {
  test('listIssues flattens label objects to names', async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ['gh', 'issue', 'list', '--repo', 'acme/widgets', '--label', 'agent:ready'],
        result: { stdout: ISSUE_JSON },
      },
    ]);
    const issues = await new GitHub(exec, 'acme/widgets').listIssues('agent:ready');
    expect(issues).toEqual([
      { number: 7, title: 'Fix login', body: 'It breaks', labels: ['agent:ready', 'bug'] },
    ]);
    expect(calls[0]).toContain('--json');
  });

  test('getIssue views one issue and flattens label objects to names', async () => {
    const payload = JSON.stringify({
      number: 7,
      title: 'Fix login',
      body: 'It breaks',
      labels: [{ name: 'agent:ready' }, { name: 'bug' }],
    });
    const { exec, calls } = makeFakeExec([
      { match: ['gh', 'issue', 'view', '7'], result: { stdout: payload } },
    ]);
    const issue = await new GitHub(exec, 'acme/widgets').getIssue(7);
    expect(issue).toEqual({
      number: 7,
      title: 'Fix login',
      body: 'It breaks',
      labels: ['agent:ready', 'bug'],
    });
    expect(calls[0]).toEqual(
      expect.arrayContaining(['issue', 'view', '7', '--json', 'number,title,body,labels']),
    );
  });

  test('listActionable fans out the three labels and keeps each issue once', async () => {
    const dual = JSON.stringify([
      {
        number: 7,
        title: 'Fix login',
        body: '',
        labels: [{ name: 'agent:ready' }, { name: 'agent:replan' }],
      },
    ]);
    const approved = JSON.stringify([
      { number: 9, title: 'Ship it', body: '', labels: [{ name: 'agent:approved' }] },
    ]);
    const { exec, calls } = makeFakeExec([
      {
        match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:ready'],
        result: { stdout: dual },
      },
      {
        match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:approved'],
        result: { stdout: approved },
      },
      {
        match: ['gh', 'issue', 'list', '--repo', '*', '--label', 'agent:replan'],
        result: { stdout: dual },
      },
    ]);
    const issues = await new GitHub(exec, 'acme/widgets').listActionable();
    expect(issues.map((i) => i.number)).toEqual([7, 9]);
    expect(calls).toHaveLength(3);
  });

  test('listIssuesByLabel fans out in chunks and maps results per label', async () => {
    const labels = ['l1', 'l2', 'l3', 'l4'];
    const { exec, calls } = makeFakeExec(
      labels.map((label) => ({
        match: ['gh', 'issue', 'list', '--repo', '*', '--label', label],
        result: { stdout: label === 'l4' ? ISSUE_JSON : '[]' },
      })),
    );
    const byLabel = await new GitHub(exec, 'acme/widgets').listIssuesByLabel(labels);
    expect([...byLabel.keys()]).toEqual(labels);
    expect(byLabel.get('l4')?.[0]?.number).toBe(7);
    expect(byLabel.get('l1')).toEqual([]);
    // Chunked fan-out still issues one gh call per label, in label order.
    expect(calls.map((c) => c[6])).toEqual(labels);
  });

  test('swapLabel edits both labels in one gh call', async () => {
    const { exec, calls } = makeFakeExec([{ match: ['gh', 'issue', 'edit', '7'] }]);
    await new GitHub(exec, 'acme/widgets').swapLabel(7, 'agent:ready', 'agent:planned');
    expect(calls[0]).toEqual(
      expect.arrayContaining(['--remove-label', 'agent:ready', '--add-label', 'agent:planned']),
    );
  });

  test('findComment returns the newest comment containing the marker', async () => {
    const comments = JSON.stringify({
      comments: [{ body: 'old <!-- m --> v1' }, { body: 'noise' }, { body: 'new <!-- m --> v2' }],
    });
    const { exec } = makeFakeExec([
      { match: ['gh', 'issue', 'view', '7'], result: { stdout: comments } },
    ]);
    const found = await new GitHub(exec, 'acme/widgets').findComment(7, '<!-- m -->');
    expect(found).toContain('v2');
  });

  test('findComment returns null when absent', async () => {
    const { exec } = makeFakeExec([
      { match: ['gh', 'issue', 'view', '7'], result: { stdout: '{"comments":[]}' } },
    ]);
    expect(await new GitHub(exec, 'acme/widgets').findComment(7, '<!-- m -->')).toBeNull();
  });

  test('comments returns author logins and bodies in order', async () => {
    const payload = JSON.stringify({
      comments: [
        { author: { login: 'cue-bot' }, body: '<!-- m -->plan' },
        { author: { login: 'hamed' }, body: 'please reconsider' },
        { body: 'no author field' },
      ],
    });
    const { exec } = makeFakeExec([
      { match: ['gh', 'issue', 'view', '7'], result: { stdout: payload } },
    ]);
    const comments = await new GitHub(exec, 'acme/widgets').comments(7);
    expect(comments).toEqual([
      { author: 'cue-bot', body: '<!-- m -->plan' },
      { author: 'hamed', body: 'please reconsider' },
      { author: 'unknown', body: 'no author field' },
    ]);
  });

  test('throws on non-zero gh exit', async () => {
    const { exec } = makeFakeExec([
      { match: ['gh', 'issue', 'list'], result: { code: 1, stderr: 'auth required' } },
    ]);
    await expect(new GitHub(exec, 'acme/widgets').listIssues('agent:ready')).rejects.toThrow(
      'gh failed',
    );
  });

  test('labelAddedAt returns the newest labeled-event timestamp for the label', async () => {
    // The jq filter reduces the timeline to created_at lines, one per labeling.
    const { exec, calls } = makeFakeExec([
      {
        match: ['gh', 'api', 'repos/acme/widgets/issues/7/timeline'],
        result: { stdout: '2026-08-01T10:00:00Z\n2026-08-02T10:00:00Z\n' },
      },
    ]);
    const at = await new GitHub(exec, 'acme/widgets').labelAddedAt(7, 'agent:in-dev');
    expect(at).toBe(Date.parse('2026-08-02T10:00:00Z'));
    expect(calls[0]).toContain('--paginate');
    expect(calls[0]!.join(' ')).toContain('agent:in-dev');
  });

  test('labelAddedAt is tolerant: null on gh failure, empty timeline, garbage', async () => {
    for (const result of [
      { code: 1, stderr: 'api unavailable' },
      { stdout: '' },
      { stdout: 'not a date\n' },
    ]) {
      const { exec } = makeFakeExec([{ match: ['gh', 'api'], result }]);
      expect(await new GitHub(exec, 'acme/widgets').labelAddedAt(7, 'agent:in-dev')).toBeNull();
    }
  });

  test('createDraftPR returns the PR URL', async () => {
    const { exec, calls } = makeFakeExec([
      {
        match: ['gh', 'pr', 'create'],
        result: { stdout: 'https://github.com/acme/widgets/pull/9\n' },
      },
    ]);
    const url = await new GitHub(exec, 'acme/widgets').createDraftPR({
      branch: 'agent/issue-7',
      base: 'main',
      title: 't',
      body: 'b',
    });
    expect(url).toBe('https://github.com/acme/widgets/pull/9');
    expect(calls[0]).toContain('--draft');
  });
});
