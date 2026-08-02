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
    maxPremoveSets: 80,
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    verifyLimit: 16,
    enableInsertions: true,
  },
);
const elapsedMs = performance.now() - startedAt;

assert.equal(result?.ok, true, `Extreme failed under short budget: ${result?.reason || "unknown"}`);
assert.equal(result.qualityMode, "extreme");
assert.notEqual(result.qualityDowngraded, true);
assert.ok(Number.isFinite(result.moveCount));
assert.equal(result.qualityTargetReached, result.moveCount <= 20);

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
  ok: result.ok,
  moveCount: result.moveCount,
  qualityTargetReached: result.qualityTargetReached,
  elapsedMs,
  stages: wasmStages.map((stage) => stage.name),
}));
