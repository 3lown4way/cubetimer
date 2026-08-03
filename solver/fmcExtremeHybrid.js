import { FMC_EXTREME_PROFILE } from "./fmcExtremeProfile.js";

const TARGET_MISS_REASONS = new Set([
  "FMC_EXTREME_TARGET_NOT_REACHED",
  "FMC_HUMAN_TARGET_NOT_REACHED",
]);

function asPositiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function emitProgress(onProgress, payload) {
  if (typeof onProgress !== "function") return;
  try {
    void onProgress(payload);
  } catch (_) {}
}

export function buildFmcExtremeHybridPlan(totalBudgetMs = FMC_EXTREME_PROFILE.defaultTimeBudgetMs) {
  const total = Math.max(3000, asPositiveInteger(totalBudgetMs, FMC_EXTREME_PROFILE.defaultTimeBudgetMs));
  const adaptiveBudgetMs = Math.max(1000, Math.floor(total / 6));
  const fullHumanBudgetMs = Math.max(1000, Math.floor(total / 3));
  const independentBudgetMs = Math.max(1000, total - adaptiveBudgetMs - fullHumanBudgetMs);

  return Object.freeze([
    Object.freeze({
      id: "adaptive-human",
      label: "Adaptive human FMC",
      qualityMode: "sweetSpot",
      timeBudgetMs: adaptiveBudgetMs,
    }),
    Object.freeze({
      id: "full-human-portfolio",
      label: "Full human portfolio",
      qualityMode: "custom",
      timeBudgetMs: fullHumanBudgetMs,
    }),
    Object.freeze({
      id: "independent-frontier",
      label: "Independent frontier",
      qualityMode: "extreme",
      timeBudgetMs: independentBudgetMs,
    }),
  ]);
}

export function normalizeFmcHybridCandidate(result, hybridStageId = "") {
  if (!result || typeof result !== "object") return null;
  const targetMiss = TARGET_MISS_REASONS.has(String(result.reason || ""));
  if (result.ok !== true && !targetMiss && !result.bestHumanSolution && !result.bestCandidate?.solution) {
    return null;
  }

  const solution = String(
    result.ok === true
      ? result.solution || result.bestHumanSolution || result.bestCandidate?.solution || ""
      : result.bestHumanSolution || result.bestCandidate?.solution || "",
  ).trim();
  const moveCount = Number(
    result.ok === true
      ? result.moveCount ?? result.bestHumanMoveCount ?? result.bestCandidate?.moveCount
      : result.bestHumanMoveCount ?? result.bestCandidate?.moveCount ?? result.moveCount,
  );
  if (!solution || !Number.isFinite(moveCount) || moveCount <= 0) return null;

  const source = String(
    result.ok === true
      ? result.source || result.bestHumanSource || result.bestCandidate?.source || "FMC_HUMAN"
      : result.bestHumanSource || result.bestCandidate?.source || result.source || "FMC_HUMAN",
  );
  if (/FALLBACK|EXTERNAL/i.test(source)) return null;

  return {
    solution,
    moveCount,
    source,
    stages: Array.isArray(result.stages)
      ? result.stages
      : Array.isArray(result.bestHumanStages)
        ? result.bestHumanStages
        : [],
    parts: Array.isArray(result.parts)
      ? result.parts
      : Array.isArray(result.bestHumanParts)
        ? result.bestHumanParts
        : [],
    attempts: Array.isArray(result.attempts) ? result.attempts : [],
    solutionDisplay: typeof result.solutionDisplay === "string" ? result.solutionDisplay : "",
    hybridStageId,
    rawResult: result,
  };
}

export function pickBestFmcHybridCandidate(candidates) {
  const valid = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!valid.length) return null;
  return valid.slice().sort((left, right) => {
    if (left.moveCount !== right.moveCount) return left.moveCount - right.moveCount;
    const leftStages = Array.isArray(left.stages) ? left.stages.length : 0;
    const rightStages = Array.isArray(right.stages) ? right.stages.length : 0;
    return rightStages - leftStages;
  })[0];
}

function buildStageOptions(stage, common, searchTargetMoveCount) {
  if (stage.qualityMode === "sweetSpot") {
    return {
      ...common,
      qualityMode: "sweetSpot",
      timeBudgetMs: stage.timeBudgetMs,
      targetMoveCount: searchTargetMoveCount,
      maxPremoveSets: 40,
      verifyLimit: 24,
      insertionCandidateLimit: 3,
      insertionMaxPasses: 3,
      insertionTimeMs: Math.min(5000, Math.max(1200, Math.floor(stage.timeBudgetMs * 0.3))),
      insertionThreshold: 28,
      requireTargetReached: false,
    };
  }

  if (stage.qualityMode === "custom") {
    return {
      ...common,
      qualityMode: "custom",
      timeBudgetMs: stage.timeBudgetMs,
      targetMoveCount: searchTargetMoveCount,
      maxPremoveSets: FMC_EXTREME_PROFILE.maxPremoveSets,
      verifyLimit: FMC_EXTREME_PROFILE.verifyLimit,
      enableMultiSwitchNiss: true,
      enableDeepMultiSwitchNiss: true,
      enableHtrSkeletons: true,
      enableSliceInsertion: true,
      enableMultiInsertion: true,
      insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,
      insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,
      insertionTimeMs: Math.min(
        FMC_EXTREME_PROFILE.insertionTimeMs,
        Math.max(3000, Math.floor(stage.timeBudgetMs * 0.4)),
      ),
      insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,
      requireTargetReached: false,
    };
  }

  return {
    ...common,
    qualityMode: "extreme",
    timeBudgetMs: stage.timeBudgetMs,
    targetMoveCount: searchTargetMoveCount,
    maxPremoveSets: FMC_EXTREME_PROFILE.maxPremoveSets,
    extremeVariantCount: FMC_EXTREME_PROFILE.extremeVariantCount,
    extremeReservedCompressionPremoves: FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves,
    extremeMaxRounds: FMC_EXTREME_PROFILE.extremeMaxRounds,
    continueBelowTarget: true,
    verifyLimit: FMC_EXTREME_PROFILE.verifyLimit,
    insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,
    insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,
    insertionTimeMs: Math.min(
      FMC_EXTREME_PROFILE.insertionTimeMs,
      Math.max(3000, Math.floor(stage.timeBudgetMs * 0.35)),
    ),
    insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,
    requireTargetReached: false,
  };
}

export async function warmFmcExtremeHybrid() {
  const { buildFmcTablesWasm } = await import("./wasmSolver.js");
  return buildFmcTablesWasm();
}

export async function solveWithFmcExtremeHybrid(scramble, onProgress, options = {}) {
  const normalizedScramble = String(scramble || "").trim();
  if (!normalizedScramble) return { ok: false, reason: "NO_SCRAMBLE" };
  const { solveWithFMCSearch } = await import("./fmcSolver.js");

  const totalBudgetMs = Math.max(
    3000,
    asPositiveInteger(options.timeBudgetMs, FMC_EXTREME_PROFILE.defaultTimeBudgetMs),
  );
  const requestedTargetMoveCount = Math.max(
    1,
    asPositiveInteger(options.targetMoveCount, FMC_EXTREME_PROFILE.targetMoveCount),
  );
  // The public goal remains 20 (or the user-selected value), but Extreme keeps
  // searching toward 18 instead of treating the first 20 as the terminal result.
  const searchTargetMoveCount = Math.min(requestedTargetMoveCount, FMC_EXTREME_PROFILE.searchTargetMoveCount);
  const plan = buildFmcExtremeHybridPlan(totalBudgetMs);
  const candidates = [];
  const hybridStages = [];
  const startedAt = Date.now();
  const deadlineTs = startedAt + totalBudgetMs;
  let lastResult = null;

  const common = {
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    enableInsertions: true,
    crossColors: Array.isArray(options.crossColors) ? options.crossColors : ["D"],
  };

  for (let index = 0; index < plan.length; index += 1) {
    if (Date.now() >= deadlineTs - 250) break;
    if (candidates.some((candidate) => candidate.moveCount <= searchTargetMoveCount)) break;

    const plannedStage = plan[index];
    const remainingMs = Math.max(1000, deadlineTs - Date.now());
    const stage = {
      ...plannedStage,
      timeBudgetMs: Math.max(1000, Math.min(plannedStage.timeBudgetMs, remainingMs)),
    };
    emitProgress(onProgress, {
      type: "quality_stage_start",
      stageName: stage.label,
      hybridStage: stage.id,
      stageIndex: index,
      totalStages: plan.length,
      bestMoveCount: pickBestFmcHybridCandidate(candidates)?.moveCount ?? null,
      requestedTargetMoveCount,
      searchTargetMoveCount,
    });

    const stageStartedAt = Date.now();
    const stageResult = await solveWithFMCSearch(
      normalizedScramble,
      (progress) => emitProgress(onProgress, {
        ...progress,
        hybridStage: stage.id,
        hybridStageName: stage.label,
        hybridStageIndex: index,
        hybridTotalStages: plan.length,
      }),
      buildStageOptions(stage, common, searchTargetMoveCount),
    ).catch((error) => ({
      ok: false,
      reason: String(error?.message || error || "FMC_HYBRID_STAGE_FAILED"),
    }));
    lastResult = stageResult;

    const candidate = normalizeFmcHybridCandidate(stageResult, stage.id);
    if (candidate) candidates.push(candidate);
    const best = pickBestFmcHybridCandidate(candidates);
    hybridStages.push({
      id: stage.id,
      label: stage.label,
      qualityMode: stage.qualityMode,
      budgetMs: stage.timeBudgetMs,
      elapsedMs: Math.max(1, Date.now() - stageStartedAt),
      ok: stageResult?.ok === true,
      reason: String(stageResult?.reason || ""),
      moveCount: candidate?.moveCount ?? null,
      bestMoveCount: best?.moveCount ?? null,
    });

    emitProgress(onProgress, {
      type: "quality_stage_done",
      stageName: stage.label,
      hybridStage: stage.id,
      stageIndex: index,
      totalStages: plan.length,
      moveCount: candidate?.moveCount ?? null,
      bestMoveCount: best?.moveCount ?? null,
      elapsedMs: Math.max(1, Date.now() - stageStartedAt),
    });
  }

  const best = pickBestFmcHybridCandidate(candidates);
  if (!best) {
    return {
      ok: false,
      reason: String(lastResult?.reason || "FMC_NO_VALID_SOLUTION"),
      qualityMode: "extreme",
      extremeProfileId: FMC_EXTREME_PROFILE.id,
      qualityTarget: requestedTargetMoveCount,
      qualityTargetReached: false,
      qualityDowngraded: false,
      humanStyle: true,
      hybridStages,
      rejectedResult: lastResult,
    };
  }

  const qualityTargetReached = best.moveCount <= requestedTargetMoveCount;
  return {
    ok: true,
    solution: best.solution,
    moveCount: best.moveCount,
    source: "FMC_EXTREME_HYBRID",
    candidateSource: best.source,
    qualityMode: "extreme",
    extremeProfileId: FMC_EXTREME_PROFILE.id,
    qualityTarget: requestedTargetMoveCount,
    qualityTargetReached,
    qualityDowngraded: false,
    humanStyle: true,
    continueBelowTarget: true,
    searchTargetMoveCount,
    stages: best.stages,
    parts: best.parts,
    attempts: best.attempts,
    solutionDisplay: best.solutionDisplay,
    hybridStages,
    hybridWinningStage: best.hybridStageId,
    performanceDiagnostics: {
      ...(best.rawResult?.performanceDiagnostics || {}),
      solver: "fmc-extreme-hybrid",
      extremeProfileId: FMC_EXTREME_PROFILE.id,
      totalBudgetMs,
      elapsedMs: Math.max(1, Date.now() - startedAt),
      requestedTargetMoveCount,
      searchTargetMoveCount,
      hybridWinningStage: best.hybridStageId,
      hybridStages,
    },
  };
}
