#!/usr/bin/env bash
# Build self-contained cue binaries for every supported platform.
# Output: dist/cue-<os>-<arch> + dist/checksums.txt
set -euo pipefail
cd "$(dirname "$0")/.."

bun install --frozen-lockfile
(cd ui && bun install --frozen-lockfile)

bun run check
bun run ui:check
bun run ui:build

# Embed the built dashboard into the compile graph (not committed).
bun scripts/embed-ui.ts

mkdir -p dist
targets=(bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64 bun-windows-x64)
for target in "${targets[@]}"; do
  out="dist/cue-${target#bun-}"
  [[ "${target}" == *windows* ]] && out+=".exe"
  echo "compiling ${out}"
  bun build --compile --target="${target}" src/cli.ts --outfile "${out}"
done

# Restore the committed empty manifest stub.
git checkout -- src/ui-manifest.g.ts

(cd dist && shasum -a 256 cue-* > checksums.txt)
echo "done:"
ls -la dist/
