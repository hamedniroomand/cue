import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assetName, runUpgrade } from '@/upgrade';

const sha256 = (data: string) => {
  const h = new Bun.CryptoHasher('sha256');
  h.update(data);
  return h.digest('hex');
};

/** Fake fetch serving a release: latest tag, one binary asset, checksums. */
function fakeRelease(tag: string, asset: string, binary: string, checksumOf = binary) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (url.endsWith('/releases/latest')) return Response.json({ tag_name: tag });
    if (url.endsWith(`/${tag}/${asset}`)) return new Response(binary);
    if (url.endsWith(`/${tag}/checksums.txt`)) {
      return new Response(`${sha256(checksumOf)}  ${asset}\n`);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function scratchBinary(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cue-upgrade-'));
  const execPath = join(dir, name);
  await Bun.write(execPath, 'old-binary');
  return execPath;
}

describe('assetName', () => {
  test('maps each supported platform and arch to a release asset', () => {
    expect(assetName('darwin', 'arm64')).toBe('cue-darwin-arm64');
    expect(assetName('darwin', 'x64')).toBe('cue-darwin-x64');
    expect(assetName('linux', 'x64')).toBe('cue-linux-x64');
    expect(assetName('linux', 'arm64')).toBe('cue-linux-arm64');
  });

  test('windows is always the x64 exe (arm devices run it emulated)', () => {
    expect(assetName('win32', 'x64')).toBe('cue-windows-x64.exe');
    expect(assetName('win32', 'arm64')).toBe('cue-windows-x64.exe');
  });

  test('throws on unsupported combinations', () => {
    expect(() => assetName('linux', 'ia32')).toThrow('unsupported');
  });
});

describe('runUpgrade', () => {
  test('reports already-latest without downloading anything', async () => {
    const { fetchImpl, calls } = fakeRelease('v0.3.0', 'cue-linux-x64', 'new-binary');
    const logs: string[] = [];
    const execPath = await scratchBinary('cue');
    const upgraded = await runUpgrade({
      currentVersion: '0.3.0',
      execPath,
      platform: 'linux',
      arch: 'x64',
      fetchImpl,
      log: (m) => logs.push(m),
    });
    expect(upgraded).toBe(false);
    expect(logs.join('\n')).toContain("You're on the latest version");
    expect(calls).toHaveLength(1);
    expect(await Bun.file(execPath).text()).toBe('old-binary');
  });

  test('downloads, verifies the checksum, and replaces the running binary', async () => {
    const { fetchImpl } = fakeRelease('v9.9.9', 'cue-linux-x64', 'new-binary');
    const logs: string[] = [];
    const execPath = await scratchBinary('cue');
    const upgraded = await runUpgrade({
      currentVersion: '0.3.0',
      execPath,
      platform: 'linux',
      arch: 'x64',
      fetchImpl,
      log: (m) => logs.push(m),
    });
    expect(upgraded).toBe(true);
    expect(logs.join('\n')).toContain("Cue v9.9.9 is out! You're on v0.3.0");
    expect(logs.join('\n')).toContain('Welcome to Cue v9.9.9!');
    expect(await Bun.file(execPath).text()).toBe('new-binary');
  });

  test('on windows the running exe is moved aside, not overwritten', async () => {
    const { fetchImpl } = fakeRelease('v9.9.9', 'cue-windows-x64.exe', 'new-binary');
    const execPath = await scratchBinary('cue.exe');
    const upgraded = await runUpgrade({
      currentVersion: '0.3.0',
      execPath,
      platform: 'win32',
      arch: 'x64',
      fetchImpl,
      log: () => {},
    });
    expect(upgraded).toBe(true);
    expect(await Bun.file(execPath).text()).toBe('new-binary');
    expect(await Bun.file(`${execPath}.old`).text()).toBe('old-binary');
  });

  test('a checksum mismatch aborts and leaves the binary untouched', async () => {
    const { fetchImpl } = fakeRelease('v9.9.9', 'cue-linux-x64', 'new-binary', 'tampered');
    const execPath = await scratchBinary('cue');
    await expect(
      runUpgrade({
        currentVersion: '0.3.0',
        execPath,
        platform: 'linux',
        arch: 'x64',
        fetchImpl,
        log: () => {},
      }),
    ).rejects.toThrow('checksum mismatch');
    expect(await Bun.file(execPath).text()).toBe('old-binary');
  });
});
