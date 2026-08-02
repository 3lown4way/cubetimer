from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing target in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


# Extreme is target-driven: >target is an incumbent, never a successful final result.
fmc_path = Path("solver/fmcSolver.js")
fmc = fmc_path.read_text()
replace_old = '''  // The target is diagnostic. Extreme stays on its own search ladder, but an
  // above-target Extreme candidate remains a valid anytime result.
  const requireTargetReached = options.requireTargetReached === true;
'''
replace_new = '''  // Extreme is target-driven. Above-target candidates remain incumbents and
  // search continues; they are diagnostic only if the deadline expires.
  const requireTargetReached = options.requireTargetReached === true || qualityMode === "extreme";
'''
if replace_old not in fmc:
    raise SystemExit("Extreme requireTargetReached block missing")
fmc = fmc.replace(replace_old, replace_new, 1)

old_stages = '''  if (qualityMode === "extreme") {
    return [
      stage("extreme-wide-seed", {
        maxPremoveSets: capPremoves(32),
        enableMultiSwitchNiss: true,
      }, 100),
      stage("extreme-deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 750),
      stage("extreme-htr-insertion", {
        maxPremoveSets: capPremoves(160),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 2200),
      stage("extreme-full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 1100),
    ];
  }
'''
new_stages = '''  if (qualityMode === "extreme") {
    return [
      stage("extreme-wide-seed", {
        maxPremoveSets: capPremoves(32),
        enableMultiSwitchNiss: true,
      }, 100),
      // A 21–22 move incumbent must not terminate Extreme. Continue into the
      // deeper EO/DR portfolio whenever a short-budget run still has time.
      stage("extreme-deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 250),
      // Compact HTR/insertion pass gives sub-second runs a distinct improvement
      // attempt instead of returning immediately after the first 22-move seed.
      stage("extreme-compact-htr", {
        maxPremoveSets: capPremoves(24),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 180),
      stage("extreme-full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 500),
      stage("extreme-htr-insertion", {
        maxPremoveSets: capPremoves(160),
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }, 1200),
    ];
  }
'''
if old_stages not in fmc:
    raise SystemExit("Extreme stage ladder missing")
fmc = fmc.replace(old_stages, new_stages, 1)

# Restore hard target-miss result after all affordable Extreme stages have run.
anchor = '''  const best = rankedCandidates[0];
  diagnostics.selectedCandidate = {
'''
block = '''  const best = rankedCandidates[0];
  if (requireTargetReached && best.moveCount > targetMoveCount) {
    diagnostics.selectedCandidate = {
      source: best?.source || null,
      innerSource: best?.innerSource || null,
      moveCount: Number.isFinite(best?.moveCount) ? best.moveCount : null,
      usesCfop: best?.usesCfop === true,
      rejectedForTarget: true,
    };
    return {
      ok: false,
      reason: qualityMode === "extreme"
        ? "FMC_EXTREME_TARGET_NOT_REACHED"
        : "FMC_QUALITY_TARGET_NOT_REACHED",
      moveCount: best.moveCount,
      bestCandidate: {
        solution: best.solution,
        moveCount: best.moveCount,
        source: best.source,
      },
      qualityMode,
      qualityTarget: targetMoveCount,
      qualityTargetReached: false,
      qualityDowngraded: false,
      attempts,
      performanceDiagnostics: finalizeDiagnostics(),
    };
  }
  diagnostics.selectedCandidate = {
'''
if anchor not in fmc:
    raise SystemExit("best candidate anchor missing")
fmc = fmc.replace(anchor, block, 1)
fmc_path.write_text(fmc)

# Worker must never promote an above-target Extreme incumbent to success.
worker_path = Path("benchmark/fmcBenchmarkWorker.js")
worker = worker_path.read_text()
worker = worker.replace(
    '''      enableCoverageFallback: false,
      crossColors: normalizeCrossColorList(payload.crossColor),
''',
    '''      enableCoverageFallback: false,
      requireTargetReached: qualityMode === "extreme",
      crossColors: normalizeCrossColorList(payload.crossColor),
''',
    1,
)
worker_guard_anchor = '''    if (result?.ok && result.qualityDowngraded === true) {
      return {
        ok: false,
        reason: "FMC_QUALITY_MODE_DOWNGRADE_REJECTED",
        rejectedResult: result,
      };
    }

    return result || { ok: false, reason: "FMC_NO_RESULT" };
'''
worker_guard_new = '''    if (result?.ok && result.qualityDowngraded === true) {
      return {
        ok: false,
        reason: "FMC_QUALITY_MODE_DOWNGRADE_REJECTED",
        rejectedResult: result,
      };
    }
    if (
      qualityMode === "extreme" &&
      result?.ok &&
      (result.qualityTargetReached !== true || Number(result.moveCount) > targetMoveCount)
    ) {
      return {
        ok: false,
        reason: "FMC_EXTREME_TARGET_NOT_REACHED",
        requestedTarget: targetMoveCount,
        rejectedResult: result,
      };
    }

    return result || { ok: false, reason: "FMC_NO_RESULT" };
'''
if worker_guard_anchor not in worker:
    raise SystemExit("worker guard anchor missing")
worker_path.write_text(worker.replace(worker_guard_anchor, worker_guard_new, 1))

# Independent benchmark policy guard.
policy_path = Path("benchmark/benchmark-no-fallback-policy.js")
policy = policy_path.read_text()
policy_anchor = '''    if (!actualQuality || actualQuality !== requestedQuality || result?.qualityDowngraded === true) {
      return reject("FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
    }
'''
policy_new = '''    if (!actualQuality || actualQuality !== requestedQuality || result?.qualityDowngraded === true) {
      return reject("FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
    }
    if (requestedQuality === "extreme") {
      const target = Number.isFinite(Number(config?.fmcTargetMoveCount))
        ? Number(config.fmcTargetMoveCount)
        : 20;
      if (result?.qualityTargetReached !== true || !Number.isFinite(Number(result?.moveCount)) || Number(result.moveCount) > target) {
        return reject("FMC_EXTREME_TARGET_NOT_REACHED");
      }
    }
'''
if policy_anchor not in policy:
    raise SystemExit("policy anchor missing")
policy_path.write_text(policy.replace(policy_anchor, policy_new, 1))

# Policy test: 22 moves is not an Extreme success.
test_path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
tests = test_path.read_text()
old_test = '''assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 },
}).ok, true);
'''
new_test = '''assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: false, qualityDowngraded: false, moveCount: 22 },
}).reason, "FMC_EXTREME_TARGET_NOT_REACHED");
'''
if old_test not in tests:
    raise SystemExit("policy 22-move test missing")
test_path.write_text(tests.replace(old_test, new_test, 1))

# Runtime contract: first 22-move incumbent must trigger additional Extreme work;
# if target remains unmet, it must be returned only as a diagnostic failure.
runtime_path = Path("benchmark-fmc-extreme-contract.mjs")
runtime_path.write_text('''import assert from "node:assert/strict";
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
''')

# Static contract guard.
verify_path = Path("tools/verify-benchmark-no-fallback.mjs")
verify = verify_path.read_text()
start = verify.index("for (const token of [\n  'stage(\"extreme-wide-seed\"'")
verify = verify[:start] + '''for (const token of [
  'stage("extreme-wide-seed"',
  'stage("extreme-deep-eo-dr"',
  'stage("extreme-compact-htr"',
  'stage("extreme-full-human-portfolio"',
  'stage("extreme-htr-insertion"',
  'const requireTargetReached = options.requireTargetReached === true || qualityMode === "extreme"',
  'FMC_EXTREME_TARGET_NOT_REACHED',
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC Extreme target-driven contract missing: ${token}`);
}
const extremeStart = fmcSolver.indexOf('if (qualityMode === "extreme")');
const sweetSpotStart = fmcSolver.indexOf('stage("baseline"', extremeStart);
const extremeBlock = fmcSolver.slice(extremeStart, sweetSpotStart);
if (extremeBlock.includes('stage("baseline"') || extremeBlock.includes('stage("eo-multi-switch"')) {
  throw new Error("Extreme still enters the Sweet Spot quality ladder");
}
for (const token of [
  'requireTargetReached: qualityMode === "extreme"',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker target guard missing: ${token}`);
}
console.log("FMC Extreme target-driven contract verified");
'''
verify_path.write_text(verify)

# Remove patcher from final branch.
Path("tools/apply-fmc-extreme-target-driven.py").unlink()
