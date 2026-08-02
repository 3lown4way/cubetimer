import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");

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
for (const stage of ["FB", "SB", "CMLL", "LSE"]) {
  if (!roux.includes(`reason: \`${stage}_`)) throw new Error(`Roux ${stage} direct failure missing`);
}
console.log("benchmark no-fallback routing verified");

for (const token of [
  'stage("extreme-wide-seed"',
  'maxPremoveSets: capPremoves(32)',
  '}, 100)',
  '}, 750)',
  '}, 2200)',
  '}, 1100)',
  'Math.max(100, Math.floor(options.timeBudgetMs))',
  'remainingBeforeStage < minRemainingMs',
  'stage("extreme-deep-eo-dr"',
  'stage("extreme-htr-insertion"',
  'stage("extreme-full-human-portfolio"',
  'const requireTargetReached = options.requireTargetReached === true;',
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC Extreme anytime contract missing: ${token}`);
}
const extremeStart = fmcSolver.indexOf('if (qualityMode === "extreme")');
const sweetSpotStart = fmcSolver.indexOf('stage("baseline"', extremeStart);
const extremeBlock = fmcSolver.slice(extremeStart, sweetSpotStart);
if (extremeBlock.includes('stage("baseline"') || extremeBlock.includes('stage("eo-multi-switch"')) {
  throw new Error("Extreme still enters the Sweet Spot quality ladder");
}
for (const source of [fmcSolver, fmcWorker]) {
  if (source.includes("FMC_EXTREME_TARGET_NOT_REACHED")) {
    throw new Error("Extreme target miss is still treated as solver failure");
  }
}
for (const token of [
  'buildFmcTablesWasm',
  'Math.max(100, Math.floor(Number(payload.fmcTimeBudgetMs)))',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker anytime guard missing: ${token}`);
}
if (fmcWorker.includes('requireTargetReached: qualityMode === "extreme"')) {
  throw new Error("FMC worker still hard-requires the Extreme target");
}
for (const source of [enhanced, legacy]) {
  if (!source.includes('config.timeoutMs - 100')) {
    throw new Error("short FMC timeout budget is not reserved correctly");
  }
}
console.log("FMC Extreme anytime timeout contract verified");
