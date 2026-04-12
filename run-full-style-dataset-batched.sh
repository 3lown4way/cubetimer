#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECO_DIR="${RECO_DIR:-$ROOT_DIR/vendor-data/reco}"

INPUT="${INPUT:-$RECO_DIR/reco-all-3x3-gte100-details.json}"
STYLE_PROFILE_INPUT="${STYLE_PROFILE_INPUT:-$RECO_DIR/reco-3x3-style-features.json}"
STYLE_DETAILS_INPUT="${STYLE_DETAILS_INPUT:-$RECO_DIR/reco-3x3-style-details.json}"

STRICT_OUT="${STRICT_OUT:-$RECO_DIR/reco-3x3-style-benchmark-strict.json}"
ZB_OUT="${ZB_OUT:-$RECO_DIR/reco-3x3-style-benchmark-zb.json}"
MERGED_OUT="${MERGED_OUT:-$RECO_DIR/reco-3x3-style-benchmark.json}"
LEARNED_OUT="${LEARNED_OUT:-$RECO_DIR/reco-3x3-learned-style-weights.json}"
MIXED_OUT="${MIXED_OUT:-$RECO_DIR/reco-3x3-mixed-cfop-profile.json}"

STRICT_LOG="${STRICT_LOG:-$RECO_DIR/benchmark-strict.full.log}"
ZB_LOG="${ZB_LOG:-$RECO_DIR/benchmark-zb.full.log}"

BATCH_DIR="${BATCH_DIR:-$RECO_DIR/style-benchmark-batches}"
STRICT_BATCH_DIR="${STRICT_BATCH_DIR:-$BATCH_DIR/strict}"
ZB_BATCH_DIR="${ZB_BATCH_DIR:-$BATCH_DIR/zb}"

METHODS="${METHODS:-CFOP,ZB}"
STYLES="${STYLES:-legacy,balanced,rotationless,low-auf}"
SCRAMBLE_CONCURRENCY="${SCRAMBLE_CONCURRENCY:-1}"
MAX_BENCH_WORKERS="${MAX_BENCH_WORKERS:-2}"
SAFE_MODE="${SAFE_MODE:-0}"
NODE_MAX_OLD_SPACE_MB="${NODE_MAX_OLD_SPACE_MB:-0}"
STRICT_TIMEOUT_MS="${STRICT_TIMEOUT_MS:-3000}"
ZB_TIMEOUT_MS="${ZB_TIMEOUT_MS:-5000}"
LIMIT="${LIMIT:-20000}"
PER_SOLVER_LIMIT="${PER_SOLVER_LIMIT:-0}"
MIN_SAMPLES="${MIN_SAMPLES:-10}"
LEARN_OBJECTIVE="${LEARN_OBJECTIVE:-aggressive}"
MIN_SOLVES="${MIN_SOLVES:-100}"
PROGRESS="${PROGRESS:-0}"
PROGRESS_INTERVAL="${PROGRESS_INTERVAL:-10}"
PROGRESS_LINES="${PROGRESS_LINES:-3}"
BENCH_RETRIES="${BENCH_RETRIES:-2}"
BATCH_SIZE="${BATCH_SIZE:-100}"
BATCH_PARALLEL="${BATCH_PARALLEL:-1}"
BATCH_RESUME="${BATCH_RESUME:-1}"
BATCH_START_OFFSET="${BATCH_START_OFFSET:-0}"
AUTO_SCRAMBLE_CONCURRENCY="${AUTO_SCRAMBLE_CONCURRENCY:-0}"
MAX_SCRAMBLE_CONCURRENCY="${MAX_SCRAMBLE_CONCURRENCY:-4}"

if [[ "$PER_SOLVER_LIMIT" -gt 0 ]]; then
  echo "BATCH_SIZE mode expects PER_SOLVER_LIMIT=0. Use run-full-style-dataset.sh for per-solver sampling." >&2
  exit 1
fi

total_scrambles() {
  node -e "const fs=require('fs'); const p=process.argv[1]; const methodsRaw=process.argv[2]||''; const limit=parseInt(process.argv[3]||'0',10)||0; const data=JSON.parse(fs.readFileSync(p,'utf8')); const records=Array.isArray(data)? data : (data.records||[]); const methods=new Set(methodsRaw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)); const seen=new Set(); let total=0; for (const row of records){ if (!row||!row.ok) continue; const puzzle=String(row?.meta?.puzzle||row?.puzzle||'').trim(); if (puzzle!=='3x3') continue; const sourceMethod=String(row.method||row?.meta?.method||'').trim().toUpperCase(); if (methods.size && !methods.has(sourceMethod)) continue; const scramble=String(row.scramble||'').trim(); if (!scramble) continue; if (seen.has(scramble)) continue; seen.add(scramble); total++; } if (limit>0 && total>limit) total=limit; console.log(total);" "$INPUT" "$METHODS" "$LIMIT"
}

latest_sample() {
  local log="$1"
  local sample
  sample="$(tail -n 200 "$log" | grep -Eo 'sample [0-9]+' | tail -n 1 | awk '{print $2}')"
  if [[ -z "$sample" ]]; then
    echo 0
  else
    echo "$sample"
  fi
}

batch_output_complete() {
  local output="$1"
  local mode="$2"
  local offset="$3"
  local limit="$4"
  node -e "const fs=require('fs'); const file=process.argv[1]; const mode=process.argv[2]; const offset=Number(process.argv[3]); const limit=Number(process.argv[4]); try { const p=JSON.parse(fs.readFileSync(file,'utf8')); const modes=Array.isArray(p?.parameters?.modes) ? p.parameters.modes.map(m=>String(m).trim().toLowerCase()) : []; const sampleCount=Number(p?.sampleCount||0); const paramOffset=Number(p?.parameters?.offset||-1); const paramLimit=Number(p?.parameters?.limit||-1); const runs=p?.runsByMode?.[mode]; const ok=sampleCount===limit && paramOffset===offset && paramLimit===limit && modes.includes(mode) && runs && typeof runs==='object' && Object.keys(runs).length>0; console.log(ok ? '1' : '0'); } catch (_) { console.log('0'); }" "$output" "$mode" "$offset" "$limit"
}

run_mode_once() {
  local mode="$1"
  local output="$2"
  local log="$3"
  local timeout_flag="$4"
  local timeout_ms="$5"
  local offset="$6"
  local limit="$7"

  node "$ROOT_DIR/tools/benchmark-f2l-style-ab.mjs" \
    --input "$INPUT" \
    --style-profile-input "$STYLE_PROFILE_INPUT" \
    --mode "$mode" \
    --methods "$METHODS" \
    --styles "$STYLES" \
    --per-solver-limit "$PER_SOLVER_LIMIT" \
    --offset "$offset" \
    --limit "$limit" \
    --scramble-concurrency "$SCRAMBLE_CONCURRENCY" \
    --max-workers "$MAX_BENCH_WORKERS" \
    --"$timeout_flag" "$timeout_ms" \
    --output "$output" \
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

  while [[ "$attempt" -le "$BENCH_RETRIES" ]]; do
    echo "  [$mode] attempt ${attempt}/${BENCH_RETRIES} offset=${offset} limit=${limit}"
    run_mode_once "$mode" "$output" "$log" "$timeout_flag" "$timeout_ms" "$offset" "$limit" &
    local pid=$!

    if [[ "$PROGRESS" -eq 1 ]]; then
      local start_ts
      start_ts="$(date +%s)"
      while kill -0 "$pid" 2>/dev/null; do
        local ts sample now_ts elapsed pct eta rem rate eta_sec
        ts="$(date '+%H:%M:%S')"
        sample="$(latest_sample "$log")"
        now_ts="$(date +%s)"
        elapsed="$((now_ts - start_ts))"
        if [[ "$elapsed" -lt 1 ]]; then
          elapsed=1
        fi
        pct="0.0"
        eta="--"
        if [[ -n "$total" && "$total" -gt 0 ]]; then
          pct="$(awk -v s="$sample" -v t="$total" 'BEGIN{ if(t<=0){print "0.0"} else {printf "%.1f", (s*100)/t} }')"
          if [[ "$sample" -gt 0 ]]; then
            rate="$(awk -v s="$sample" -v e="$elapsed" 'BEGIN{ if(e<=0){print 0} else {printf "%.6f", s/e} }')"
            rem="$((total - sample))"
            if [[ "$rem" -lt 0 ]]; then
              rem=0
            fi
            eta_sec="$(awk -v r="$rem" -v rt="$rate" 'BEGIN{ if(rt<=0){print 0} else {printf "%d", r/rt} }')"
            eta="$(date -u -d "@$eta_sec" '+%H:%M:%S' 2>/dev/null || date -u -r "$eta_sec" '+%H:%M:%S')"
          fi
        fi
        echo ""
        echo "[$ts] $mode progress: ${sample}/${total} (${pct}%) ETA ${eta}"
        echo "[$ts] $mode tail:"
        tail -n "$PROGRESS_LINES" "$log" || true
        sleep "$PROGRESS_INTERVAL"
      done
    fi

    wait "$pid" || status=$?
    if [[ "$status" -eq 0 ]]; then
      return 0
    fi

    echo "  [$mode] failed with status=$status"
    if [[ "$attempt" -eq "$BENCH_RETRIES" ]]; then
      return "$status"
    fi

    if [[ "$SCRAMBLE_CONCURRENCY" -gt 1 ]]; then
      SCRAMBLE_CONCURRENCY="$((SCRAMBLE_CONCURRENCY - 1))"
      echo "  [$mode] lowering scramble concurrency to $SCRAMBLE_CONCURRENCY and retrying..."
    else
      echo "  [$mode] retrying with same settings..."
    fi
    attempt="$((attempt + 1))"
    status=0
  done

  return 1
}

join_by_comma() {
  local IFS=,
  echo "$*"
}

mkdir -p "$RECO_DIR" "$STRICT_BATCH_DIR" "$ZB_BATCH_DIR"

if [[ "$NODE_MAX_OLD_SPACE_MB" -gt 0 ]]; then
  export NODE_OPTIONS="--max-old-space-size=$NODE_MAX_OLD_SPACE_MB"
fi

if [[ "$SAFE_MODE" -eq 1 ]]; then
  BATCH_PARALLEL=0
  SCRAMBLE_CONCURRENCY=1
  MAX_BENCH_WORKERS=1
fi

if [[ "$AUTO_SCRAMBLE_CONCURRENCY" -eq 1 && -z "${SCRAMBLE_CONCURRENCY_OVERRIDE:-}" ]]; then
  cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
  if [[ -z "$cpu_count" || "$cpu_count" -lt 1 ]]; then
    cpu_count="$(command -v nproc >/dev/null 2>&1 && nproc || echo 2)"
  fi
  styles_count="$(awk -F',' '{print NF}' <<<"$STYLES")"
  if [[ -z "$styles_count" || "$styles_count" -lt 1 ]]; then
    styles_count=1
  fi
  auto_conc="$((cpu_count / styles_count))"
  if [[ "$auto_conc" -lt 1 ]]; then
    auto_conc=1
  fi
  if [[ -n "$MAX_SCRAMBLE_CONCURRENCY" && "$MAX_SCRAMBLE_CONCURRENCY" -gt 0 && "$auto_conc" -gt "$MAX_SCRAMBLE_CONCURRENCY" ]]; then
    auto_conc="$MAX_SCRAMBLE_CONCURRENCY"
  fi
  SCRAMBLE_CONCURRENCY="$auto_conc"
fi

BASE_SCRAMBLE_CONCURRENCY="$SCRAMBLE_CONCURRENCY"

echo "[1/4] batched strict/zb benchmark 시작..."
echo "  input: $INPUT"
echo "  style profile input: $STYLE_PROFILE_INPUT"
echo "  batch size: $BATCH_SIZE"
echo "  batch parallel: $BATCH_PARALLEL"
echo "  strict batch dir: $STRICT_BATCH_DIR"
echo "  zb batch dir: $ZB_BATCH_DIR"
echo "  strict final: $STRICT_OUT"
echo "  zb final: $ZB_OUT"
echo "  scramble concurrency: $SCRAMBLE_CONCURRENCY"
echo "  worker cap: $MAX_BENCH_WORKERS"
if [[ "$NODE_MAX_OLD_SPACE_MB" -gt 0 ]]; then
  echo "  node max old space: ${NODE_MAX_OLD_SPACE_MB} MB"
fi

total="$(total_scrambles || echo 0)"
if [[ -z "$total" || "$total" -lt 1 ]]; then
  echo "No benchmarkable scrambles found."
  exit 1
fi

batch_size="$BATCH_SIZE"
if [[ "$batch_size" -lt 1 ]]; then
  batch_size=100
fi
start_offset="$BATCH_START_OFFSET"
if [[ -z "$start_offset" || "$start_offset" -lt 0 ]]; then
  start_offset=0
fi
start_batch_index=$((start_offset / batch_size))
if [[ -n "$LIMIT" && "$LIMIT" -gt 0 && "$total" -gt "$LIMIT" ]]; then
  total="$LIMIT"
fi
batch_count=$(((total + batch_size - 1) / batch_size))

echo "  total scrambles: $total"
echo "  total batches: $batch_count"
echo "  start offset: $((start_batch_index * batch_size))"
echo ""
echo "진행상황 보기 활성화 (interval=${PROGRESS_INTERVAL}s, lines=${PROGRESS_LINES})"

strict_failed=0
zb_failed=0

for ((batch_index = start_batch_index; batch_index < batch_count; batch_index++)); do
  offset=$((batch_index * batch_size))
  remaining=$((total - offset))
  if [[ "$remaining" -le 0 ]]; then
    break
  fi
  limit="$batch_size"
  if [[ "$remaining" -lt "$limit" ]]; then
    limit="$remaining"
  fi

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
  if [[ "$BATCH_RESUME" -eq 1 && -f "$strict_output" && "$(batch_output_complete "$strict_output" strict "$offset" "$limit")" == "1" ]]; then
    echo "  strict output exists, skipping: $strict_output"
    strict_needed=0
  fi
  if [[ "$BATCH_RESUME" -eq 1 && -f "$zb_output" && "$(batch_output_complete "$zb_output" zb "$offset" "$limit")" == "1" ]]; then
    echo "  zb output exists, skipping: $zb_output"
    zb_needed=0
  fi

  if [[ "$BATCH_PARALLEL" -eq 1 ]]; then
    strict_pid=""
    zb_pid=""
    if [[ "$strict_needed" -eq 1 ]]; then
      SCRAMBLE_CONCURRENCY="$BASE_SCRAMBLE_CONCURRENCY" \
        run_mode_with_retry strict "$strict_output" "$strict_log" strict-timeout-ms "$STRICT_TIMEOUT_MS" "$offset" "$limit" "$limit" &
      strict_pid=$!
    fi
    if [[ "$zb_needed" -eq 1 ]]; then
      SCRAMBLE_CONCURRENCY="$BASE_SCRAMBLE_CONCURRENCY" \
        run_mode_with_retry zb "$zb_output" "$zb_log" zb-timeout-ms "$ZB_TIMEOUT_MS" "$offset" "$limit" "$limit" &
      zb_pid=$!
    fi

    if [[ -n "$strict_pid" ]]; then
      wait "$strict_pid" || strict_failed=$?
    fi
    if [[ -n "$zb_pid" ]]; then
      wait "$zb_pid" || zb_failed=$?
    fi
  else
    if [[ "$strict_needed" -eq 1 ]]; then
      SCRAMBLE_CONCURRENCY="$BASE_SCRAMBLE_CONCURRENCY"
      run_mode_with_retry strict "$strict_output" "$strict_log" strict-timeout-ms "$STRICT_TIMEOUT_MS" "$offset" "$limit" "$limit" || strict_failed=$?
    fi
    if [[ "$zb_needed" -eq 1 ]]; then
      SCRAMBLE_CONCURRENCY="$BASE_SCRAMBLE_CONCURRENCY"
      run_mode_with_retry zb "$zb_output" "$zb_log" zb-timeout-ms "$ZB_TIMEOUT_MS" "$offset" "$limit" "$limit" || zb_failed=$?
    fi
  fi

  if [[ "$strict_failed" -ne 0 || "$zb_failed" -ne 0 ]]; then
    break
  fi
done

if [[ "$strict_failed" -ne 0 || "$zb_failed" -ne 0 ]]; then
  echo "Batched benchmark failed: strict=$strict_failed zb=$zb_failed" >&2
  echo "Check logs:"
  echo "  $STRICT_BATCH_DIR"
  echo "  $ZB_BATCH_DIR"
  exit 1
fi

strict_batch_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && strict_batch_files+=("$file")
done < <(find "$STRICT_BATCH_DIR" -maxdepth 1 -type f -name '*.json' | sort)

zb_batch_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && zb_batch_files+=("$file")
done < <(find "$ZB_BATCH_DIR" -maxdepth 1 -type f -name '*.json' | sort)

if [[ "${#strict_batch_files[@]}" -eq 0 || "${#zb_batch_files[@]}" -eq 0 ]]; then
  echo "No batch outputs found to merge." >&2
  exit 1
fi

echo ""
echo "[2/4] strict batch 병합..."
node "$ROOT_DIR/tools/merge-reco-style-benchmark-batches.cjs" \
  --mode strict \
  --inputs "$(join_by_comma "${strict_batch_files[@]}")" \
  --output "$STRICT_OUT"

echo "[3/4] zb batch 병합..."
node "$ROOT_DIR/tools/merge-reco-style-benchmark-batches.cjs" \
  --mode zb \
  --inputs "$(join_by_comma "${zb_batch_files[@]}")" \
  --output "$ZB_OUT"

echo "[4/4] overall benchmark 병합..."
node "$ROOT_DIR/tools/merge-reco-style-benchmark.cjs" \
  --inputs "$STRICT_OUT,$ZB_OUT" \
  --output "$MERGED_OUT"

echo "[5/6] player style weight 재학습..."
node "$ROOT_DIR/tools/learn-reco-player-style-weights.cjs" \
  --benchmarks "$MERGED_OUT" \
  --players "$STYLE_DETAILS_INPUT" \
  --modes strict,zb \
  --min-samples "$MIN_SAMPLES" \
  --objective "$LEARN_OBJECTIVE" \
  --output "$LEARNED_OUT"

echo "[6/6] mixed cfop profile 재생성..."
node "$ROOT_DIR/tools/build-reco-3x3-top10-mixed-cfop-profile.cjs" \
  --details "$INPUT" \
  --style-details "$STYLE_DETAILS_INPUT" \
  --methods "$METHODS" \
  --min-solves "$MIN_SOLVES" \
  --output "$MIXED_OUT"

echo ""
echo "완료:"
echo "  strict: $STRICT_OUT"
echo "  zb: $ZB_OUT"
echo "  merged: $MERGED_OUT"
echo "  learned: $LEARNED_OUT"
echo "  mixed: $MIXED_OUT"
echo "배치 저장소:"
echo "  $STRICT_BATCH_DIR"
echo "  $ZB_BATCH_DIR"
echo "로그:"
echo "  $STRICT_LOG"
echo "  $ZB_LOG"
