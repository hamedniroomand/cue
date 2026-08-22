import { chmod, rename, unlink } from 'node:fs/promises';

const DEFAULT_REPO = 'hamedniroomand/cue';

export interface UpgradeOptions {
  currentVersion: string;
  execPath: string;
  platform: NodeJS.Platform;
  arch: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  log: (message: string) => void;
}

/** Release asset for a host, mirroring scripts/build-binaries.sh output.
 *  Windows ships x64 only — ARM devices run it through emulation. */
export function assetName(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32') return 'cue-windows-x64.exe';
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  if (!os || (arch !== 'arm64' && arch !== 'x64')) {
    throw new Error(`unsupported platform for cue upgrade: ${platform}-${arch}`);
  }
  return `cue-${os}-${arch}`;
}

async function fetchOk(fetchImpl: typeof fetch, url: string): Promise<Response> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'cue-upgrade' } });
  if (!res.ok) throw new Error(`upgrade check failed: HTTP ${String(res.status)} for ${url}`);
  return res;
}

/** Self-update from the latest GitHub release: checksum-verified, and the
 *  running binary is swapped by rename (moved aside first on Windows, which
 *  cannot overwrite a running executable). Returns true if an upgrade ran. */
export async function runUpgrade(opts: UpgradeOptions): Promise<boolean> {
  const repo = opts.repo ?? DEFAULT_REPO;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const started = Date.now();

  const latest = await fetchOk(fetchImpl, `https://api.github.com/repos/${repo}/releases/latest`);
  const { tag_name: tag } = (await latest.json()) as { tag_name: string };
  if (tag === `v${opts.currentVersion}`) {
    opts.log(`You're on the latest version of Cue (${tag})`);
    return false;
  }
  opts.log(`Cue ${tag} is out! You're on v${opts.currentVersion}`);

  const asset = assetName(opts.platform, opts.arch);
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const [binary, checksums] = await Promise.all([
    fetchOk(fetchImpl, `${base}/${asset}`).then((r) => r.arrayBuffer()),
    fetchOk(fetchImpl, `${base}/checksums.txt`).then((r) => r.text()),
  ]);

  const expected = checksums
    .split('\n')
    .find((line) => line.trimEnd().endsWith(` ${asset}`))
    ?.trim()
    .split(/\s+/)[0];
  const actual = new Bun.CryptoHasher('sha256').update(binary).digest('hex');
  if (!expected || expected !== actual) {
    throw new Error(`checksum mismatch for ${asset} — refusing to upgrade`);
  }

  const tmp = `${opts.execPath}.tmp`;
  await Bun.write(tmp, binary);
  if (opts.platform === 'win32') {
    // A running exe cannot be overwritten on Windows, but it can be renamed.
    await unlink(`${opts.execPath}.old`).catch(() => {});
    await rename(opts.execPath, `${opts.execPath}.old`);
  } else {
    await chmod(tmp, 0o755);
  }
  await rename(tmp, opts.execPath);

  opts.log(`[${((Date.now() - started) / 1000).toFixed(2)}s] Upgraded.`);
  opts.log(`Welcome to Cue ${tag}!`);
  return true;
}
