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
  return Object.freeze([
    Object.freeze({
      id: "integrated-progressive-frontier",
      label: "Integrated progressive frontier",
      qualityMode: "extreme",
      timeBudgetMs: total,
      maxPremoveSets: FMC_EXTREME_PROFILE.integratedMaxPremoveSets,
      reservedCompressionPremoves: FMC_EXTREME_PROFILE.integratedReservedCompressionPremoves,
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
  const searchTargetMoveCount = Math.min(
    requestedTargetMoveCount,
    FMC_EXTREME_PROFILE.searchTargetMoveCount,
  );
  const plan = buildFmcExtremeHybridPlan(totalBudgetMs);
  const stage = plan[0];
  const startedAt = Date.now();

  emitProgress(onProgress, {
    type: "quality_stage_start",
    stageName: stage.label,
    hybridStage: stage.id,
    stageIndex: 0,
    totalStages: 1,
    requestedTargetMoveCount,
    searchTargetMoveCount,
  });

  const stageResult = await solveWithFMCSearch(
    normalizedScramble,
    (progress) => emitProgress(onProgress, {
      ...progress,
      hybridStage: stage.id,
      hybridStageName: stage.label,
      hybridStageIndex: 0,
      hybridTotalStages: 1,
    }),
    {
      qualityMode: "extreme",
      timeBudgetMs: totalBudgetMs,
      targetMoveCount: searchTargetMoveCount,
      maxPremoveSets: stage.maxPremoveSets,
      extremeVariantCount: FMC_EXTREME_PROFILE.extremeVariantCount,
      extremeReservedCompressionPremoves: stage.reservedCompressionPremoves,
      extremeMaxRounds: FMC_EXTREME_PROFILE.extremeMaxRounds,
      continueBelowTarget: true,
      verifyLimit: FMC_EXTREME_PROFILE.verifyLimit,
      enableInsertions: FMC_EXTREME_PROFILE.enableInsertions,
      insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,
      insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,
      insertionTimeMs: FMC_EXTREME_PROFILE.insertionTimeMs,
      insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,
      allowCfopFallback: false,
      premoveAllowCfopFallback: false,
      enableCoverageFallback: false,
      preferNonCfop: true,
      requireTargetReached: false,
      crossColors: Array.isArray(options.crossColors) ? options.crossColors : ["D"],
    },
  ).catch((error) => ({
    ok: false,
    reason: String(error?.message || error || "FMC_INTEGRATED_EXTREME_FAILED"),
  }));

  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const candidate = normalizeFmcHybridCandidate(stageResult, stage.id);
  const hybridStages = [{
    id: stage.id,
    label: stage.label,
    qualityMode: stage.qualityMode,
    budgetMs: stage.timeBudgetMs,
    elapsedMs,
    ok: stageResult?.ok === true,
    reason: String(stageResult?.reason || ""),
    moveCount: candidate?.moveCount ?? null,
    bestMoveCount: candidate?.moveCount ?? null,
    maxPremoveSets: stage.maxPremoveSets,
    reservedCompressionPremoves: stage.reservedCompressionPremoves,
  }];

  emitProgress(onProgress, {
    type: "quality_stage_done",
    stageName: stage.label,
    hybridStage: stage.id,
    stageIndex: 0,
    totalStages: 1,
    moveCount: candidate?.moveCount ?? null,
    bestMoveCount: candidate?.moveCount ?? null,
    elapsedMs,
  });

  if (!candidate) {
    return {
      ok: false,
      reason: String(stageResult?.reason || "FMC_NO_VALID_SOLUTION"),
      qualityMode: "extreme",
      extremeProfileId: FMC_EXTREME_PROFILE.id,
      qualityTarget: requestedTargetMoveCount,
      qualityTargetReached: false,
      qualityDowngraded: false,
      humanStyle: true,
      hybridStages,
      rejectedResult: stageResult,
    };
  }

  const qualityTargetReached = candidate.moveCount <= requestedTargetMoveCount;
  return {
    ok: true,
    solution: candidate.solution,
    moveCount: candidate.moveCount,
    source: "FMC_EXTREME_HYBRID",
    candidateSource: candidate.source,
    qualityMode: "extreme",
    extremeProfileId: FMC_EXTREME_PROFILE.id,
    qualityTarget: requestedTargetMoveCount,
    qualityTargetReached,
    qualityDowngraded: false,
    humanStyle: true,
    continueBelowTarget: true,
    searchTargetMoveCount,
    stages: candidate.stages,
    parts: candidate.parts,
    attempts: candidate.attempts,
    solutionDisplay: candidate.solutionDisplay,
    hybridStages,
    hybridWinningStage: candidate.hybridStageId,
    performanceDiagnostics: {
      ...(candidate.rawResult?.performanceDiagnostics || {}),
      solver: "fmc-extreme-integrated",
      extremeProfileId: FMC_EXTREME_PROFILE.id,
      executionModel: "single-session-progressive-frontier",
      totalBudgetMs,
      elapsedMs,
      requestedTargetMoveCount,
      searchTargetMoveCount,
      hybridWinningStage: candidate.hybridStageId,
      hybridStages,
    },
  };
}
