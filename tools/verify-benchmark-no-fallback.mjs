import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const minmoveExactV2 = fs.readFileSync(new URL("../solver/minmoveExactV2.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcHybrid = fs.readFileSync(new URL("../solver/fmcExtremeHybrid.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../solver/fmcExtremeProfile.js", import.meta.url), "utf8");
const benchmarkUi = fs.readFileSync(new URL("../benchmark/benchmark-fmc-extreme-120s-ui.js", import.meta.url), "utf8");
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
  "TWOPHASE_STRICT_EXCLUSION_VIOLATION",
  "excludedSolution",
  'import("./minmoveExactV2.js")',
  "!benchmarkNoFallback && mode === \"strict\"",
  "benchmarkNoFallback || mode === \"zb\"",
]) {
  if (!worker.includes(token)) throw new Error(`worker no-fallback token missing: ${token}`);
}
if (worker.includes("TWOPHASE_TRIVIAL_INVERSE_REJECTED")) {
  throw new Error("worker still rejects trivial inverse after search completion");
}
for (const token of [
  'reason: "MINMOVE_NOT_PROVEN"',
  'solution: ""',
  "optimalityProven: false",
  "optimalityProven: true",
  'proofSource: "exact_twophase_exhaustion"',
  "fallbackReason: null",
]) {
  if (!minmoveExactV2.includes(token)) throw new Error(`exact minmove v2 contract token missing: ${token}`);
}
if (minmoveExactV2.includes("MINMOVE_FALLBACK_RESULT_REJECTED")) {
  throw new Error("exact minmove v2 still depends on fallback-success rejection");
}
if ((worker.match(/enableRecovery: !benchmarkNoFallback,/g) || []).length !== 2) {
  throw new Error("Roux benchmark recovery is not disabled on both attempts");
}
if (!roux.includes("const allowCrossMethodRecovery = options.enableRecovery !== false")) {
  throw new Error("Roux v1 does not honor recovery disable flag");
}

for (const token of [
  'id: "hybrid-adaptive-120s-v1"',
  "targetMoveCount: 20",
  "searchTargetMoveCount: 18",
  "defaultTimeBudgetMs: 120000",
  "extremeVariantCount: 24",
  "maxPremoveSets: 180",
  "integratedMaxPremoveSets: 96",
  "extremeReservedCompressionPremoves: 24",
  "integratedReservedCompressionPremoves: 12",
  "extremeMaxRounds: 1",
  "continueBelowTarget: true",
]) {
  if (!profile.includes(token)) throw new Error(`shared Extreme profile token missing: ${token}`);
}
for (const token of [
  'id: "adaptive-seed"',
  'id: "progressive-frontier"',
  "solveWithFmcExtremeHybrid",
  "FMC_EXTREME_HYBRID",
  "searchTargetMoveCount",
  "qualityTargetReached",
  "adaptive-seed-plus-progressive-frontier",
]) {
  if (!fmcHybrid.includes(token)) throw new Error(`hybrid Extreme token missing: ${token}`);
}
for (const token of [
  'stage(`human-L${searchLevel}${roundSuffix}-V${searchVariant}',
  "FMC_EXTREME_PROFILE.extremeVariantCount",
  "FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves",
  "const variantOrder = [reservedCompressionVariant, 0]",
  "extremeMaxRounds",
  'type: "quality_round_start"',
  "FMC_EXTREME_TARGET_NOT_REACHED",
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`independent-frontier token missing: ${token}`);
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
  "solveWithFmcExtremeHybrid",
  "FMC_EXTREME_PROFILE",
  "FMC_EXTREME_PROFILE_MISMATCH",
  "FMC_EXTREME_PROFILE.defaultTimeBudgetMs",
]) {
  if (!fmcWorker.includes(token)) throw new Error(`hybrid benchmark worker token missing: ${token}`);
}
for (const source of [enhanced, legacy]) {
  if (!source.includes("payload.fmcTimeBudgetMs = isUnlimitedExtreme(config)")) {
    throw new Error("Extreme sentinel payload is missing");
  }
  if (!source.includes("const result = unlimitedExtreme")) {
    throw new Error("Extreme worker-owned deadline routing is missing");
  }
  if (!source.includes('progress.type === "quality_round_start"')) {
    throw new Error("Extreme frontier progress is missing");
  }
}
for (const token of [
  "FIXED_EXTREME_SECONDS = 120",
  'warmup.value = "0"',
  "Adaptive seed 20초",
  "Progressive frontier를 100초",
  "목표 미달이어도 현재 최선해를 보존",
]) {
  if (!benchmarkUi.includes(token)) throw new Error(`120-second benchmark UI token missing: ${token}`);
}
if (!fmcSolver.includes("unlimitedTimeBudget")) {
  throw new Error("FMC solver no longer supports explicit unlimited custom searches");
}
console.log("benchmark no-fallback routing, exact minmove v2, and FMC Extreme progressive 120-second contract verified");
