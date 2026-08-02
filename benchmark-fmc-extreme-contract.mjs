import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";
import { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "./solver/fmcExtremeProfile.js";

const scramble = "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2";
const siteOptions = buildFmcExtremeOptions({ targetMoveCount: 20 });

assert.equal(FMC_EXTREME_PROFILE.id, "independent-frontier-v2-compression-first-unlimited");
assert.equal(siteOptions.timeBudgetMs, 0);
assert.equal(siteOptions.extremeVariantCount, 24);
assert.equal(siteOptions.maxPremoveSets, 180);
assert.equal(siteOptions.extremeReservedCompressionPremoves, 24);
assert.equal(siteOptions.continueBelowTarget, false);
assert.equal(siteOptions.enableCoverageFallback, false);
assert.equal(siteOptions.allowCfopFallback, false);
assert.equal(siteOptions.premoveAllowCfopFallback, false);

assert.equal(await buildFmcTablesWasm(), true);
const startedAt = performance.now();
const result = await solveWithFMCSearch(scramble, null, siteOptions);
const elapsedMs = performance.now() - startedAt;
const diagnostics = result?.performanceDiagnostics || {};
const stages = diagnostics.wasmStages || [];

assert.equal(result?.extremeProfileId || diagnostics.extremeProfileId, FMC_EXTREME_PROFILE.id);
assert.equal(diagnostics.internalBudgetUnlimited, true);
assert.equal(diagnostics.totalBudgetMs, null);
assert.ok(stages.length >= 1, "compression-first Extreme executed no frontier");
assert.equal(stages[0]?.name, "human-L3-V7-reserved");
assert.equal(stages[0]?.maxPremoveSets, 24);
assert.equal(stages[0]?.multiInsertion, true);
assert.equal(stages[0]?.htr, true);
assert.equal(stages[0]?.sliceInsertion, true);
assert.equal(stages.some((stage) => /baseline|sweet/i.test(stage.name)), false);
assert.equal(result?.qualityDowngraded, false);
if (result?.ok) {
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20);
  assert.equal(stages.length, 1, "target reached but Extreme continued into expansion stages");
} else {
  assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
  assert.ok(Number(result?.bestCandidate?.moveCount) > 20);
}

console.log(JSON.stringify({
  profile: FMC_EXTREME_PROFILE.id,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? result?.bestCandidate?.moveCount ?? null,
  stages: stages.map((stage) => ({ name: stage.name, maxPremoveSets: stage.maxPremoveSets, moveCount: stage.moveCount })),
}));
