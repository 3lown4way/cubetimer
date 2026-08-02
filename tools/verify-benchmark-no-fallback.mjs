import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
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
console.log("benchmark no-fallback routing verified");

for (const token of [
  'stage("extreme-target-unbounded"',
  'const internalBudgetUnlimited = qualityMode === "extreme"',
  'timeBudgetMs: internalBudgetUnlimited ? 0 : stageBudgetMs',
  'internalBudgetUnlimited',
  'targetMoveCount',
  'processedAxisCalls',
  'processedPremoveSets',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC unlimited-Extreme token missing: ${token}`);
}
if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {
  throw new Error("enhanced benchmark outer worker timeout is not propagated");
}
if (
  enhanced.includes('const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000') ||
  enhanced.includes('Math.min(budget, Math.max(100, config.timeoutMs - 100))') ||
  enhanced.includes('if (Number(elements.timeout.value) < 105) elements.timeout.value = "120"')
) {
  throw new Error("Extreme still has an independent fixed timeout");
}
for (const token of ["timeBudgetMs", "targetMoveCount", "maxEoDepth"]) {
  if (!wasmSolver.includes(token) || !rustApi.includes(token)) {
    throw new Error(`WASM option propagation missing: ${token}`);
  }
}
for (const token of [
  "FmcSearchBudget",
  "time_budget_ms == 0",
  "f64::INFINITY",
  "budget.should_stop",
  "processed_premove_sets",
  "timed_out",
]) {
  if (!rustFmc.includes(token)) throw new Error(`Rust unlimited-budget token missing: ${token}`);
}
for (const source of [wasmSolver, rustFmc]) {
  if (source.includes("FMC_TWOPHASE_FALLBACK") || source.includes("eo_fallback_used")) {
    throw new Error("FMC fallback architecture remains");
  }
}
for (const token of [
  'requireTargetReached: qualityMode === "extreme"',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker guard missing: ${token}`);
}
console.log("FMC Extreme unlimited internal budget contract verified");
