#!/usr/bin/env bash
# benchmarks/run-all.sh — trivial wrapper around benchmarks/run-all.ts.
#
# Passes every argument through unchanged. Present for muscle-memory
# callers who reach for a shell script; the canonical entrypoint is
# `bun run benchmarks/run-all.ts` (or `bun run bench` / `bench:mock`
# / `bench:live` from package.json).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun run "$DIR/run-all.ts" "$@"
