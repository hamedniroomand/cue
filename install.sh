#!/usr/bin/env bash
# Install the conductor CLI from GitHub Releases.
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | bash
# Options (env vars):
#   CONDUCTOR_REPO     owner/repo to download from (default below)
#   CONDUCTOR_VERSION  release tag, e.g. v0.2.0 (default: latest)
#   CONDUCTOR_BIN_DIR  install directory (default: ~/.local/bin)
set -euo pipefail

REPO="${CONDUCTOR_REPO:-hamedniroomand/conductor}"
VERSION="${CONDUCTOR_VERSION:-latest}"
BIN_DIR="${CONDUCTOR_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    echo "error: unsupported OS $(uname -s) — conductor supports macOS and Linux (Windows via WSL)" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *)
    echo "error: unsupported architecture $(uname -m)" >&2
    exit 1
    ;;
esac

asset="conductor-${os}-${arch}"
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/${REPO}/releases/latest/download"
else
  base="https://github.com/${REPO}/releases/download/${VERSION}"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading ${asset} (${VERSION}) from ${REPO}…"
curl -fsSL "${base}/${asset}" -o "${tmp}/conductor"
curl -fsSL "${base}/checksums.txt" -o "${tmp}/checksums.txt"

expected="$(grep " ${asset}\$" "${tmp}/checksums.txt" | awk '{print $1}')"
actual="$(shasum -a 256 "${tmp}/conductor" | awk '{print $1}')"
if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  echo "error: checksum mismatch — refusing to install" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
install -m 755 "${tmp}/conductor" "${BIN_DIR}/conductor"
echo "installed ${BIN_DIR}/conductor ($("${BIN_DIR}/conductor" --version))"

case ":$PATH:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "note: ${BIN_DIR} is not on your PATH. Add this to your shell profile:"
    echo "  export PATH=\"${BIN_DIR}:\$PATH\""
    ;;
esac

echo
echo "next steps: install and authenticate the 'gh' and 'claude' CLIs, then run"
echo "'conductor init' inside a target repo. Docs: https://github.com/${REPO}"
