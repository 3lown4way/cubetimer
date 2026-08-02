from pathlib import Path
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


# --- Extreme profile identity ---
profile_path = Path("solver/fmcExtremeProfile.js")
profile = profile_path.read_text()
profile = replace_once(
    profile,
    'id: "independent-frontier-v2-compression-first-unlimited",',
    'id: "independent-frontier-v3-anytime-widening",',
    "Extreme profile id",
)
profile_path.write_text(profile)


# --- FMC scheduler ---
solver_path = Path("solver/fmcSolver.js")
text = solver_path.read_text()
text = replace_once(
    text,
    "function buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp) {",
    "export function buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp) {",
    "export quality-stage planner",
)

old_extreme_block = '''  if (qualityMode === "extreme") {
    const requestedVariants = Number.isFinite(options.extremeVariantCount)
      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))
      : FMC_EXTREME_PROFILE.extremeVariantCount;
    const reservedCompressionVariant = requestedVariants > 7 ? 7 : requestedVariants - 1;
    const reservedCompressionPremoves = Number.isFinite(options.extremeReservedCompressionPremoves)
      ? Math.max(
          12,
          Math.min(requestedPremoveSets, Math.floor(options.extremeReservedCompressionPremoves)),
        )
      : Math.min(requestedPremoveSets, FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves);
    const variantOrder = [reservedCompressionVariant, 0];
    for (let variant = 1; variant < requestedVariants; variant += 1) {
      if (!variantOrder.includes(variant)) variantOrder.push(variant);
    }

    const stages = [];
    for (const variant of variantOrder) {
      const reservedCompression = variant === reservedCompressionVariant;
      // Reproduce the validated compression benchmark first: L3-V7 with
      // 24 premove sets. Only expand to scout and wider variants on target miss.
      const searchLevel = reservedCompression ? 3 : variant < 2 ? 1 : variant < 7 ? 2 : 3;
      const premoveCap = reservedCompression
        ? reservedCompressionPremoves
        : searchLevel === 1
          ? 90
          : searchLevel === 2
            ? 140
            : requestedPremoveSets;
      stages.push(
        stage(`human-L${searchLevel}-V${variant}${reservedCompression ? "-reserved" : ""}`, {
          maxPremoveSets: capPremoves(premoveCap),
          searchLevel,
          searchVariant: variant,
          reservedCompression,
          rawExplorationLimit: searchLevel === 1 ? 28 : searchLevel === 2 ? 31 : 34,
          enableMultiSwitchNiss: true,
          enableDeepMultiSwitchNiss: searchLevel >= 2,
          enableHtrSkeletons: searchLevel >= 2,
          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
          enableDrFlip: searchLevel >= 3,
        }),
      );
    }
    return stages;
  }
'''
new_extreme_block = '''  if (qualityMode === "extreme") {
    const requestedVariants = Number.isFinite(options.extremeVariantCount)
      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))
      : FMC_EXTREME_PROFILE.extremeVariantCount;
    const extremeRound = Number.isFinite(options.extremeRound)
      ? Math.max(0, Math.floor(options.extremeRound))
      : 0;
    const variantStride = Number.isFinite(options.extremeVariantStride)
      ? Math.max(requestedVariants + 1, Math.floor(options.extremeVariantStride))
      : 97;
    const variantBase = extremeRound * variantStride;
    const reservedCompressionVariant = requestedVariants > 7 ? 7 : requestedVariants - 1;
    const reservedCompressionPremoves = Number.isFinite(options.extremeReservedCompressionPremoves)
      ? Math.max(
          12,
          Math.min(requestedPremoveSets, Math.floor(options.extremeReservedCompressionPremoves)),
        )
      : Math.min(requestedPremoveSets, FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves);
    const variantOrder = [reservedCompressionVariant, 0];
    for (let variant = 1; variant < requestedVariants; variant += 1) {
      if (!variantOrder.includes(variant)) variantOrder.push(variant);
    }

    const stages = [];
    for (const variantSlot of variantOrder) {
      const searchVariant = variantBase + variantSlot;
      const reservedCompression = extremeRound === 0 && variantSlot === reservedCompressionVariant;
      // Round 0 preserves the validated compression-first portfolio. Every later
      // round is a genuinely new full-width L3 frontier rather than a replay of
      // the same finite 24 variants.
      const searchLevel = reservedCompression
        ? 3
        : extremeRound > 0
          ? 3
          : variantSlot < 2
            ? 1
            : variantSlot < 7
              ? 2
              : 3;
      const premoveCap = reservedCompression
        ? reservedCompressionPremoves
        : extremeRound > 0
          ? requestedPremoveSets
          : searchLevel === 1
            ? 90
            : searchLevel === 2
              ? 140
              : requestedPremoveSets;
      const roundSuffix = extremeRound > 0 ? `-R${extremeRound}` : "";
      stages.push(
        stage(`human-L${searchLevel}${roundSuffix}-V${searchVariant}${reservedCompression ? "-reserved" : ""}`, {
          maxPremoveSets: capPremoves(premoveCap),
          searchLevel,
          searchVariant,
          extremeRound,
          bucketName: `extreme-slot-${variantSlot}`,
          reservedCompression,
          rawExplorationLimit:
            extremeRound > 0 ? 36 : searchLevel === 1 ? 28 : searchLevel === 2 ? 31 : 34,
          enableMultiSwitchNiss: true,
          enableDeepMultiSwitchNiss: searchLevel >= 2,
          enableHtrSkeletons: searchLevel >= 2,
          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
          enableDrFlip: searchLevel >= 3,
        }),
      );
    }
    return stages;
  }
'''
text = replace_once(text, old_extreme_block, new_extreme_block, "Extreme round planner")

old_target = '''  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : qualityPreset.targetMoveCount;
'''
new_target = old_target + '''  const extremeMaxRounds = Number.isFinite(options.extremeMaxRounds)
    ? Math.max(1, Math.floor(options.extremeMaxRounds))
    : qualityMode === "extreme"
      ? Number.POSITIVE_INFINITY
      : 1;
'''
text = replace_once(text, old_target, new_target, "Extreme round limit")

text = replace_once(
    text,
    '''    internalBudgetUnlimited: unlimitedTimeBudget,
    wasmStages: [],
''',
    '''    internalBudgetUnlimited: unlimitedTimeBudget,
    extremeMaxRounds: Number.isFinite(extremeMaxRounds) ? extremeMaxRounds : null,
    extremeRoundsStarted: 0,
    extremeRoundsCompleted: 0,
    frontierContinued: false,
    wasmStages: [],
''',
    "Extreme round diagnostics",
)

old_track = '''  const trackCandidate = (candidate) => {
    if (!candidate) return;
    pushRankedUniqueCandidate(candidates, candidate);
    if (candidate.moveCount < bestMoveCount) {
      bestMoveCount = candidate.moveCount;
    }
  };
'''
new_track = '''  const trackCandidate = (candidate) => {
    if (!candidate) return;
    pushRankedUniqueCandidate(candidates, candidate, qualityMode === "extreme" ? 384 : Infinity);
    if (candidate.moveCount < bestMoveCount) {
      bestMoveCount = candidate.moveCount;
    }
  };
  const anytimeInsertionAttempted = new Set();
  const tryExtremeAnytimeInsertion = async () => {
    if (
      qualityMode !== "extreme" ||
      !enableInsertions ||
      !Number.isFinite(bestMoveCount) ||
      bestMoveCount <= targetMoveCount ||
      bestMoveCount > targetMoveCount + 2
    ) {
      return;
    }
    const targets = candidates
      .slice()
      .sort(compareFmcCandidatePriority)
      .filter((candidate) => {
        if (!candidate?.solution || anytimeInsertionAttempted.has(candidate.solution)) return false;
        anytimeInsertionAttempted.add(candidate.solution);
        return true;
      })
      .slice(0, 2);
    for (const target of targets) {
      if (remainingMs(deadlineTs) <= 250) break;
      diagnostics.phaseRuns.insertion.calls += 1;
      const insertionStartedAt = Date.now();
      let optimized = null;
      try {
        optimized = await optimizeInsertionWasm(scramble, target.solution, {
          maxPasses: insertionMaxPasses,
          minWindow: insertionMinWindow,
          maxWindow: Math.max(insertionMaxWindow, target.moveCount <= 22 ? 9 : insertionMaxWindow),
          maxDepth: insertionMaxDepth,
        });
      } catch (_) {
        optimized = null;
      }
      diagnostics.phaseTimingsMs.insertion += Math.max(0, Date.now() - insertionStartedAt);
      if (!optimized?.ok || typeof optimized.solution !== "string") continue;
      const optimizedMoves = splitMoves(optimized.solution);
      if (!optimizedMoves.length || optimizedMoves.length >= target.moveCount) continue;
      const candidate = createCandidate(
        "FMC_ANYTIME_INSERTION",
        {
          tag: `anytime-insertion:${target.source}`,
          axisName: target.axisName,
          eoMoves: target.eoMoves,
          drMoves: target.drMoves,
          finishMoves: target.finishMoves,
          premoveMoves: target.premoveMoves,
          skeletonMoves: target.moves.slice(),
          insertionBaseMoves: target.moves.slice(),
          baseSource: target.source,
        },
        optimizedMoves,
      );
      if (!candidate) continue;
      if (!(await verifyCandidate(null, candidate, { cache: verificationCache, scrambleString: scramble }))) {
        continue;
      }
      trackCandidate(candidate);
      diagnostics.phaseRuns.insertion.successes += 1;
      if (
        !Number.isFinite(diagnostics.phaseRuns.insertion.bestMoveCount) ||
        candidate.moveCount < diagnostics.phaseRuns.insertion.bestMoveCount
      ) {
        diagnostics.phaseRuns.insertion.bestMoveCount = candidate.moveCount;
      }
      if (candidate.moveCount <= targetMoveCount) break;
    }
  };
'''
text = replace_once(text, old_track, new_track, "Anytime insertion probe")

old_scheduler_start = '''    if (fmcTablesOk) {
      const wasmStages = buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp);
      let drFlipScramblePattern = null;
      if (qualityMode === "extreme" && wasmStages.some((stage) => stage.options.enableDrFlip === true)) {
        const solvedPattern = await getSolvedPattern();
        drFlipScramblePattern = solvedPattern.applyAlg(scramble);
      }
      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {
'''
new_scheduler_start = '''    if (fmcTablesOk) {
      let extremeRound = 0;
      let drFlipScramblePattern = null;
      while (true) {
        const roundOptions = qualityMode === "extreme" ? { ...options, extremeRound } : options;
        const wasmStages = buildFmcWasmQualityStages(
          qualityMode,
          roundOptions,
          maxPremoveSets,
          forceRzp,
        );
        diagnostics.extremeRoundsStarted = qualityMode === "extreme" ? extremeRound + 1 : 0;
        if (
          qualityMode === "extreme" &&
          !drFlipScramblePattern &&
          wasmStages.some((stage) => stage.options.enableDrFlip === true)
        ) {
          const solvedPattern = await getSolvedPattern();
          drFlipScramblePattern = solvedPattern.applyAlg(scramble);
        }
        for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {
'''
text = replace_once(text, old_scheduler_start, new_scheduler_start, "Anytime scheduler start")

# Keep diagnostics bounded during an unbounded worker lifetime.
text = replace_once(
    text,
    '''        diagnostics.phaseTimingsMs.direct += stageElapsedMs;
''',
    '''        if (diagnostics.wasmStages.length > 512) {
          diagnostics.wasmStages.splice(0, diagnostics.wasmStages.length - 512);
        }
        diagnostics.phaseTimingsMs.direct += stageElapsedMs;
''',
    "bounded stage diagnostics",
)

old_bucket = '''                const stageBucket = extremeStageCandidateBuckets.get(qualityStage.name) || [];
                pushRankedUniqueCandidate(stageBucket, candidate, 12);
                extremeStageCandidateBuckets.set(qualityStage.name, stageBucket);
'''
new_bucket = '''                const stageBucketKey = qualityStage.options.bucketName || qualityStage.name;
                const stageBucket = extremeStageCandidateBuckets.get(stageBucketKey) || [];
                pushRankedUniqueCandidate(stageBucket, candidate, 12);
                extremeStageCandidateBuckets.set(stageBucketKey, stageBucket);
'''
if text.count(old_bucket) != 1:
    raise SystemExit(f"unexpected primary bucket target count: {text.count(old_bucket)}")
text = text.replace(old_bucket, new_bucket, 1)

old_flip_bucket = '''                const stageBucket = extremeStageCandidateBuckets.get(qualityStage.name) || [];
                pushRankedUniqueCandidate(stageBucket, flipCandidate, 12);
                extremeStageCandidateBuckets.set(qualityStage.name, stageBucket);
'''
new_flip_bucket = '''                const stageBucketKey = qualityStage.options.bucketName || qualityStage.name;
                const stageBucket = extremeStageCandidateBuckets.get(stageBucketKey) || [];
                pushRankedUniqueCandidate(stageBucket, flipCandidate, 12);
                extremeStageCandidateBuckets.set(stageBucketKey, stageBucket);
'''
text = replace_once(text, old_flip_bucket, new_flip_bucket, "bounded dr-flip bucket")

text = replace_once(
    text,
    '''        notify({ type: "quality_stage_done", stageName: `FMC ${qualityStage.name}` });
      }
    }
  } catch (err) {
''',
    '''        if (
          qualityMode === "extreme" &&
          bestMoveCount > targetMoveCount &&
          bestMoveCount <= targetMoveCount + 2
        ) {
          await tryExtremeAnytimeInsertion();
        }
        notify({ type: "quality_stage_done", stageName: `FMC ${qualityStage.name}` });
        }

        if (qualityMode !== "extreme") break;
        diagnostics.extremeRoundsCompleted = extremeRound + 1;
        if (Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount) break;
        if (extremeRound + 1 >= extremeMaxRounds) break;
        if (remainingMs(deadlineTs) <= 250) break;
        extremeRound += 1;
        diagnostics.frontierContinued = true;
        notify({
          type: "quality_round_start",
          stageName: `FMC Extreme Round ${extremeRound + 1}`,
          round: extremeRound + 1,
          bestMoveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : null,
          targetMoveCount,
        });
      }
    }
  } catch (err) {
''',
    "Anytime scheduler continuation",
)

solver_path.write_text(text)


# --- Site progress text ---
for benchmark_path in [Path("benchmark/benchmark-enhanced.js"), Path("benchmark/benchmark.js")]:
    benchmark = benchmark_path.read_text()
    target = '''  if (progress.type === "quality_stage_start") return `${name || "FMC Extreme"} 탐색`;
'''
    if target in benchmark:
        benchmark = benchmark.replace(
            target,
            '''  if (progress.type === "quality_round_start") {
    const best = Number.isFinite(progress.bestMoveCount) ? ` · 현재 ${progress.bestMoveCount}수` : "";
    return `${name || "FMC Extreme 다음 라운드"}${best}`;
  }
''' + target,
            1,
        )
        benchmark_path.write_text(benchmark)


# --- Contracts ---
contract_path = Path("benchmark-fmc-extreme-contract.mjs")
contract = contract_path.read_text()
contract = replace_once(
    contract,
    'const siteOptions = buildFmcExtremeOptions({ targetMoveCount: 20 });',
    'const siteOptions = buildFmcExtremeOptions({ targetMoveCount: 20, extremeMaxRounds: 1 });',
    "finite contract round cap",
)
contract = contract.replace(
    'independent-frontier-v2-compression-first-unlimited',
    'independent-frontier-v3-anytime-widening',
)
contract = replace_once(
    contract,
    'assert.equal(siteOptions.continueBelowTarget, false);',
    'assert.equal(siteOptions.continueBelowTarget, false);\nassert.equal(siteOptions.extremeMaxRounds, 1);',
    "contract max-round assertion",
)
contract_path.write_text(contract)

Path("benchmark-fmc-extreme-anytime-plan.mjs").write_text('''import assert from "node:assert/strict";
import { buildFmcWasmQualityStages } from "./solver/fmcSolver.js";

const common = {
  extremeVariantCount: 24,
  extremeReservedCompressionPremoves: 24,
  enableCoverageFallback: false,
};
const round0 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 0 }, 180, false);
const round1 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 1 }, 180, false);
const round2 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 2 }, 180, false);

assert.equal(round0.length, 24);
assert.equal(round0[0].name, "human-L3-V7-reserved");
assert.equal(round0[0].options.maxPremoveSets, 24);
assert.equal(round1.length, 24);
assert.equal(round2.length, 24);
assert.ok(round1.every((stage) => stage.options.searchLevel === 3));
assert.ok(round1.every((stage) => stage.options.maxPremoveSets === 180));
assert.ok(round2.every((stage) => stage.options.searchLevel === 3));
assert.ok(round2.every((stage) => stage.options.maxPremoveSets === 180));
assert.ok(round1.every((stage) => stage.name.includes("-R1-")));
assert.ok(round2.every((stage) => stage.name.includes("-R2-")));

const variants0 = new Set(round0.map((stage) => stage.options.searchVariant));
const variants1 = new Set(round1.map((stage) => stage.options.searchVariant));
const variants2 = new Set(round2.map((stage) => stage.options.searchVariant));
assert.equal(variants0.size, 24);
assert.equal(variants1.size, 24);
assert.equal(variants2.size, 24);
assert.equal([...variants0].some((variant) => variants1.has(variant)), false);
assert.equal([...variants1].some((variant) => variants2.has(variant)), false);
assert.equal(new Set(round1.map((stage) => stage.options.bucketName)).size, 24);
assert.deepEqual(
  new Set(round1.map((stage) => stage.options.bucketName)),
  new Set(round2.map((stage) => stage.options.bucketName)),
);

console.log(JSON.stringify({
  round0First: round0[0].name,
  round1First: round1[0].name,
  round2First: round2[0].name,
  round1VariantRange: [Math.min(...variants1), Math.max(...variants1)],
  round2VariantRange: [Math.min(...variants2), Math.max(...variants2)],
}));
''')


# Restore and update the permanent CI workflow from main. The running workflow
# has already been loaded, so replacing its file here is safe.
workflow_path = Path(".github/workflows/cfop-speedup-benchmark.yml")
workflow = subprocess.check_output(
    ["git", "show", "origin/main:.github/workflows/cfop-speedup-benchmark.yml"],
    text=True,
)
workflow = workflow.replace(
    'independent-frontier-v2-compression-first-unlimited',
    'independent-frontier-v3-anytime-widening',
)
workflow = replace_once(
    workflow,
    '''          node --check benchmark-fmc-extreme-contract.mjs
''',
    '''          node --check benchmark-fmc-extreme-contract.mjs
          node --check benchmark-fmc-extreme-anytime-plan.mjs
''',
    "workflow syntax contract",
)
workflow = replace_once(
    workflow,
    '''          grep -q 'internalBudgetUnlimited' solver/fmcSolver.js
''',
    '''          grep -q 'internalBudgetUnlimited' solver/fmcSolver.js
          grep -q 'extremeMaxRounds' solver/fmcSolver.js
          grep -q 'quality_round_start' solver/fmcSolver.js
''',
    "workflow anytime assertions",
)
workflow = replace_once(
    workflow,
    '''      - name: Verify FMC Extreme compression-first unlimited parity
        run: node benchmark-fmc-extreme-contract.mjs
''',
    '''      - name: Verify FMC Extreme anytime frontier plan
        run: node benchmark-fmc-extreme-anytime-plan.mjs

      - name: Verify FMC Extreme compression-first unlimited parity
        run: node benchmark-fmc-extreme-contract.mjs
''',
    "workflow anytime plan step",
)
workflow_path.write_text(workflow)

# Remove the migration script from the resulting branch.
Path("tools/apply-fmc-extreme-anytime-v3.py").unlink()
