from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise SystemExit(f"missing replacement target in {path}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))


# Core FMC quality scheduler: Extreme must never execute the Sweet Spot ladder.
fmc_path = Path("solver/fmcSolver.js")
fmc = fmc_path.read_text()
old_extreme = '''  if (qualityMode === "extreme") {
    return [
      stage("baseline", { maxPremoveSets: capPremoves(40) }),
      stage("eo-multi-switch", {
        maxPremoveSets: capPremoves(80),
        enableMultiSwitchNiss: true,
      }),
      stage("deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableDeepMultiSwitchNiss: true,
      }),
      stage("full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }),
    ];
  }
'''
new_extreme = '''  if (qualityMode === "extreme") {
    return [
      stage("extreme-wide-seed", {
        maxPremoveSets: capPremoves(80),
        enableMultiSwitchNiss: true,
      }),
      stage("extreme-deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }),
      stage("extreme-htr-insertion", {
        maxPremoveSets: capPremoves(160),
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }),
      stage("extreme-full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }),
    ];
  }
'''
if old_extreme not in fmc:
    raise SystemExit("Extreme stage ladder target not found")
fmc = fmc.replace(old_extreme, new_extreme, 1)

old_target = '''  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : qualityPreset.targetMoveCount;
'''
new_target = '''  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : qualityPreset.targetMoveCount;
  // Extreme is a strict quality contract: it may fail, but it may not downgrade
  // to a Sweet Spot-level result above the requested target.
  const requireTargetReached = options.requireTargetReached === true || qualityMode === "extreme";
'''
if old_target not in fmc:
    raise SystemExit("targetMoveCount block not found")
fmc = fmc.replace(old_target, new_target, 1)

old_diag = '''    qualityMode,
    targetMoveCount,
    totalBudgetMs: timeBudgetMs,
'''
new_diag = '''    qualityMode,
    targetMoveCount,
    requireTargetReached,
    qualityDowngraded: false,
    totalBudgetMs: timeBudgetMs,
'''
if old_diag not in fmc:
    raise SystemExit("diagnostics quality block not found")
fmc = fmc.replace(old_diag, new_diag, 1)

fmc = fmc.replace(
    '''  // === WASM FMC quality scheduler ===
  // Start with the cheapest human pipeline. More expensive stages run only while
  // the current incumbent is above the selected quality target.
''',
    '''  // === WASM FMC quality scheduler ===
  // Each mode runs only its own quality ladder. Extreme never enters the
  // Sweet Spot baseline and may fail rather than downgrade quality.
''',
    1,
)
fmc = fmc.replace('type: "fallback_start",\n          stageName: `FMC ${qualityStage.name}`', 'type: "quality_stage_start",\n          stageName: `FMC ${qualityStage.name}`', 1)
fmc = fmc.replace('notify({ type: "fallback_done", stageName: `FMC ${qualityStage.name}` });', 'notify({ type: "quality_stage_done", stageName: `FMC ${qualityStage.name}` });', 1)
fmc = fmc.replace('type: "fallback_start",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 'type: "insertion_start",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 1)
fmc = fmc.replace('type: "fallback_done",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 'type: "insertion_done",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 1)

old_best = '''  const best = rankedCandidates[0];
  diagnostics.selectedCandidate = {
'''
new_best = '''  const best = rankedCandidates[0];
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
if old_best not in fmc:
    raise SystemExit("best candidate block not found")
fmc = fmc.replace(old_best, new_best, 1)

old_success = '''    qualityMode,
    qualityTarget: targetMoveCount,
    qualityTargetReached: best.moveCount <= targetMoveCount,
    attempts,
'''
new_success = '''    qualityMode,
    qualityTarget: targetMoveCount,
    qualityTargetReached: best.moveCount <= targetMoveCount,
    qualityDowngraded: false,
    attempts,
'''
if old_success not in fmc:
    raise SystemExit("success quality block not found")
fmc = fmc.replace(old_success, new_success, 1)
fmc_path.write_text(fmc)

# Dedicated benchmark worker: enforce identity and strict target at the source.
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
old_worker_return = '''    if (result?.source === "FMC_TWOPHASE_FALLBACK") {
      return {
        ok: false,
        reason: "UNEXPECTED_FMC_TWOPHASE_FALLBACK",
        rejectedResult: result,
      };
    }

    return result || { ok: false, reason: "FMC_NO_RESULT" };
'''
new_worker_return = '''    if (result?.source === "FMC_TWOPHASE_FALLBACK") {
      return {
        ok: false,
        reason: "UNEXPECTED_FMC_TWOPHASE_FALLBACK",
        rejectedResult: result,
      };
    }
    if (result?.ok && result.qualityMode !== qualityMode) {
      return {
        ok: false,
        reason: "FMC_QUALITY_MODE_DOWNGRADE_REJECTED",
        requestedQualityMode: qualityMode,
        actualQualityMode: result.qualityMode || "unknown",
        rejectedResult: result,
      };
    }
    if (result?.ok && result.qualityDowngraded === true) {
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
if old_worker_return not in worker:
    raise SystemExit("FMC benchmark worker return block not found")
worker = worker.replace(old_worker_return, new_worker_return, 1)
worker_path.write_text(worker)

# Independent UI policy gate.
policy_path = Path("benchmark/benchmark-no-fallback-policy.js")
policy = policy_path.read_text()
old_policy_tail = '''  if (mode === "minmove" && result?.optimalityProven !== true) {
    return reject("MINMOVE_UNPROVEN_RESULT_REJECTED");
  }
  return { ok: true, reason: "", source: "" };
}
'''
new_policy_tail = '''  if (mode === "minmove" && result?.optimalityProven !== true) {
    return reject("MINMOVE_UNPROVEN_RESULT_REJECTED");
  }
  if (mode === "fmc") {
    const requestedQuality = String(config?.fmcQualityMode || "sweetSpot").trim().toLowerCase();
    const actualQuality = String(result?.qualityMode || "").trim().toLowerCase();
    if (!actualQuality || actualQuality !== requestedQuality || result?.qualityDowngraded === true) {
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
  }
  return { ok: true, reason: "", source: "" };
}
'''
if old_policy_tail not in policy:
    raise SystemExit("benchmark policy tail not found")
policy_path.write_text(policy.replace(old_policy_tail, new_policy_tail, 1))

# Policy tests for mode mismatch and >20 rejection.
test_path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
tests = test_path.read_text()
marker = '\nconsole.log("benchmark no-fallback policy verified");\n'
extra = '''
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "sweetSpot", qualityTargetReached: true, moveCount: 20 },
}).reason, "FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: false, moveCount: 22 },
}).reason, "FMC_EXTREME_TARGET_NOT_REACHED");
assert.equal(enforceBenchmarkNoFallback({
  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },
  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },
}).ok, true);
'''
if marker not in tests:
    raise SystemExit("policy test marker not found")
test_path.write_text(tests.replace(marker, extra + marker, 1))

# Progress text must describe quality stages, not fallback.
for path in [Path("benchmark/benchmark-enhanced.js")]:
    text = path.read_text()
    needle = '''  if (progress.type === "exact_search_start") return `exact search ${progress.lowerBound ?? "?"}→${progress.upperBoundLength ?? "?"}`;
'''
    addition = needle + '''  if (progress.type === "quality_stage_start") return `${name || "FMC Extreme"} 탐색`;
  if (progress.type === "quality_stage_done") return `${name || "FMC Extreme"} 완료`;
  if (progress.type === "insertion_start") return `${name || "FMC Insertion"} 탐색`;
  if (progress.type === "insertion_done") return `${name || "FMC Insertion"} 완료`;
'''
    if needle not in text:
        raise SystemExit(f"progress formatter target missing in {path}")
    path.write_text(text.replace(needle, addition, 1))

# Static regression guard.
verify_path = Path("tools/verify-benchmark-no-fallback.mjs")
verify = verify_path.read_text()
verify = verify.replace(
    '''const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
''',
    '''const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
''',
    1,
)
verify += '''
for (const token of [
  'stage("extreme-wide-seed"',
  'stage("extreme-deep-eo-dr"',
  'stage("extreme-htr-insertion"',
  'stage("extreme-full-human-portfolio"',
  'FMC_EXTREME_TARGET_NOT_REACHED',
  'const requireTargetReached = options.requireTargetReached === true || qualityMode === "extreme"',
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC Extreme contract missing: ${token}`);
}
const extremeBlock = fmcSolver.slice(
  fmcSolver.indexOf('if (qualityMode === "extreme")'),
  fmcSolver.indexOf('\n  return [\n    stage("baseline"', fmcSolver.indexOf('if (qualityMode === "extreme")')),
);
if (extremeBlock.includes('stage("baseline"') || extremeBlock.includes('stage("eo-multi-switch"')) {
  throw new Error("Extreme still enters the Sweet Spot quality ladder");
}
for (const token of [
  'requireTargetReached: qualityMode === "extreme"',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker guard missing: ${token}`);
}
console.log("FMC Extreme no-downgrade contract verified");
'''
verify_path.write_text(verify)

# Remove temporary trigger and this patcher from the final branch commit.
for temporary in [
    Path("tools/.fmc-extreme-no-downgrade-trigger"),
    Path("tools/apply-fmc-extreme-no-downgrade.py"),
]:
    if temporary.exists():
        temporary.unlink()
