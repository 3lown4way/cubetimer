#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export BATCH_SIZE="${BATCH_SIZE:-100}"
export BATCH_PARALLEL="${BATCH_PARALLEL:-1}"
export MAX_BENCH_WORKERS="${MAX_BENCH_WORKERS:-2}"
export SCRAMBLE_CONCURRENCY="${SCRAMBLE_CONCURRENCY:-1}"
export PROGRESS="${PROGRESS:-1}"

exec ./run-full-style-dataset.sh "$@"
