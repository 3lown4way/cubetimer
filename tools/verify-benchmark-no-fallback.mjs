import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../solver/fmcExtremeProfile.js", import.meta.url), "utf8");
const wasmSolver = fs.readFileSync(new URL("../solver/wasmSolver.js", import.meta.url), "utf8");
const rustFmc = fs.readFileSync(new URL("../solver-wasm/src/fmc_search.rs", import.meta.url), "utf8");
const rustApi = fs.readFileSync(new URL("../solver-wasm/src/lib.rs", import.meta.url), "utf8");

for (const source of [enhanced, legacy]) {
  if (!source.includes("benchmarkNoFallback: true")) throw new Error("benchmark no-fallback payload missing");
  if (!source.includes("enableStyleFallback: false")) throw new Error("benchmark style fallback still enabled");
  if (!source.includes("enforceBenchmarkNoFallback")) throw new Error("benchmark result policy missing");
}
for (const token of [
  "TWOPHASE_WASM_FAILED_NO_FALLBACK",
  "TWOPHASE_TRIVIAL_INVERSE_REJECTED",
  "MINMOVE_FALLBACK_RESULT_REJECTED",
  "!benchmarkNoFallback && mode === \"strict\"",
  "benchmarkNoFallback || mode === \"zb\"",
]) {
  if (!worker.includes(token)) throw new Error(`worker no-fallback token missing: ${token}`);
}
if ((worker.match(/enableRecovery: !benchmarkNoFallback,/g) || []).length !== 2) {
  throw new Error("Roux benchmark recovery is not disabled on both attempts");
}
if (!roux.includes("const allowCrossMethodRecovery = options.enableRecovery !== false")) {
  throw new Error("Roux v1 does not honor recovery disable flag");
}

for (const token of [
  'id: "independent-frontier-v2-compression-first-24"',
  "extremeVariantCount: 24",
  "maxPremoveSets: 180",
  "extremeReservedCompressionPremoves: 24",
]) {
  if (!profile.includes(token)) throw new Error(`shared Extreme profile token missing: ${token}`);
}
for (const token of [
  'stage(`human-L${searchLevel}-V${variant}',
  "FMC_EXTREME_PROFILE.extremeVariantCount",
  "FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves",
  "const variantOrder = [reservedCompressionVariant, 0]",
  "FMC_EXTREME_TARGET_NOT_REACHED",
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`independent-frontier-v2 token missing: ${token}`);
}
if (fmcSolver.includes('stage("extreme-target-unbounded"')) {
  throw new Error("site still uses the simplified one-pass Extreme implementation");
}
for (const token of ["searchLevel", "searchVariant", "incumbentMoveCount"]) {
  if (!wasmSolver.includes(token) || !rustApi.includes(token)) {
    throw new Error(`advanced WASM frontier option missing: ${token}`);
  }
}
for (const token of [
  "raw_exploration_limit",
  "search_variant",
  "multi_insertion_transition_count",
  "FMC_EXTREME_SUB20_TARGET",
]) {
  if (!rustFmc.includes(token)) throw new Error(`advanced Rust frontier token missing: ${token}`);
}
for (const source of [fmcSolver, wasmSolver, rustFmc, rustApi]) {
  if (source.includes("FMC_TWOPHASE_FALLBACK") || source.includes("eo_fallback_used")) {
    throw new Error("FMC fallback architecture remains");
  }
}
for (const token of [
  "buildFmcExtremeOptions",
  "FMC_EXTREME_PROFILE",
  "FMC_EXTREME_PROFILE_MISMATCH",
  "FMC_EXTREME_TARGET_NOT_REACHED",
]) {
  if (!fmcWorker.includes(token)) throw new Error(`site-parity worker token missing: ${token}`);
}
if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {
  throw new Error("site per-run timeout is not propagated");
}
console.log("benchmark no-fallback routing and FMC Extreme site parity verified");
