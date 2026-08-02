import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
assert.equal(await buildFmcTablesWasm(), true);

async function run(timeBudgetMs) {
  const startedAt = performance.now();
  const result = await solveWithFMCSearch(scramble, null, {
    qualityMode: "extreme",
    timeBudgetMs,
    targetMoveCount: 20,
    maxPremoveSets: 180,
    enableCoverageFallback: false,
    requireTargetReached: true,
    verifyLimit: 32,
  });
  return { result, elapsedMs: performance.now() - startedAt };
}

const shortRun = await run(500);
const longRun = await run(2200);

for (const run of [shortRun, longRun]) {
  const { result, elapsedMs } = run;
  assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
  assert.notEqual(result?.qualityDowngraded, true);
  const stages = result?.performanceDiagnostics?.wasmStages || [];
  assert.equal(stages.length, 1, `Extreme must use one deadline-driven pass: ${stages.map((stage) => stage.name)}`);
  assert.equal(stages[0].name, "extreme-target-deadline");
  assert.ok(stages[0].budgetMs > 0);
  assert.ok(stages[0].processedAxisCalls > 0);
  assert.ok(elapsedMs < stages[0].budgetMs + 1200, `deadline overrun: elapsed=${elapsedMs} budget=${stages[0].budgetMs}`);
  if (result?.ok) {
    assert.equal(result.qualityTargetReached, true);
    assert.ok(result.moveCount <= 20);
  } else {
    assert.ok(["FMC_EXTREME_TARGET_NOT_REACHED", "FMC_NO_VALID_SOLUTION", "FMC_WASM_NOT_READY"].includes(result?.reason));
  }
}

const shortStage = shortRun.result.performanceDiagnostics.wasmStages[0];
const longStage = longRun.result.performanceDiagnostics.wasmStages[0];
assert.ok(longStage.budgetMs > shortStage.budgetMs);
const moreWork =
  longStage.processedAxisCalls > shortStage.processedAxisCalls ||
  longStage.processedPremoveSets > shortStage.processedPremoveSets ||
  longRun.result?.qualityTargetReached === true;
assert.ok(moreWork, JSON.stringify({ shortStage, longStage }));

console.log(JSON.stringify({
  short: {
    elapsedMs: shortRun.elapsedMs,
    result: shortRun.result?.reason || shortRun.result?.moveCount,
    stage: shortStage,
  },
  long: {
    elapsedMs: longRun.elapsedMs,
    result: longRun.result?.reason || longRun.result?.moveCount,
    stage: longStage,
  },
}));
