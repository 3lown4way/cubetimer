import assert from "node:assert/strict";
import { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "./solver/fmcExtremeProfile.js";
import {
  buildFmcExtremeHybridPlan,
  normalizeFmcHybridCandidate,
  pickBestFmcHybridCandidate,
} from "./solver/fmcExtremeHybrid.js";

const options = buildFmcExtremeOptions();
assert.equal(FMC_EXTREME_PROFILE.id, "hybrid-adaptive-120s-v1");
assert.equal(FMC_EXTREME_PROFILE.defaultTimeBudgetMs, 120000);
assert.equal(FMC_EXTREME_PROFILE.searchTargetMoveCount, 18);
assert.equal(FMC_EXTREME_PROFILE.maxPremoveSets, 180);
assert.equal(FMC_EXTREME_PROFILE.integratedMaxPremoveSets, 96);
assert.equal(FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves, 24);
assert.equal(FMC_EXTREME_PROFILE.integratedReservedCompressionPremoves, 12);
assert.equal(FMC_EXTREME_PROFILE.extremeMaxRounds, 1);
assert.equal(FMC_EXTREME_PROFILE.continueBelowTarget, true);
assert.equal(options.timeBudgetMs, 120000);
assert.equal(options.requireTargetReached, false);
assert.equal(options.extremeMaxRounds, 1);
assert.equal(options.continueBelowTarget, true);
assert.equal(options.allowCfopFallback, false);
assert.equal(options.premoveAllowCfopFallback, false);
assert.equal(options.enableCoverageFallback, false);

const plan = buildFmcExtremeHybridPlan(120000);
assert.deepEqual(plan.map((stage) => stage.id), ["adaptive-seed", "progressive-frontier"]);
assert.deepEqual(plan.map((stage) => stage.qualityMode), ["sweetSpot", "extreme"]);
assert.deepEqual(plan.map((stage) => stage.timeBudgetMs), [20000, 100000]);
assert.equal(plan[0].maxPremoveSets, 40);
assert.equal(plan[1].maxPremoveSets, 96);
assert.equal(plan[1].reservedCompressionPremoves, 12);

const targetMiss = normalizeFmcHybridCandidate({
  ok: false,
  reason: "FMC_EXTREME_TARGET_NOT_REACHED",
  bestHumanSolution: "R U R'",
  bestHumanMoveCount: 22,
  bestHumanSource: "FMC_WASM",
  bestHumanStages: [{ name: "FMC Best", solution: "R U R'" }],
}, "progressive-frontier");
assert.equal(targetMiss?.moveCount, 22);
assert.equal(targetMiss?.hybridStageId, "progressive-frontier");

const twenty = normalizeFmcHybridCandidate({
  ok: true,
  solution: "R U R' U'",
  moveCount: 20,
  source: "FMC_WASM",
  stages: [{ name: "FMC Best", solution: "R U R' U'" }],
}, "adaptive-seed");
const nineteen = normalizeFmcHybridCandidate({
  ok: true,
  solution: "R U2 R'",
  moveCount: 19,
  source: "FMC_WASM",
  stages: [{ name: "FMC Best", solution: "R U2 R'" }],
}, "progressive-frontier");
assert.equal(pickBestFmcHybridCandidate([targetMiss, twenty, nineteen])?.moveCount, 19);
assert.equal(normalizeFmcHybridCandidate({
  ok: true,
  solution: "R",
  moveCount: 18,
  source: "FMC_TWOPHASE_FALLBACK",
}), null);

console.log(JSON.stringify({
  profile: FMC_EXTREME_PROFILE.id,
  totalBudgetMs: FMC_EXTREME_PROFILE.defaultTimeBudgetMs,
  plan: plan.map((stage) => ({
    id: stage.id,
    mode: stage.qualityMode,
    budgetMs: stage.timeBudgetMs,
    maxPremoveSets: stage.maxPremoveSets,
    reservedCompressionPremoves: stage.reservedCompressionPremoves ?? null,
  })),
}));
