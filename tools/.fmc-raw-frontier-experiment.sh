#!/usr/bin/env bash
set -euo pipefail

BRANCH="agent/fmc-extreme-independent-frontier-v2"
WORKFLOW=".github/workflows/cfop-speedup-benchmark.yml"
SOURCE="solver-wasm/src/fmc_search.rs"

node tools/.fmc-raw-frontier-dev.mjs | tee /tmp/raw-frontier-before.log
FMC_GENERALIZATION_FIXED_COUNT=4 FMC_GENERALIZATION_COMPRESSION_COUNT=1 \
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
    "    // Completed-solution pruning is separate from the raw skeleton frontier.\n"
    "    // Multi-switch can tighten this completed ceiling, but must never shrink\n"
    "    // the 28/31/34-move budget reserved for selected skeleton exploration.\n"
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

phase3_marker = "    // --- Phase 3: Premove sweep ---\n"
if phase3_marker not in s:
    raise SystemExit("PHASE3_MARKER_NOT_FOUND")
s = s.replace(
    phase3_marker,
    "    completed_best = all_candidates\n"
    "        .iter()\n"
    "        .map(|candidate| candidate.moves.len())\n"
    "        .min()\n"
    "        .unwrap_or(completed_best);\n\n"
    + phase3_marker,
    1,
)

pm_marker = "        let conjugated_premoves = &premove.axis_moves;\n"
if pm_marker not in s:
    raise SystemExit("PREMOVE_MARKER_NOT_FOUND")
s = s.replace(
    pm_marker,
    pm_marker
    + "        // One diverse premove set keeps the independent raw frontier alive.\n"
    + "        // All remaining premove sets use the completed-solution ceiling,\n"
    + "        // avoiding the 144-way depth-34 explosion observed in the full fix.\n"
    + "        let use_raw_premove_frontier = search_level >= 3 && pm_idx == 0;\n",
    1,
)

phase3_start = s.index(phase3_marker)
phase3_end = s.index("    let multi_switch_niss_candidate_count", phase3_start)
phase3 = s[phase3_start:phase3_end]
call_marker = "                let results = solve_fmc_single_axis(\n"
if phase3.count(call_marker) != 2:
    raise SystemExit(f"PHASE3_SOLVE_CALL_COUNT_MISMATCH:{phase3.count(call_marker)}")
phase3 = phase3.replace(
    call_marker,
    "                let mut premove_search_limit = if use_raw_premove_frontier {\n"
    "                    raw_exploration_limit\n"
    "                } else {\n"
    "                    completed_best\n"
    "                };\n"
    + call_marker,
)
if phase3.count("&mut raw_exploration_limit") != 2:
    raise SystemExit(
        f"PHASE3_RAW_LIMIT_CALL_COUNT_MISMATCH:{phase3.count('&mut raw_exploration_limit')}"
    )
phase3 = phase3.replace("&mut raw_exploration_limit", "&mut premove_search_limit")
s = s[:phase3_start] + phase3 + s[phase3_end:]

# Structural guards.
phase2_start = s.index("    // --- Phase 2b: stage-boundary multi-switch NISS ---")
phase2_end = s.index("    // --- Phase 2c", phase2_start)
phase2 = s[phase2_start:phase2_end]
if "&mut raw_exploration_limit" in phase2:
    raise SystemExit("RAW_FRONTIER_STILL_MUTABLE_IN_MULTI_SWITCH")
if phase2.count("&mut completed_best") != 2:
    raise SystemExit("COMPLETED_BEST_CALL_COUNT_MISMATCH")
phase3_start = s.index(phase3_marker)
phase3_end = s.index("    let multi_switch_niss_candidate_count", phase3_start)
phase3 = s[phase3_start:phase3_end]
if phase3.count("&mut premove_search_limit") != 2:
    raise SystemExit("SELECTIVE_PREMOVE_LIMIT_COUNT_MISMATCH")
if "pm_idx == 0" not in phase3:
    raise SystemExit("SELECTIVE_PREMOVE_FRONTIER_MISSING")

p.write_text(s)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
(
  cd solver-wasm
  wasm-pack build --target web --out-dir ../public/solver-wasm
)
git checkout HEAD -- public/solver-wasm/.gitignore 2>/dev/null || true

node tools/.fmc-raw-frontier-dev.mjs | tee /tmp/raw-frontier-after.log
FMC_GENERALIZATION_FIXED_COUNT=4 FMC_GENERALIZATION_COMPRESSION_COUNT=1 \
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
  if (a.elapsedMs > 60000 || a.elapsedMs > b.elapsedMs * 2.25) {
    throw new Error(`RANDOM_EXAMPLE_RUNTIME_REGRESSION:${id}:${b.elapsedMs}->${a.elapsedMs}`);
  }
}
if (!general.gate?.passed) {
  throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
console.log(`SELECTIVE_RAW_FRONTIER_ACCEPTED ${JSON.stringify({
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
git commit -m "Keep selective FMC raw frontier after multi-switch"
git push origin HEAD:"$BRANCH"
