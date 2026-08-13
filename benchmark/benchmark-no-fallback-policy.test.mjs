import assert from "node:assert/strict";
import {
  enforceBenchmarkNoFallback,
  invertBenchmarkScramble,
} from "./benchmark-no-fallback-policy.js";
import { FMC_EXTREME_PROFILE } from "../solver/fmcExtremeProfile.js";

const sequenceOfLength = (length) => Array.from({ length }, (_, index) => (
  ["R", "U", "F", "L", "D", "B"][index % 6]
)).join(" ");

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

// MinMove: unproven best-effort results are allowed, 18 is the target,
// 19-20 are acceptable, and 21+ is never accepted.
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    targetReached: true,
    solution: sequenceOfLength(18),
    moveCount: 18,
  },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    targetReached: false,
    solution: sequenceOfLength(19),
    moveCount: 19,
  },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    targetReached: false,
    solution: sequenceOfLength(20),
    moveCount: 20,
  },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    targetReached: false,
    solution: sequenceOfLength(21),
    moveCount: 21,
  },
}).reason, "MINMOVE_OVER_20_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    targetReached: true,
    solution: sequenceOfLength(19),
    moveCount: 19,
  },
}).reason, "MINMOVE_TARGET_FLAG_MISMATCH");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_BEST_EFFORT",
    proofSource: "best_effort_twophase",
    optimalityProven: false,
    approximate: true,
    solution: "F U2 R'",
    moveCount: 3,
  },
}).reason, "MINMOVE_TRIVIAL_INVERSE_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "minmove" },
  scramble: "R U2 F'",
  result: {
    ok: true,
    source: "MINMOVE_333_WASM",
    proofSource: "exact_search",
    optimalityProven: true,
    targetReached: true,
    solution: "R U R'",
    moveCount: 3,
  },
}).ok, true);

assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_EXTREME_HYBRID", solution: "R", qualityMode: "sweetSpot", qualityTargetReached: true, moveCount: 20 },
}).reason, "FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: {
    ok: true,
    source: "FMC_EXTREME_HYBRID",
    candidateSource: "FMC_WASM",
    solution: "R U R'",
    qualityMode: "extreme",
    extremeProfileId: FMC_EXTREME_PROFILE.id,
    qualityTargetReached: false,
    qualityDowngraded: false,
    moveCount: 22,
  },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: {
    ok: true,
    source: "FMC_EXTREME_HYBRID",
    candidateSource: "FMC_WASM",
    solution: "R U R'",
    qualityMode: "extreme",
    extremeProfileId: FMC_EXTREME_PROFILE.id,
    qualityTargetReached: true,
    qualityDowngraded: false,
    moveCount: 20,
  },
}).ok, true);
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: {
    ok: true,
    source: "FMC_EXTREME_HYBRID",
    candidateSource: "FMC_WASM",
    solution: "R U R'",
    qualityMode: "extreme",
    extremeProfileId: FMC_EXTREME_PROFILE.id,
    qualityTargetReached: true,
    qualityDowngraded: false,
    moveCount: 21,
  },
}).reason, "FMC_EXTREME_TARGET_FLAG_MISMATCH");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_EXTREME_HYBRID", solution: "R", qualityMode: "extreme", extremeProfileId: "wrong-profile", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },
}).reason, "FMC_EXTREME_PROFILE_MISMATCH");

console.log("benchmark no-fallback policy verified");
