from pathlib import Path

path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
text = path.read_text()
profile = 'extremeProfileId: "independent-frontier-v2-24", '

old_target_miss = 'result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 },'
new_target_miss = f'result: {{ ok: true, source: "FMC_WASM", qualityMode: "extreme", {profile}qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 }},'
if old_target_miss not in text:
    raise SystemExit("target-miss policy fixture missing")
text = text.replace(old_target_miss, new_target_miss, 1)

old_success = 'result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },'
new_success = f'result: {{ ok: true, source: "FMC_WASM", qualityMode: "extreme", {profile}qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 }},'
if old_success in text:
    text = text.replace(old_success, new_success, 1)
elif new_success not in text:
    raise SystemExit("success policy fixture missing")
path.write_text(text)

# Runtime test uses the exact shared site profile, but a short JS deadline so CI
# proves routing without waiting for all 24 expensive variants. Static checks
# independently prove that the shared profile schedules all 24 variants.
Path("benchmark-fmc-extreme-contract.mjs").write_text(r'''import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";
import { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "./solver/fmcExtremeProfile.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
const siteOptions = buildFmcExtremeOptions({ timeBudgetMs: 1000, targetMoveCount: 20 });

assert.equal(FMC_EXTREME_PROFILE.id, "independent-frontier-v2-24");
assert.equal(siteOptions.extremeVariantCount, 24);
assert.equal(siteOptions.maxPremoveSets, 180);
assert.equal(siteOptions.extremeReservedCompressionPremoves, 48);
assert.equal(siteOptions.continueBelowTarget, true);
assert.equal(siteOptions.enableInsertions, true);
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
assert.ok(stages.length >= 1, "site-parity Extreme did not execute a frontier");
assert.equal(stages[0]?.name, "human-L1-V0");
assert.equal(stages.some((stage) => /baseline|sweet/i.test(stage.name)), false);
assert.equal(result?.qualityDowngraded, false);
if (result?.ok) {
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20);
} else {
  assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
  assert.ok(Number(result?.bestCandidate?.moveCount) > 20);
}

console.log(JSON.stringify({
  profile: FMC_EXTREME_PROFILE.id,
  configuredVariantCount: siteOptions.extremeVariantCount,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? result?.bestCandidate?.moveCount ?? null,
  executedVariants: stages.map((stage) => stage.name),
}));
''')

Path("tools/repair-fmc-extreme-site-parity-tests.py").unlink()
