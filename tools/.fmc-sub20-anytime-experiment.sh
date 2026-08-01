#!/usr/bin/env bash
set -euo pipefail

BRANCH="agent/fmc-extreme-independent-frontier-v2"
WORKFLOW=".github/workflows/cfop-speedup-benchmark.yml"
SOURCE="solver-wasm/src/fmc_search.rs"

node tools/.fmc-sub20-anytime-dev.mjs | tee /tmp/fmc-sub20-before.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/fmc-sub20-general-before.json \
  | tee /tmp/fmc-sub20-general-before.log

python3 - <<'PY'
from pathlib import Path
p = Path("solver-wasm/src/fmc_search.rs")
s = p.read_text()

old_constants = '''const FMC_EXTREME_RETRY_TARGET: usize = 20;
const FMC_EXTREME_RETRY_VARIANT_OFFSET: u32 = 148;
'''
new_constants = '''const FMC_EXTREME_RETRY_TARGET: usize = 20;
const FMC_EXTREME_RETRY_VARIANT_OFFSET: u32 = 148;
/// Once a 20-move result is reached, spend one additional independent frontier
/// on the stricter sub-20 objective. This is skipped for 19 moves or better.
const FMC_EXTREME_SUB20_TARGET: usize = 19;
const FMC_EXTREME_SUB20_VARIANT_OFFSET: u32 = 111;
'''
if old_constants not in s:
    raise SystemExit("SUB20_CONSTANT_MARKER_NOT_FOUND")
s = s.replace(old_constants, new_constants, 1)

old_block = '''    if primary.ok {
        let primary_best = fmc_result_best_move_count(&primary);
        if search_level >= 3 && primary_best > FMC_EXTREME_RETRY_TARGET {
            let retry = solve_fmc_with_eo_depth(
                scramble,
                tables,
                fmc_tables,
                max_premove_sets,
                force_rzp,
                enable_multi_insertion,
                enable_htr_skeletons,
                enable_slice_insertion,
                enable_multi_switch_niss,
                enable_deep_multi_switch_niss,
                search_level,
                search_variant.wrapping_add(FMC_EXTREME_RETRY_VARIANT_OFFSET),
                incumbent_move_count,
                requested_eo_depth,
            );
            if retry.ok && fmc_result_best_move_count(&retry) < primary_best {
                return retry;
            }
        }
        return primary;
    }
'''
new_block = '''    if primary.ok {
        let mut best_result = primary;
        let mut best_count = fmc_result_best_move_count(&best_result);

        if search_level >= 3 && best_count > FMC_EXTREME_RETRY_TARGET {
            let retry = solve_fmc_with_eo_depth(
                scramble,
                tables,
                fmc_tables,
                max_premove_sets,
                force_rzp,
                enable_multi_insertion,
                enable_htr_skeletons,
                enable_slice_insertion,
                enable_multi_switch_niss,
                enable_deep_multi_switch_niss,
                search_level,
                search_variant.wrapping_add(FMC_EXTREME_RETRY_VARIANT_OFFSET),
                incumbent_move_count,
                requested_eo_depth,
            );
            let retry_count = fmc_result_best_move_count(&retry);
            if retry.ok && retry_count < best_count {
                best_result = retry;
                best_count = retry_count;
            }
        }

        if search_level >= 3 && best_count > FMC_EXTREME_SUB20_TARGET {
            let sub20_retry = solve_fmc_with_eo_depth(
                scramble,
                tables,
                fmc_tables,
                max_premove_sets,
                force_rzp,
                enable_multi_insertion,
                enable_htr_skeletons,
                enable_slice_insertion,
                enable_multi_switch_niss,
                enable_deep_multi_switch_niss,
                search_level,
                search_variant.wrapping_add(FMC_EXTREME_SUB20_VARIANT_OFFSET),
                incumbent_move_count,
                requested_eo_depth,
            );
            let sub20_count = fmc_result_best_move_count(&sub20_retry);
            if sub20_retry.ok && sub20_count < best_count {
                best_result = sub20_retry;
            }
        }

        return best_result;
    }
'''
if old_block not in s:
    raise SystemExit("SUB20_SOLVE_BLOCK_NOT_FOUND")
s = s.replace(old_block, new_block, 1)
p.write_text(s)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
(
  cd solver-wasm
  wasm-pack build --target web --out-dir ../public/solver-wasm
)
git checkout HEAD -- public/solver-wasm/.gitignore 2>/dev/null || true

node tools/.fmc-sub20-anytime-dev.mjs | tee /tmp/fmc-sub20-after.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/fmc-sub20-general-before.json \
    --out /tmp/fmc-sub20-general-after.json \
  | tee /tmp/fmc-sub20-general-after.log

node --input-type=module <<'NODE'
import fs from "node:fs";
function parse(path) {
  const line = fs.readFileSync(path, "utf8").split(/\r?\n/).find((value) => value.startsWith("FMC_SUB20_ANYTIME_SUMMARY "));
  if (!line) throw new Error(`SUB20_OUTPUT_MISSING:${path}`);
  return JSON.parse(line.slice("FMC_SUB20_ANYTIME_SUMMARY ".length));
}
const before = parse("/tmp/fmc-sub20-before.log");
const after = parse("/tmp/fmc-sub20-after.log");
const general = JSON.parse(fs.readFileSync("/tmp/fmc-sub20-general-after.json", "utf8"));
const beforeById = Object.fromEntries(before.rows.map((row) => [row.id, row]));
const afterById = Object.fromEntries(after.rows.map((row) => [row.id, row]));
for (const [id, expected] of [
  ["sebastiano-tronto-wr16-2019", 16],
  ["brian-johnson-wr-mean-a1-17-2026", 17],
  ["wong-chong-wen-wr-mean-a1-18-2026", 18],
]) {
  if (afterById[id]?.found !== expected) throw new Error(`DEVELOPMENT_REGRESSION:${id}:${afterById[id]?.found}`);
}
if (afterById["random-example-1"]?.found > 20) {
  throw new Error(`EXAMPLE1_REGRESSION:${afterById["random-example-1"]?.found}`);
}
if (afterById["random-example-2"]?.found > 19) {
  throw new Error(`SUB20_TARGET_NOT_REACHED:${afterById["random-example-2"]?.found}`);
}
if (!general.gate?.structural || !general.gate?.qualityNonRegression || !general.gate?.solvedNonRegression) {
  throw new Error(`GENERALIZATION_QUALITY_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
const fixedRatio = general.comparison?.fixedHoldout?.averageMsRatio ?? Infinity;
const compressionRatio = general.comparison?.compressionHoldout?.averageMsRatio ?? Infinity;
if (fixedRatio > 2.8 || compressionRatio > 2.0) {
  throw new Error(`SUB20_RUNTIME_GATE_FAILED:${fixedRatio}:${compressionRatio}`);
}
console.log(`FMC_SUB20_ANYTIME_ACCEPTED ${JSON.stringify({
  examples: ["random-example-1", "random-example-2"].map((id) => ({ id, before: beforeById[id], after: afterById[id] })),
  comparison: general.comparison,
})}`);
NODE

git fetch origin main
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
rm -f tools/.fmc-sub20-anytime-dev.mjs tools/.fmc-sub20-anytime-experiment.sh tools/.fmc-sub20-probe.mjs
git checkout origin/main -- "$WORKFLOW"
git add "$SOURCE" public/solver-wasm/solver_wasm_bg.wasm "$WORKFLOW" \
  tools/.fmc-sub20-anytime-dev.mjs tools/.fmc-sub20-anytime-experiment.sh tools/.fmc-sub20-probe.mjs
git commit -m "Continue FMC Extreme below 20 moves"
git push origin HEAD:"$BRANCH"
