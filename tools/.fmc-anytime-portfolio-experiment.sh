#!/usr/bin/env bash
set -euo pipefail

BRANCH="agent/fmc-extreme-independent-frontier-v2"
WORKFLOW=".github/workflows/cfop-speedup-benchmark.yml"
SOURCE="solver-wasm/src/fmc_search.rs"

node tools/.fmc-anytime-portfolio-dev.mjs | tee /tmp/fmc-portfolio-before.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/fmc-portfolio-general-before.json \
  | tee /tmp/fmc-portfolio-general-before.log

python3 - <<'PY'
from pathlib import Path
p = Path("solver-wasm/src/fmc_search.rs")
s = p.read_text()

constant_marker = "const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;\n"
constant_insert = (
    constant_marker
    + "\n/// L3 Extreme retries one independent EO/premove frontier only when the\n"
      "/// primary portfolio still exceeds the human sub-20 target.\n"
      "const FMC_EXTREME_RETRY_TARGET: usize = 20;\n"
      "const FMC_EXTREME_RETRY_VARIANT_OFFSET: u32 = 148;\n"
)
if constant_marker not in s:
    raise SystemExit("PORTFOLIO_CONSTANT_MARKER_NOT_FOUND")
s = s.replace(constant_marker, constant_insert, 1)

fn_marker = "/// Run the normal depth-5 human FMC profile first. Only when it produces no\n"
helper = (
    "fn fmc_result_best_move_count(result: &FmcResult) -> usize {\n"
    "    result\n"
    "        .candidates\n"
    "        .iter()\n"
    "        .map(|candidate| candidate.moves.len())\n"
    "        .min()\n"
    "        .unwrap_or(usize::MAX)\n"
    "}\n\n"
)
if fn_marker not in s:
    raise SystemExit("PORTFOLIO_FN_MARKER_NOT_FOUND")
s = s.replace(fn_marker, helper + fn_marker, 1)

old = '''    if primary.ok {
        return primary;
    }

    let mut fallback = solve_fmc_with_eo_depth(
'''
new = '''    if primary.ok {
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

    let mut fallback = solve_fmc_with_eo_depth(
'''
if old not in s:
    raise SystemExit("PORTFOLIO_PRIMARY_MARKER_NOT_FOUND")
s = s.replace(old, new, 1)

p.write_text(s)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
(
  cd solver-wasm
  wasm-pack build --target web --out-dir ../public/solver-wasm
)
git checkout HEAD -- public/solver-wasm/.gitignore 2>/dev/null || true

node tools/.fmc-anytime-portfolio-dev.mjs | tee /tmp/fmc-portfolio-after.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/fmc-portfolio-general-before.json \
    --out /tmp/fmc-portfolio-general-after.json \
  | tee /tmp/fmc-portfolio-general-after.log

node --input-type=module <<'NODE'
import fs from "node:fs";
function parse(path) {
  const line = fs.readFileSync(path, "utf8").split(/\r?\n/).find((value) => value.startsWith("FMC_PORTFOLIO_SUMMARY "));
  if (!line) throw new Error(`PORTFOLIO_OUTPUT_MISSING:${path}`);
  return JSON.parse(line.slice("FMC_PORTFOLIO_SUMMARY ".length));
}
const before = parse("/tmp/fmc-portfolio-before.log");
const after = parse("/tmp/fmc-portfolio-after.log");
const general = JSON.parse(fs.readFileSync("/tmp/fmc-portfolio-general-after.json", "utf8"));
const beforeById = Object.fromEntries(before.rows.map((row) => [row.id, row]));
const afterById = Object.fromEntries(after.rows.map((row) => [row.id, row]));
for (const [id, expected] of [
  ["sebastiano-tronto-wr16-2019", 16],
  ["brian-johnson-wr-mean-a1-17-2026", 17],
  ["wong-chong-wen-wr-mean-a1-18-2026", 18],
]) {
  if (afterById[id]?.found !== expected) throw new Error(`DEVELOPMENT_REGRESSION:${id}:${afterById[id]?.found}`);
}
for (const id of ["random-example-1", "random-example-2"]) {
  const b = beforeById[id];
  const a = afterById[id];
  if (!a || !b || a.found > 20 || a.found >= b.found) {
    throw new Error(`PORTFOLIO_TARGET_NOT_REACHED:${id}:${b?.found}->${a?.found}`);
  }
}
if (!general.gate?.structural || !general.gate?.qualityNonRegression || !general.gate?.solvedNonRegression) {
  throw new Error(`GENERALIZATION_QUALITY_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
const fixedRatio = general.comparison?.fixedHoldout?.averageMsRatio ?? Infinity;
const compressionRatio = general.comparison?.compressionHoldout?.averageMsRatio ?? Infinity;
if (fixedRatio > 2.2 || compressionRatio > 2.2) {
  throw new Error(`PORTFOLIO_RUNTIME_GATE_FAILED:${fixedRatio}:${compressionRatio}`);
}
console.log(`FMC_PORTFOLIO_ACCEPTED ${JSON.stringify({
  examples: ["random-example-1", "random-example-2"].map((id) => ({ id, before: beforeById[id], after: afterById[id] })),
  development: after.rows.filter((row) => row.known !== null),
  comparison: general.comparison,
})}`);
NODE

git fetch origin main
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
rm -f tools/.fmc-anytime-portfolio-dev.mjs tools/.fmc-anytime-portfolio-experiment.sh tools/.fmc-variant-probe.mjs
git checkout origin/main -- "$WORKFLOW"
git add "$SOURCE" public/solver-wasm/solver_wasm_bg.wasm "$WORKFLOW" \
  tools/.fmc-anytime-portfolio-dev.mjs tools/.fmc-anytime-portfolio-experiment.sh tools/.fmc-variant-probe.mjs
git commit -m "Retry one independent FMC Extreme frontier above 20 moves"
git push origin HEAD:"$BRANCH"
