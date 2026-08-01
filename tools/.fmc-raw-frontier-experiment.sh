#!/usr/bin/env bash
set -euo pipefail

BRANCH="agent/fmc-extreme-independent-frontier-v2"
WORKFLOW=".github/workflows/cfop-speedup-benchmark.yml"
SOURCE="solver-wasm/src/fmc_search.rs"

node tools/.fmc-raw-frontier-dev.mjs | tee /tmp/raw-frontier-before.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/raw-frontier-general-before.json \
  | tee /tmp/raw-frontier-general-before.log

python3 - <<'PY'
from pathlib import Path
p = Path("solver-wasm/src/fmc_search.rs")
s = p.read_text()

phase_marker = "    // --- Phase 2b: stage-boundary multi-switch NISS ---\n    if enable_multi_switch_niss || enable_deep_multi_switch_niss {\n"
if phase_marker not in s:
    raise SystemExit("PHASE2B_MARKER_NOT_FOUND")

replacement = (
    "    // Completed-solution pruning is independent from the raw skeleton frontier.\n"
    "    // Multi-switch may improve this local ceiling, but must never shrink the\n"
    "    // 28/31/34-move Extreme exploration budget used by later phases.\n"
    "    let mut completed_best = all_candidates\n"
    "        .iter()\n"
    "        .map(|candidate| candidate.moves.len())\n"
    "        .min()\n"
    "        .unwrap_or(raw_exploration_limit);\n\n"
    + phase_marker
)
s = s.replace(phase_marker, replacement, 1)

old = "                &mut p2_cache,\n                &mut raw_exploration_limit,\n                force_rzp,\n"
count = s.count(old)
if count != 2:
    raise SystemExit(f"MULTI_SWITCH_CALL_COUNT_MISMATCH:{count}")
s = s.replace(
    old,
    "                &mut p2_cache,\n                &mut completed_best,\n                force_rzp,\n",
)

# Structural guard: the mutable raw frontier may still be passed to the normal
# EO→DR→P2 pipeline, which intentionally does not tighten it, but never to the
# multi-switch routine that updates its ceiling.
phase_start = s.index("    // --- Phase 2b: stage-boundary multi-switch NISS ---")
phase_end = s.index("    // --- Phase 2c", phase_start)
phase_text = s[phase_start:phase_end]
if "&mut raw_exploration_limit" in phase_text:
    raise SystemExit("RAW_FRONTIER_STILL_MUTABLE_IN_MULTI_SWITCH")
if phase_text.count("&mut completed_best") != 2:
    raise SystemExit("COMPLETED_BEST_CALL_COUNT_MISMATCH")

p.write_text(s)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
(
  cd solver-wasm
  wasm-pack build --target web --out-dir ../public/solver-wasm
)
git checkout HEAD -- public/solver-wasm/.gitignore 2>/dev/null || true

node tools/.fmc-raw-frontier-dev.mjs | tee /tmp/raw-frontier-after.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/raw-frontier-general-before.json \
    --out /tmp/raw-frontier-general-after.json \
  | tee /tmp/raw-frontier-general-after.log

node --input-type=module <<'NODE'
import fs from "node:fs";
function parse(path) {
  const line = fs.readFileSync(path, "utf8").split(/\r?\n/).find((value) => value.startsWith("RAW_FRONTIER_DEV "));
  if (!line) throw new Error(`RAW_FRONTIER_OUTPUT_MISSING:${path}`);
  return JSON.parse(line.slice("RAW_FRONTIER_DEV ".length));
}
const before = parse("/tmp/raw-frontier-before.log");
const after = parse("/tmp/raw-frontier-after.log");
const general = JSON.parse(fs.readFileSync("/tmp/raw-frontier-general-after.json", "utf8"));
const beforeById = Object.fromEntries(before.rows.map((row) => [row.id, row]));
const afterById = Object.fromEntries(after.rows.map((row) => [row.id, row]));
for (const [id, expected] of [
  ["sebastiano-tronto-wr16-2019", 16],
  ["brian-johnson-wr-mean-a1-17-2026", 17],
  ["wong-chong-wen-wr-mean-a1-18-2026", 18],
]) {
  if (afterById[id]?.found !== expected) {
    throw new Error(`DEVELOPMENT_REGRESSION:${id}:${afterById[id]?.found}`);
  }
}
for (const id of ["random-example-1", "random-example-2"]) {
  const b = beforeById[id];
  const a = afterById[id];
  if (!a || !b || a.found > b.found) {
    throw new Error(`RANDOM_EXAMPLE_REGRESSION:${id}:${b?.found}->${a?.found}`);
  }
}
if (!general.gate?.passed) {
  throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
console.log(`RAW_FRONTIER_ACCEPTED ${JSON.stringify({
  examples: ["random-example-1", "random-example-2"].map((id) => ({
    id,
    before: beforeById[id],
    after: afterById[id],
  })),
  development: after.rows.filter((row) => row.known !== null),
  comparison: general.comparison,
})}`);
NODE

git fetch origin main
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
rm -f tools/.fmc-raw-frontier-experiment.sh tools/.fmc-raw-frontier-dev.mjs
git checkout origin/main -- "$WORKFLOW"
git add "$SOURCE" public/solver-wasm/solver_wasm_bg.wasm "$WORKFLOW" \
  tools/.fmc-raw-frontier-experiment.sh tools/.fmc-raw-frontier-dev.mjs
git commit -m "Keep FMC raw frontier independent after multi-switch"
git push origin HEAD:"$BRANCH"
