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
assert.deepEqual(plan.map((stage) => stage.id), [
  "adaptive-human",
  "full-human-portfolio",
  "independent-frontier",
]);
assert.deepEqual(plan.map((stage) => stage.qualityMode), ["sweetSpot", "custom", "extreme"]);
assert.deepEqual(plan.map((stage) => stage.timeBudgetMs), [20000, 40000, 60000]);

const targetMiss = normalizeFmcHybridCandidate({
  ok: false,
  reason: "FMC_EXTREME_TARGET_NOT_REACHED",
  bestHumanSolution: "R U R'",
  bestHumanMoveCount: 22,
  bestHumanSource: "FMC_WASM",
  bestHumanStages: [{ name: "FMC Best", solution: "R U R'" }],
}, "independent-frontier");
assert.equal(targetMiss?.moveCount, 22);
assert.equal(targetMiss?.hybridStageId, "independent-frontier");

const twenty = normalizeFmcHybridCandidate({
  ok: true,
  solution: "R U R' U'",
  moveCount: 20,
  source: "FMC_WASM",
  stages: [{ name: "FMC Best", solution: "R U R' U'" }],
}, "adaptive-human");
const nineteen = normalizeFmcHybridCandidate({
  ok: true,
  solution: "R U2 R'",
  moveCount: 19,
  source: "FMC_WASM",
  stages: [{ name: "FMC Best", solution: "R U2 R'" }],
}, "full-human-portfolio");
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
  plan: plan.map((stage) => ({ id: stage.id, mode: stage.qualityMode, budgetMs: stage.timeBudgetMs })),
}));
