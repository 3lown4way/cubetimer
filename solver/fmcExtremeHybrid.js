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
  const adaptiveBudgetMs = Math.max(1000, Math.min(20000, Math.floor(total / 6)));
  const progressiveBudgetMs = Math.max(1000, total - adaptiveBudgetMs);
  return Object.freeze([
    Object.freeze({
      id: "adaptive-seed",
      label: "Adaptive human seed",
      qualityMode: "sweetSpot",
      timeBudgetMs: adaptiveBudgetMs,
      maxPremoveSets: 40,
    }),
    Object.freeze({
      id: "progressive-frontier",
      label: "Progressive independent frontier",
      qualityMode: "extreme",
      timeBudgetMs: progressiveBudgetMs,
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

function buildStageOptions(stage, searchTargetMoveCount, crossColors) {
  const common = {
    targetMoveCount: searchTargetMoveCount,
    timeBudgetMs: stage.timeBudgetMs,
    allowCfopFallback: false,
    premoveAllowCfopFallback: false,
    enableCoverageFallback: false,
    preferNonCfop: true,
    enableInsertions: true,
    requireTargetReached: false,
    crossColors,
  };

  if (stage.qualityMode === "sweetSpot") {
    return {
      ...common,
      qualityMode: "sweetSpot",
      maxPremoveSets: stage.maxPremoveSets,
      verifyLimit: 24,
      insertionCandidateLimit: 3,
      insertionMaxPasses: 3,
      insertionTimeMs: Math.min(5000, Math.max(1200, Math.floor(stage.timeBudgetMs * 0.3))),
      insertionThreshold: 28,
    };
  }

  return {
    ...common,
    qualityMode: "extreme",
    maxPremoveSets: stage.maxPremoveSets,
    extremeVariantCount: FMC_EXTREME_PROFILE.extremeVariantCount,
    extremeReservedCompressionPremoves: stage.reservedCompressionPremoves,
    extremeMaxRounds: FMC_EXTREME_PROFILE.extremeMaxRounds,
    continueBelowTarget: true,
    verifyLimit: FMC_EXTREME_PROFILE.verifyLimit,
    insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,
    insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,
    insertionTimeMs: FMC_EXTREME_PROFILE.insertionTimeMs,
    insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,
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
  const searchTargetMoveCount = Math.min(
    requestedTargetMoveCount,
    FMC_EXTREME_PROFILE.searchTargetMoveCount,
  );
  const crossColors = Array.isArray(options.crossColors) ? options.crossColors : ["D"];
  const plan = buildFmcExtremeHybridPlan(totalBudgetMs);
  const candidates = [];
  const hybridStages = [];
  const rawStageResults = [];
  const startedAt = Date.now();
  const deadlineTs = startedAt + totalBudgetMs;

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
      buildStageOptions(stage, searchTargetMoveCount, crossColors),
    ).catch((error) => ({
      ok: false,
      reason: String(error?.message || error || "FMC_HYBRID_STAGE_FAILED"),
    }));
    rawStageResults.push(stageResult);

    const candidate = normalizeFmcHybridCandidate(stageResult, stage.id);
    if (candidate) candidates.push(candidate);
    const best = pickBestFmcHybridCandidate(candidates);
    const elapsedMs = Math.max(1, Date.now() - stageStartedAt);
    hybridStages.push({
      id: stage.id,
      label: stage.label,
      qualityMode: stage.qualityMode,
      budgetMs: stage.timeBudgetMs,
      elapsedMs,
      ok: stageResult?.ok === true,
      reason: String(stageResult?.reason || ""),
      moveCount: candidate?.moveCount ?? null,
      bestMoveCount: best?.moveCount ?? null,
      maxPremoveSets: stage.maxPremoveSets,
      reservedCompressionPremoves: stage.reservedCompressionPremoves ?? null,
    });

    emitProgress(onProgress, {
      type: "quality_stage_done",
      stageName: stage.label,
      hybridStage: stage.id,
      stageIndex: index,
      totalStages: plan.length,
      moveCount: candidate?.moveCount ?? null,
      bestMoveCount: best?.moveCount ?? null,
      elapsedMs,
    });
  }

  const best = pickBestFmcHybridCandidate(candidates);
  const lastResult = rawStageResults[rawStageResults.length - 1] || null;
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

  const elapsedMs = Math.max(1, Date.now() - startedAt);
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
      solver: "fmc-extreme-progressive",
      extremeProfileId: FMC_EXTREME_PROFILE.id,
      executionModel: "adaptive-seed-plus-progressive-frontier",
      totalBudgetMs,
      elapsedMs,
      requestedTargetMoveCount,
      searchTargetMoveCount,
      hybridWinningStage: best.hybridStageId,
      hybridStages,
      progressiveFrontierDiagnostics:
        rawStageResults.find((result, index) => plan[index]?.id === "progressive-frontier")?.performanceDiagnostics || null,
    },
  };
}
