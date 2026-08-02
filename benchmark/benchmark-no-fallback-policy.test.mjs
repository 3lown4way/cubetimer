import assert from "node:assert/strict";
import {
  enforceBenchmarkNoFallback,
  invertBenchmarkScramble,
} from "./benchmark-no-fallback-policy.js";

assert.equal(invertBenchmarkScramble("R U2 F'"), "F U2 R'");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "strict" },
  result: { ok: true, source: "INTERNAL_3X3_CFOP", solution: "R" },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "strict" },
  result: { ok: true, source: "WASM_3X3", solution: "R" },
}).reason, "BENCHMARK_METHOD_SOURCE_MISMATCH");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "roux" },
  result: { ok: true, source: "INTERNAL_3X3_PHASE_FALLBACK", solution: "R" },
}).reason, "BENCHMARK_FALLBACK_FORBIDDEN");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "twophase" },
  scramble: "R U2 F'",
  result: { ok: true, source: "WASM_3X3_TWOPHASE", solution: "F U2 R'" },
}).reason, "TWOPHASE_TRIVIAL_INVERSE_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "twophase" },
  scramble: "R U2 F'",
  result: { ok: true, source: "INTERNAL_3X3_TWOPHASE", solution: "R U R'" },
}).reason, "BENCHMARK_METHOD_SOURCE_MISMATCH");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  result: { ok: true, source: "MINMOVE_333_WASM", optimalityProven: false },
}).reason, "MINMOVE_UNPROVEN_RESULT_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  result: { ok: true, source: "MINMOVE_333_WASM", proofSource: "exact_search", optimalityProven: true },
}).ok, true);

assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "sweetSpot", qualityTargetReached: true, moveCount: 20 },
}).reason, "FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", extremeProfileId: "independent-frontier-v3-anytime-widening", qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 },
}).reason, "FMC_EXTREME_TARGET_NOT_REACHED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", extremeProfileId: "independent-frontier-v3-anytime-widening", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },
}).ok, true);

assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", extremeProfileId: "wrong-profile", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },
}).reason, "FMC_EXTREME_PROFILE_MISMATCH");

console.log("benchmark no-fallback policy verified");
