#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECO_DIR="${RECO_DIR:-$ROOT_DIR/vendor-data/reco}"

INPUT="${INPUT:-$RECO_DIR/reco-all-3x3-gte100-details.json}"
STYLE_PROFILE_INPUT="${STYLE_PROFILE_INPUT:-$RECO_DIR/reco-3x3-style-features.json}"

OUTPUT_STRICT="${OUTPUT_STRICT:-$RECO_DIR/reco-3x3-style-benchmark-strict.json}"
OUTPUT_ZB="${OUTPUT_ZB:-$RECO_DIR/reco-3x3-style-benchmark-zb.json}"
OUTPUT_MERGED="${OUTPUT_MERGED:-$RECO_DIR/reco-3x3-style-benchmark.json}"

STRICT_LOG="${STRICT_LOG:-$RECO_DIR/benchmark-strict.log}"
ZB_LOG="${ZB_LOG:-$RECO_DIR/benchmark-zb.log}"

BATCH_DIR="${BATCH_DIR:-$RECO_DIR/style-benchmark-batches}"
STRICT_BATCH_DIR="${STRICT_BATCH_DIR:-$BATCH_DIR/strict}"
ZB_BATCH_DIR="${ZB_BATCH_DIR:-$BATCH_DIR/zb}"

METHODS="${METHODS:-CFOP,ZB}"
STYLES="${STYLES:-legacy,balanced,rotationless,low-auf}"
LIMIT="${LIMIT:-20000}"
PER_SOLVER_LIMIT="${PER_SOLVER_LIMIT:-0}"
BATCH_SIZE="${BATCH_SIZE:-100}"
BATCH_START_OFFSET="${BATCH_START_OFFSET:-0}"
BATCH_RESUME="${BATCH_RESUME:-0}"
BATCH_FORCE="${BATCH_FORCE:-${BENCH_FORCE:-0}}"
SCRAMBLE_CONCURRENCY="${SCRAMBLE_CONCURRENCY:-}"
MAX_BENCH_WORKERS="${MAX_BENCH_WORKERS:-}"
STRICT_TIMEOUT_MS="${STRICT_TIMEOUT_MS:-${TIMEOUT_MS:-3000}}"
ZB_TIMEOUT_MS="${ZB_TIMEOUT_MS:-${TIMEOUT_MS:-5000}}"

PROGRESS="${PROGRESS:-0}"
PROGRESS_INTERVAL="${PROGRESS_INTERVAL:-1}"
PROGRESS_LINES="${PROGRESS_LINES:-0}"
BENCH_PARALLEL="${BENCH_PARALLEL:-0}"
BENCH_RETRIES="${BENCH_RETRIES:-2}"

mkdir -p "$RECO_DIR" "$STRICT_BATCH_DIR" "$ZB_BATCH_DIR"

if [[ "$BATCH_FORCE" -eq 1 ]]; then
  BATCH_RESUME=0
fi

CPU_COUNT="$(detect_cpu_count)"
STYLE_COUNT="$(count_csv_items "$STYLES")"
MODE_PARALLEL_FACTOR=1
if [[ "$BENCH_PARALLEL" -eq 1 ]]; then
  MODE_PARALLEL_FACTOR=2
fi

if [[ -z "$MAX_BENCH_WORKERS" ]]; then
  MAX_BENCH_WORKERS="$CPU_COUNT"
fi

if [[ -z "$SCRAMBLE_CONCURRENCY" ]]; then
  SCRAMBLE_CONCURRENCY=$((CPU_COUNT / (STYLE_COUNT * MODE_PARALLEL_FACTOR)))
  if [[ "$SCRAMBLE_CONCURRENCY" -lt 1 ]]; then
    SCRAMBLE_CONCURRENCY=1
  fi
fi

if [[ "$PER_SOLVER_LIMIT" -gt 0 ]]; then
  echo "Batched mode expects PER_SOLVER_LIMIT=0." >&2
  exit 1
fi

total_scrambles() {
  node -e "const fs=require('fs'); const p=process.argv[1]; const methodsRaw=process.argv[2]||''; const limit=parseInt(process.argv[3]||'0',10)||0; const data=JSON.parse(fs.readFileSync(p,'utf8')); const records=Array.isArray(data)? data : (data.records||[]); const methods=new Set(methodsRaw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)); const seen=new Set(); let total=0; for (const row of records){ if (!row||!row.ok) continue; const puzzle=String(row?.meta?.puzzle||row?.puzzle||'').trim(); if (puzzle!=='3x3') continue; const sourceMethod=String(row.method||row?.meta?.method||'').trim().toUpperCase(); if (methods.size && !methods.has(sourceMethod)) continue; const scramble=String(row.scramble||'').trim(); if (!scramble) continue; if (seen.has(scramble)) continue; seen.add(scramble); total++; } if (limit>0 && total>limit) total=limit; console.log(total);" "$INPUT" "$METHODS" "$LIMIT"
}

detect_cpu_count() {
  local cpu_count
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
  if [[ -z "$cpu_count" || "$cpu_count" -lt 1 ]]; then
    cpu_count="$(command -v nproc >/dev/null 2>&1 && nproc || echo 1)"
  fi
  if [[ -z "$cpu_count" || "$cpu_count" -lt 1 ]]; then
    cpu_count=1
  fi
  echo "$cpu_count"
}

count_csv_items() {
  local raw="$1"
  local count
  count="$(awk -F',' '{print NF}' <<<"$raw")"
  if [[ -z "$count" || "$count" -lt 1 ]]; then
    count=1
  fi
  echo "$count"
}

latest_sample() {
  local log="$1"
  local sample
  sample="$(tail -n 200 "$log" 2>/dev/null | grep -Eo 'sample [0-9]+' | tail -n 1 | awk '{print $2}')"
  if [[ -z "$sample" ]]; then
    echo 0
  else
    echo "$sample"
  fi
}

render_progress_block() {
  local mode="$1"
  local ts="$2"
  local current="$3"
  local total="$4"
  local pct="$5"
  local eta="$6"
  local line_count=0

  if [[ -n "${PROGRESS_BLOCK_LINES:-}" && "${PROGRESS_BLOCK_LINES:-0}" -gt 0 ]]; then
    printf '\033[%sA' "$PROGRESS_BLOCK_LINES"
  fi

  printf '\033[2K[%s] %s overall: %s/%s (%s%%) ETA %s\n' "$ts" "$mode" "$current" "$total" "$pct" "$eta"
  line_count=1

  PROGRESS_BLOCK_LINES="$line_count"
}

clear_progress_block() {
  if [[ -n "${PROGRESS_BLOCK_LINES:-}" && "${PROGRESS_BLOCK_LINES:-0}" -gt 0 ]]; then
    printf '\033[%sA' "$PROGRESS_BLOCK_LINES"
    local i
    for ((i = 0; i < PROGRESS_BLOCK_LINES; i++)); do
      printf '\033[2K\033[1B'
    done
    printf '\033[%sA' "$PROGRESS_BLOCK_LINES"
    PROGRESS_BLOCK_LINES=0
  fi
}

get_mode_progress_start_ts() {
  local mode="$1"
  if [[ "$mode" == "strict" ]]; then
    if [[ -z "${STRICT_PROGRESS_START_TS:-}" ]]; then
      STRICT_PROGRESS_START_TS="$(date +%s)"
    fi
    echo "$STRICT_PROGRESS_START_TS"
    return
  fi

  if [[ -z "${ZB_PROGRESS_START_TS:-}" ]]; then
    ZB_PROGRESS_START_TS="$(date +%s)"
  fi
  echo "$ZB_PROGRESS_START_TS"
}

batch_output_complete() {
  local output="$1"
  local mode="$2"
  local offset="$3"
  local limit="$4"
  node -e "const fs=require('fs'); const file=process.argv[1]; const mode=process.argv[2]; const offset=Number(process.argv[3]); const limit=Number(process.argv[4]); try { const p=JSON.parse(fs.readFileSync(file,'utf8')); const modes=Array.isArray(p?.parameters?.modes) ? p.parameters.modes.map(m=>String(m).trim().toLowerCase()) : []; const sampleCount=Number(p?.sampleCount||0); const paramOffset=Number(p?.parameters?.offset||-1); const paramLimit=Number(p?.parameters?.limit||-1); const runs=p?.runsByMode?.[mode]; const ok=sampleCount===limit && paramOffset===offset && paramLimit===limit && modes.includes(mode) && runs && typeof runs==='object' && Object.keys(runs).length>0; console.log(ok ? '1' : '0'); } catch (_) { console.log('0'); }" "$output" "$mode" "$offset" "$limit"
}

watch_progress() {
  local mode="$1"
  local log="$2"
  local pid="$3"
  local total="$4"
  local offset="$5"
  local start_ts
  start_ts="$(get_mode_progress_start_ts "$mode")"
  while kill -0 "$pid" 2>/dev/null; do
    local ts sample current now_ts elapsed pct eta rem rate eta_sec
    ts="$(date '+%H:%M:%S')"
    sample="$(latest_sample "$log")"
    current=$((offset + sample))
    if [[ "$current" -gt "$total" ]]; then current="$total"; fi
    now_ts="$(date +%s)"
    elapsed="$((now_ts - start_ts))"
    if [[ "$elapsed" -lt 1 ]]; then
      elapsed=1
    fi
    pct="0.0"
    eta="--"
    if [[ -n "$total" && "$total" -gt 0 ]]; then
      pct="$(awk -v s="$current" -v t="$total" 'BEGIN{ if(t<=0){print "0.0"} else {printf "%.1f", (s*100)/t} }')"
      if [[ "$current" -gt 0 ]]; then
        rate="$(awk -v s="$current" -v e="$elapsed" 'BEGIN{ if(e<=0){print 0} else {printf "%.6f", s/e} }')"
        rem="$((total - current))"
        if [[ "$rem" -lt 0 ]]; then rem=0; fi
        eta_sec="$(awk -v r="$rem" -v rt="$rate" 'BEGIN{ if(rt<=0){print 0} else {printf "%d", r/rt} }')"
        eta="$(date -u -d "@$eta_sec" '+%H:%M:%S' 2>/dev/null || echo "${eta_sec}s")"
      fi
    fi
    if [[ -t 1 ]]; then
      render_progress_block "$mode" "$ts" "$current" "$total" "$pct" "$eta"
    else
      echo "[$ts] $mode overall: ${current}/${total} (${pct}%) ETA ${eta}"
    fi
    sleep "$PROGRESS_INTERVAL"
  done
  if [[ -t 1 ]]; then
    clear_progress_block
  fi
}

run_mode_once() {
  local mode="$1"
  local output="$2"
  local log="$3"
  local timeout_flag="$4"
  local timeout_ms="$5"
  local offset="$6"
  local limit="$7"

  stdbuf -oL -eL node "$ROOT_DIR/tools/benchmark-f2l-style-ab.mjs" \
    --input "$INPUT" \
    --style-profile-input "$STYLE_PROFILE_INPUT" \
    --output "$output" \
    --offset "$offset" \
    --limit "$limit" \
    --per-solver-limit "$PER_SOLVER_LIMIT" \
    --scramble-concurrency "$SCRAMBLE_CONCURRENCY" \
    --max-workers "$MAX_BENCH_WORKERS" \
    --"$timeout_flag" "$timeout_ms" \
    --mode "$mode" \
    --methods "$METHODS" \
    --styles "$STYLES" \
    > "$log" 2>&1
}

run_mode_with_retry() {
  local mode="$1"
  local output="$2"
  local log="$3"
  local timeout_flag="$4"
  local timeout_ms="$5"
  local offset="$6"
  local limit="$7"
  local total="$8"
  local attempt=1
  local status=0
  local base_concurrency="$SCRAMBLE_CONCURRENCY"

  while [[ "$attempt" -le "$BENCH_RETRIES" ]]; do
    echo "[$mode] attempt ${attempt}/${BENCH_RETRIES} offset=${offset} limit=${limit}"
    : > "$log"
    run_mode_once "$mode" "$output" "$log" "$timeout_flag" "$timeout_ms" "$offset" "$limit" &
    local pid=$!

    if [[ "$PROGRESS" -eq 1 ]]; then
      watch_progress "$mode" "$log" "$pid" "$total" "$offset" &
      local watcher_pid=$!
    fi

    wait "$pid" || status=$?

    if [[ "${watcher_pid:-}" != "" ]]; then
      kill "$watcher_pid" 2>/dev/null || true
      wait "$watcher_pid" 2>/dev/null || true
      watcher_pid=""
    fi

    sed -u "s/^/[$mode] /" "$log"

    if [[ "$status" -eq 0 ]]; then
      SCRAMBLE_CONCURRENCY="$base_concurrency"
      return 0
    fi

    echo "[$mode] failed with status=$status"
    if [[ "$attempt" -eq "$BENCH_RETRIES" ]]; then
      SCRAMBLE_CONCURRENCY="$base_concurrency"
      return "$status"
    fi
    if [[ "$SCRAMBLE_CONCURRENCY" -gt 1 ]]; then
      SCRAMBLE_CONCURRENCY="$((SCRAMBLE_CONCURRENCY - 1))"
      echo "[$mode] lowering scramble concurrency to $SCRAMBLE_CONCURRENCY and retrying"
    else
      echo "[$mode] retrying with same settings"
    fi
    attempt="$((attempt + 1))"
    status=0
  done

  SCRAMBLE_CONCURRENCY="$base_concurrency"
  return 1
}

join_by_comma() {
  local IFS=,
  echo "$*"
}

echo "[1/3] batched benchmark start"
echo "  input: $INPUT"
echo "  style profile input: $STYLE_PROFILE_INPUT"
echo "  batch size: $BATCH_SIZE"
echo "  strict batch dir: $STRICT_BATCH_DIR"
echo "  zb batch dir: $ZB_BATCH_DIR"
echo "  batch resume: $BATCH_RESUME"
echo "  batch force: $BATCH_FORCE"
echo "  cpu count: $CPU_COUNT"
echo "  style count: $STYLE_COUNT"
echo "  parallel: $BENCH_PARALLEL"
echo "  scramble concurrency: $SCRAMBLE_CONCURRENCY"
echo "  worker cap: $MAX_BENCH_WORKERS"
echo "  retries: $BENCH_RETRIES"

TOTAL="$(total_scrambles || echo 0)"
if [[ -z "$TOTAL" || "$TOTAL" -lt 1 ]]; then
  echo "No benchmarkable scrambles found." >&2
  exit 1
fi

batch_size="$BATCH_SIZE"
if [[ "$batch_size" -lt 1 ]]; then batch_size=100; fi
start_offset="$BATCH_START_OFFSET"
if [[ "$start_offset" -lt 0 ]]; then start_offset=0; fi
start_batch_index=$((start_offset / batch_size))
batch_count=$(((TOTAL + batch_size - 1) / batch_size))

echo "  total scrambles: $TOTAL"
echo "  total batches: $batch_count"
if [[ "$PROGRESS" -eq 1 ]]; then
  echo "  progress enabled"
fi

if [[ "$BATCH_RESUME" -ne 1 ]]; then
  echo "  clearing previous batch outputs for a full rerun"
  rm -f "$STRICT_BATCH_DIR"/strict-*.json "$STRICT_BATCH_DIR"/strict-*.log
  rm -f "$ZB_BATCH_DIR"/zb-*.json "$ZB_BATCH_DIR"/zb-*.log
  rm -f "$STRICT_LOG" "$ZB_LOG"
fi

STRICT_STATUS=0
ZB_STATUS=0

for ((batch_index = start_batch_index; batch_index < batch_count; batch_index++)); do
  offset=$((batch_index * batch_size))
  remaining=$((TOTAL - offset))
  if [[ "$remaining" -le 0 ]]; then break; fi
  limit="$batch_size"
  if [[ "$remaining" -lt "$limit" ]]; then limit="$remaining"; fi

  batch_num=$((batch_index + 1))
  batch_tag="$(printf '%04d-%04d' "$offset" "$((offset + limit - 1))")"
  strict_output="$STRICT_BATCH_DIR/strict-${batch_tag}.json"
  strict_log="$STRICT_BATCH_DIR/strict-${batch_tag}.log"
  zb_output="$ZB_BATCH_DIR/zb-${batch_tag}.json"
  zb_log="$ZB_BATCH_DIR/zb-${batch_tag}.log"

  echo ""
  echo "[batch ${batch_num}/${batch_count}] offset=${offset} limit=${limit}"

  strict_needed=1
  zb_needed=1
  if [[ "$BATCH_FORCE" -eq 1 ]]; then
    echo "  strict force rerun enabled, ignoring existing output"
  elif [[ "$BATCH_RESUME" -eq 1 && -f "$strict_output" && "$(batch_output_complete "$strict_output" strict "$offset" "$limit")" == "1" ]]; then
    echo "  strict batch exists, skipping"
    strict_needed=0
  fi
  if [[ "$BATCH_FORCE" -eq 1 ]]; then
    echo "  zb force rerun enabled, ignoring existing output"
  elif [[ "$BATCH_RESUME" -eq 1 && -f "$zb_output" && "$(batch_output_complete "$zb_output" zb "$offset" "$limit")" == "1" ]]; then
    echo "  zb batch exists, skipping"
    zb_needed=0
  fi

  if [[ "$BENCH_PARALLEL" -eq 1 ]]; then
    strict_pid=""
    zb_pid=""
    if [[ "$strict_needed" -eq 1 ]]; then
      run_mode_with_retry strict "$strict_output" "$strict_log" strict-timeout-ms "$STRICT_TIMEOUT_MS" "$offset" "$limit" "$limit" &
      strict_pid=$!
    fi
    if [[ "$zb_needed" -eq 1 ]]; then
      run_mode_with_retry zb "$zb_output" "$zb_log" zb-timeout-ms "$ZB_TIMEOUT_MS" "$offset" "$limit" "$limit" &
      zb_pid=$!
    fi
    if [[ -n "$strict_pid" ]]; then wait "$strict_pid" || STRICT_STATUS=$?; fi
    if [[ -n "$zb_pid" ]]; then wait "$zb_pid" || ZB_STATUS=$?; fi
  else
    if [[ "$strict_needed" -eq 1 ]]; then
      run_mode_with_retry strict "$strict_output" "$strict_log" strict-timeout-ms "$STRICT_TIMEOUT_MS" "$offset" "$limit" "$limit" || STRICT_STATUS=$?
    fi
    if [[ "$zb_needed" -eq 1 ]]; then
      run_mode_with_retry zb "$zb_output" "$zb_log" zb-timeout-ms "$ZB_TIMEOUT_MS" "$offset" "$limit" "$limit" || ZB_STATUS=$?
    fi
  fi

  if [[ "$STRICT_STATUS" -ne 0 || "$ZB_STATUS" -ne 0 ]]; then
    echo "Batch failed: strict=$STRICT_STATUS zb=$ZB_STATUS" >&2
    exit 1
  fi
done

strict_batch_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && strict_batch_files+=("$file")
done < <(find "$STRICT_BATCH_DIR" -maxdepth 1 -type f -name 'strict-*.json' | sort)

zb_batch_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && zb_batch_files+=("$file")
done < <(find "$ZB_BATCH_DIR" -maxdepth 1 -type f -name 'zb-*.json' | sort)

if [[ "${#strict_batch_files[@]}" -eq 0 || "${#zb_batch_files[@]}" -eq 0 ]]; then
  echo "No batch outputs found to merge." >&2
  exit 1
fi

echo ""
echo "[2/3] merge strict/zb batches"
node "$ROOT_DIR/tools/merge-reco-style-benchmark-batches.cjs" \
  --mode strict \
  --inputs "$(join_by_comma "${strict_batch_files[@]}")" \
  --output "$OUTPUT_STRICT"

node "$ROOT_DIR/tools/merge-reco-style-benchmark-batches.cjs" \
  --mode zb \
  --inputs "$(join_by_comma "${zb_batch_files[@]}")" \
  --output "$OUTPUT_ZB"

echo "[3/3] merge final"
node "$ROOT_DIR/tools/merge-reco-style-benchmark.cjs" \
  --inputs "$OUTPUT_STRICT,$OUTPUT_ZB" \
  --output "$OUTPUT_MERGED"

echo "Done."
echo "  strict: $OUTPUT_STRICT"
echo "  zb: $OUTPUT_ZB"
echo "  merged: $OUTPUT_MERGED"
echo "  strict batches: $STRICT_BATCH_DIR"
echo "  zb batches: $ZB_BATCH_DIR"
