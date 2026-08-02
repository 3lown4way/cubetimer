import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
assert.equal(await buildFmcTablesWasm(), true);

const startedAt = performance.now();
const result = await solveWithFMCSearch(scramble, null, {
  qualityMode: "extreme",
  // This remains the outer worker/run limit. It must not become a WASM budget.
  timeBudgetMs: 500,
  targetMoveCount: 1,
  maxPremoveSets: 12,
  enableCoverageFallback: false,
  requireTargetReached: true,
  verifyLimit: 32,
});
const elapsedMs = performance.now() - startedAt;

assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
assert.notEqual(result?.qualityDowngraded, true);
const stages = result?.performanceDiagnostics?.wasmStages || [];
assert.equal(stages.length, 1, `Extreme must use one unbounded pass: ${stages.map((stage) => stage.name)}`);
const stage = stages[0];
assert.equal(stage.name, "extreme-target-unbounded");
assert.equal(stage.internalBudgetUnlimited, true);
assert.equal(stage.budgetMs, null);
assert.equal(stage.timedOut, false);
assert.ok(stage.processedAxisCalls > 0);
assert.equal(stage.processedPremoveSets, 12, JSON.stringify(stage));
assert.equal(result?.ok, false);
assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");

console.log(JSON.stringify({
  elapsedMs,
  result: result?.reason || result?.moveCount,
  stage,
}));
