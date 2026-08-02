import assert from "node:assert/strict";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
const progressEvents = [];

const result = await solveWithFMCSearch(
  scramble,
  (progress) => progressEvents.push(progress),
  {
    qualityMode: "extreme",
    timeBudgetMs: 8000,
    targetMoveCount: 20,
    maxPremoveSets: 80,
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    verifyLimit: 16,
    enableInsertions: true,
    requireTargetReached: true,
  },
);

assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
assert.notEqual(result?.qualityDowngraded, true);
if (result?.ok) {
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20, `Extreme returned ${result.moveCount} moves as success`);
} else if (Number.isFinite(result?.moveCount) && result.moveCount > 20) {
  assert.equal(result.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
}

const wasmStages = result?.performanceDiagnostics?.wasmStages || [];
assert.ok(wasmStages.length > 0, "Extreme did not execute its quality ladder");
for (const stage of wasmStages) {
  assert.match(String(stage?.name || ""), /^extreme-/);
}
assert.equal(
  progressEvents.some((event) => event?.type === "fallback_start" && String(event?.stageName || "").startsWith("FMC extreme-")),
  false,
);
assert.ok(progressEvents.some((event) => event?.type === "quality_stage_start"));

console.log(JSON.stringify({
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? null,
  stages: wasmStages.map((stage) => stage.name),
}));
