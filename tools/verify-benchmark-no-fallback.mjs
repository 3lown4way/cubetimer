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
  'stage("extreme-deep-eo-dr"',
  'stage("extreme-htr-insertion"',
  'stage("extreme-full-human-portfolio"',
  'FMC_EXTREME_TARGET_NOT_REACHED',
  'const requireTargetReached = options.requireTargetReached === true || qualityMode === "extreme"',
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC Extreme contract missing: ${token}`);
}
const extremeStart = fmcSolver.indexOf('if (qualityMode === "extreme")');
const sweetSpotStart = fmcSolver.indexOf('stage("baseline"', extremeStart);
const extremeBlock = fmcSolver.slice(extremeStart, sweetSpotStart);
if (extremeBlock.includes('stage("baseline"') || extremeBlock.includes('stage("eo-multi-switch"')) {
  throw new Error("Extreme still enters the Sweet Spot quality ladder");
}
for (const token of [
  'requireTargetReached: qualityMode === "extreme"',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker guard missing: ${token}`);
}
console.log("FMC Extreme no-downgrade contract verified");
