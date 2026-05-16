#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

NODE_VERSION="24.11.1"
NODE_DIR=".node"

node_major() {
	local v
	v="$(node --version 2>/dev/null || true)"
	v="${v#v}"
	v="${v%%.*}"
	case "$v" in
		''|*[!0-9]*) echo "-1" ;;
		*) echo "$v" ;;
	esac
}

usable_node() {
	command -v node >/dev/null 2>&1 || return 1
	local major
	major="$(node_major)"
	[ "$major" -ge 22 ] && [ "$major" -lt 25 ]
}

bootstrap_node() {
	local os arch tarball url localnode
	case "$(uname -s)" in
		Linux) os="linux" ;;
		Darwin) os="darwin" ;;
		*) echo "Unsupported OS for auto-install: $(uname -s). Install Node 24 manually." >&2; exit 1 ;;
	esac
	case "$(uname -m)" in
		x86_64|amd64) arch="x64" ;;
		arm64|aarch64) arch="arm64" ;;
		*) echo "Unsupported CPU for auto-install: $(uname -m). Install Node 24 manually." >&2; exit 1 ;;
	esac

	localnode="$NODE_DIR/node-v${NODE_VERSION}-${os}-${arch}"
	if [ -x "$localnode/bin/node" ]; then
		export PATH="$PWD/$localnode/bin:$PATH"
		return
	fi

	if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
		echo "Need curl or wget to auto-install Node. Install Node 24 manually." >&2
		exit 1
	fi

	tarball="node-v${NODE_VERSION}-${os}-${arch}.tar.gz"
	url="https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
	echo "Node not found - downloading Node ${NODE_VERSION} (${os}-${arch}, one-time)..."
	mkdir -p "$NODE_DIR"
	local tmp
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' RETURN

	if command -v curl >/dev/null 2>&1; then
		curl -fSL "$url" -o "$tmp/$tarball"
		curl -fSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
	else
		wget -q "$url" -O "$tmp/$tarball"
		wget -q "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -O "$tmp/SHASUMS256.txt"
	fi

	local want got
	want="$(grep " ${tarball}\$" "$tmp/SHASUMS256.txt" | awk '{print $1}')"
	if command -v sha256sum >/dev/null 2>&1; then
		got="$(sha256sum "$tmp/$tarball" | awk '{print $1}')"
	else
		got="$(shasum -a 256 "$tmp/$tarball" | awk '{print $1}')"
	fi
	if [ -z "$want" ] || [ "$want" != "$got" ]; then
		echo "Checksum verification failed for $tarball. Aborting." >&2
		exit 1
	fi

	tar -xzf "$tmp/$tarball" -C "$NODE_DIR"
	export PATH="$PWD/$localnode/bin:$PATH"
	echo "Node ${NODE_VERSION} ready (local, in ./$NODE_DIR - not on system PATH)."
}

if ! usable_node; then
	bootstrap_node
fi

if [ "$(node_major)" != "24" ]; then
	echo "Warning: running on Node $(node --version). Node 24 is recommended for"
	echo "byte-identical upstream parity (>=22 <25 works but is not identical)."
fi

if [ ! -d node_modules/tsx ] || [ ! -e node_modules/@google/gemini-cli-core/dist/index.js ]; then
	echo "First run - installing dependencies..."
	npm install --no-audit --no-fund
fi

exec npm start
