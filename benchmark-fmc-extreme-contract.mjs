import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
const progressEvents = [];
assert.equal(await buildFmcTablesWasm(), true);

const startedAt = performance.now();
const result = await solveWithFMCSearch(
  scramble,
  (progress) => progressEvents.push(progress),
  {
    qualityMode: "extreme",
    timeBudgetMs: 900,
    targetMoveCount: 20,
    maxPremoveSets: 120,
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    verifyLimit: 24,
    enableInsertions: true,
    requireTargetReached: true,
  },
);
const elapsedMs = performance.now() - startedAt;

assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
assert.notEqual(result?.qualityDowngraded, true);
const wasmStages = result?.performanceDiagnostics?.wasmStages || [];
assert.ok(wasmStages.length >= 2, `Extreme stopped after the first incumbent: ${wasmStages.map((stage) => stage.name).join(",")}`);
assert.equal(wasmStages[0]?.name, "extreme-wide-seed");
assert.equal(wasmStages[1]?.name, "extreme-deep-eo-dr");
assert.ok(Number.isFinite(wasmStages[0]?.moveCount));

if (result?.ok) {
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20, `Extreme returned ${result.moveCount} moves as success`);
} else {
  assert.equal(result.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
  assert.ok(Number.isFinite(result?.bestCandidate?.moveCount));
  assert.ok(result.bestCandidate.moveCount > 20);
}
assert.ok(elapsedMs < 1400, `900 ms Extreme budget overran excessively to ${elapsedMs.toFixed(1)} ms`);
assert.equal(
  progressEvents.some((event) => event?.type === "fallback_start" && String(event?.stageName || "").startsWith("FMC extreme-")),
  false,
);

console.log(JSON.stringify({
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? result?.bestCandidate?.moveCount ?? null,
  qualityTargetReached: result?.qualityTargetReached === true,
  elapsedMs,
  stages: wasmStages.map((stage) => ({ name: stage.name, moveCount: stage.moveCount })),
}));
