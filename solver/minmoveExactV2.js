import {
  LITERAL_INVERSE_EXEMPT_MOVE_COUNT,
  normalizeOuterAlgorithm,
  shouldRejectLiteralInverseSolution,
} from "./inverseSolutionPolicy.js";

import {
  dropTwophase333Search,
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  searchTwophaseExact333,
  verifyFmcSolutionWasm,
} from "./wasmSolver.js";

const DEFAULT_TIME_BUDGET_MS = 60_000;
const DEFAULT_APPROX_SLACK = 4;
const DEFAULT_GOOD_ENOUGH_SLACK = 2;
const DEFAULT_SEED_BUDGET_MS = 14_000;
const DEFAULT_IMPROVEMENT_BUDGET_MS = 16_000;

const DEFAULT_SEED_CONFIGS = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 768, phase1MaxDepth: 18, phase1NodeLimit: 16_000_000, phase2NodeLimit: 80_000_000 },
];

const DEFAULT_IMPROVEMENT_PROFILES = [
  { phase1NodeLimit: 1_000_000, phase2NodeLimit: 8_000_000 },
  { phase1NodeLimit: 4_000_000, phase2NodeLimit: 32_000_000 },
];

function splitMoves(sequence) {
  return String(sequence || "")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function invertMove(token) {
  const normalized = String(token || "").trim();
  if (!/^[URFDLB](2|'|2')?$/.test(normalized)) return "";
  if (normalized.endsWith("2") || normalized.endsWith("2'")) return `${normalized[0]}2`;
  if (normalized.endsWith("'")) return normalized.slice(0, -1);
  return `${normalized}'`;
}

function invertAlgorithm(sequence) {
  const moves = splitMoves(sequence);
  const inverse = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const inverted = invertMove(moves[index]);
    if (!inverted) return "";
    inverse.push(inverted);
  }
  return inverse.join(" ");
}

function emitProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  try {
    void onProgress(progress);
  } catch (_) {
    // Progress is best-effort.
  }
}

async function verifySolution(scramble, solution) {
  const wasmVerification = await verifyFmcSolutionWasm(scramble, solution).catch(() => null);
  if (wasmVerification && typeof wasmVerification.solved === "boolean") {
    return wasmVerification.solved;
  }
  try {
    const { getDefaultPattern } = await import("./context.js");
    const solved = await getDefaultPattern("333");
    const after = solved.applyAlg(scramble).applyAlg(solution);
    return typeof after.experimentalIsSolved === "function"
      ? !!after.experimentalIsSolved({ ignorePuzzleOrientation: false })
      : JSON.stringify(after.patternData) === JSON.stringify(solved.patternData);
  } catch (_) {
    return false;
  }
}

async function findTwoPhaseSeed(
  scramble,
  ceilingLength,
  seedConfigs,
  excludedSolution = "",
  deadlineTs = null,
) {
  const normalizedExcluded = normalizeOuterAlgorithm(excludedSolution);
  let best = null;

  for (const config of seedConfigs) {
    if (Number.isFinite(deadlineTs) && Date.now() >= deadlineTs) break;
    let searchId = null;
    try {
      const prepared = await prepareTwophase333(scramble, {
        maxPhase1Solutions: config.maxPhase1Solutions,
        phase1MaxDepth: config.phase1MaxDepth,
        phase1NodeLimit: config.phase1NodeLimit,
        ...(Number.isFinite(deadlineTs) ? { deadlineTs } : {}),
      });
      if (!prepared?.ok || !Number.isFinite(prepared.searchId)) continue;
      searchId = prepared.searchId;

      const searched = await searchTwophase333(searchId, {
        incumbentLength: ceilingLength,
        excludedSolution: normalizedExcluded || undefined,
        strictIncumbent: false,
        phase2MaxDepth: 20,
        phase2NodeLimit: config.phase2NodeLimit,
        ...(Number.isFinite(deadlineTs) ? { deadlineTs } : {}),
      });

      if (!searched?.ok || typeof searched.solution !== "string") continue;
      const normalizedSolution = normalizeOuterAlgorithm(searched.solution);
      const candidateLength = splitMoves(normalizedSolution).length;
      if (!normalizedSolution || candidateLength > ceilingLength) continue;
      if (normalizedExcluded && normalizedSolution === normalizedExcluded) continue;
      if (!best || candidateLength < best.moveCount) {
        best = {
          ...searched,
          solution: normalizedSolution,
          moveCount: candidateLength,
        };
      }
    } catch (_) {
      // Try the next bounded profile.
    } finally {
      if (Number.isFinite(searchId)) {
        await dropTwophase333Search(searchId).catch(() => false);
      }
    }
  }

  return best;
}

function approximateResult(solution, moveCount, meta = {}) {
  return {
    ok: true,
    solution,
    moveCount,
    nodes: Number.isFinite(meta.nodes) ? meta.nodes : 0,
    bound: moveCount,
    source: "MINMOVE_333_BEST_EFFORT",
    metric: "HTM",
    optimalityProven: meta.optimalityProven === true,
    approximate: meta.optimalityProven !== true,
    upperBoundLength: moveCount,
    inverseUpperBoundLength: Number.isFinite(meta.inverseUpperBoundLength)
      ? meta.inverseUpperBoundLength
      : null,
    proofSource: meta.optimalityProven === true
      ? "exact_twophase_exhaustion"
      : "best_effort_twophase",
    fallbackReason: null,
    seedSource: meta.seedSource || "twophase_seed",
    proofAttempts: Number.isFinite(meta.proofAttempts) ? Math.max(0, Math.floor(meta.proofAttempts)) : 0,
    timeBudgetMs: Number.isFinite(meta.timeBudgetMs) ? Math.max(0, Math.floor(meta.timeBudgetMs)) : 0,
    elapsedMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : 0,
  };
}

function failureResult(reason, meta = {}) {
  return {
    ok: false,
    reason,
    solution: "",
    moveCount: 0,
    nodes: Number.isFinite(meta.nodes) ? meta.nodes : 0,
    source: "MINMOVE_333_BEST_EFFORT",
    metric: "HTM",
    optimalityProven: false,
    approximate: true,
    fallbackReason: null,
    elapsedMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : 0,
  };
}

export async function solveMinmoveExactV2(scramble, onProgress = null, options = {}) {
  const normalizedScramble = splitMoves(scramble).join(" ");
  const inverseScramble = invertAlgorithm(normalizedScramble);
  if (!normalizedScramble || !inverseScramble) {
    return failureResult("MINMOVE_BAD_SCRAMBLE");
  }

  const startedAt = Date.now();
  const timeBudgetMs = Number.isFinite(Number(options.timeBudgetMs))
    ? Math.max(1_000, Math.floor(Number(options.timeBudgetMs)))
    : DEFAULT_TIME_BUDGET_MS;
  const globalDeadlineTs = startedAt + timeBudgetMs;

  const approxSlack = Number.isFinite(Number(options.approxSlack))
    ? Math.max(0, Math.floor(Number(options.approxSlack)))
    : DEFAULT_APPROX_SLACK;
  const goodEnoughSlack = Number.isFinite(Number(options.goodEnoughSlack))
    ? Math.max(0, Math.floor(Number(options.goodEnoughSlack)))
    : DEFAULT_GOOD_ENOUGH_SLACK;
  const seedConfigs = Array.isArray(options.seedConfigs) && options.seedConfigs.length
    ? options.seedConfigs
    : DEFAULT_SEED_CONFIGS;
  const improvementProfiles = Array.isArray(options.exactProfiles) && options.exactProfiles.length
    ? options.exactProfiles
    : DEFAULT_IMPROVEMENT_PROFILES;

  const ready = await ensureTwophase333Ready().catch(() => null);
  if (!ready) return failureResult("MINMOVE_TWOPHASE_UNAVAILABLE");

  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  const rejectLiteralInverse = inverseUpperBoundLength > LITERAL_INVERSE_EXEMPT_MOVE_COUNT;
  const practicalCeiling = inverseUpperBoundLength + approxSlack;
  const seedDeadlineTs = Math.min(
    globalDeadlineTs,
    startedAt + Math.min(DEFAULT_SEED_BUDGET_MS, Math.max(4_000, Math.floor(timeBudgetMs * 0.45))),
  );

  let bestSolution = rejectLiteralInverse ? "" : inverseScramble;
  let bestMoveCount = bestSolution ? inverseUpperBoundLength : Number.POSITIVE_INFINITY;
  let bestSource = bestSolution ? "short_inverse_exception" : "";
  let totalNodes = 0;
  let proofAttempts = 0;

  emitProgress(onProgress, {
    type: "upper_bound_start",
    stageName: "MinMove HTM best effort",
    inverseUpperBoundLength,
    practicalCeiling,
  });

  const directions = [
    {
      scramble: normalizedScramble,
      invert: false,
      source: "twophase_seed",
      excludedSolution: rejectLiteralInverse ? inverseScramble : "",
    },
    {
      scramble: inverseScramble,
      invert: true,
      source: "inverse_twophase_seed",
      excludedSolution: rejectLiteralInverse ? normalizedScramble : "",
    },
  ];

  for (const direction of directions) {
    if (Date.now() >= seedDeadlineTs) break;
    const seed = await findTwoPhaseSeed(
      direction.scramble,
      practicalCeiling,
      seedConfigs,
      direction.excludedSolution,
      seedDeadlineTs,
    );
    if (!seed?.ok || typeof seed.solution !== "string") continue;

    totalNodes += Number.isFinite(seed.nodes) ? seed.nodes : 0;
    const candidateSolution = normalizeOuterAlgorithm(
      direction.invert ? invertAlgorithm(seed.solution) : seed.solution,
    );
    const candidateLength = splitMoves(candidateSolution).length;
    if (!candidateSolution || candidateLength > practicalCeiling) continue;
    if (shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)) continue;
    if (!(await verifySolution(normalizedScramble, candidateSolution))) continue;

    if (candidateLength < bestMoveCount) {
      bestSolution = candidateSolution;
      bestMoveCount = candidateLength;
      bestSource = direction.source;
      emitProgress(onProgress, {
        type: "exact_search_improved",
        moveCount: bestMoveCount,
        nodes: totalNodes,
        approximate: true,
      });
    }
  }

  if (
    bestSolution
    && bestMoveCount <= inverseUpperBoundLength + goodEnoughSlack
    && !shouldRejectLiteralInverseSolution(normalizedScramble, bestSolution)
  ) {
    return approximateResult(bestSolution, bestMoveCount, {
      nodes: totalNodes,
      inverseUpperBoundLength,
      seedSource: bestSource,
      proofAttempts,
      timeBudgetMs,
      elapsedMs: Date.now() - startedAt,
    });
  }

  // Spend a bounded amount of time looking below the known inverse upper bound.
  // This is an improvement pass, not a requirement for returning a usable result.
  const improvementDeadlineTs = Math.min(
    globalDeadlineTs,
    Date.now() + Math.min(DEFAULT_IMPROVEMENT_BUDGET_MS, Math.max(3_000, Math.floor(timeBudgetMs * 0.35))),
  );
  let targetBound = Math.max(0, Math.min(
    inverseUpperBoundLength - 1,
    Number.isFinite(bestMoveCount) ? bestMoveCount - 1 : inverseUpperBoundLength - 1,
  ));
  let lastExhaustedBound = null;

  while (targetBound >= 0 && Date.now() < improvementDeadlineTs) {
    let improved = false;
    let exhausted = false;

    emitProgress(onProgress, {
      type: "bound_update",
      bound: targetBound,
      upperBoundLength: Number.isFinite(bestMoveCount) ? bestMoveCount : practicalCeiling,
      nodes: totalNodes,
    });

    for (const profile of improvementProfiles) {
      if (Date.now() >= improvementDeadlineTs) break;
      proofAttempts += 1;
      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: targetBound,
        excludedSolution: rejectLiteralInverse ? inverseScramble : undefined,
        phase1NodeLimit: Number.isFinite(Number(profile?.phase1NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase1NodeLimit)))
          : 0,
        phase2NodeLimit: Number.isFinite(Number(profile?.phase2NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase2NodeLimit)))
          : 0,
        deadlineTs: improvementDeadlineTs,
      }).catch(() => null);

      totalNodes += Number.isFinite(searched?.nodes) ? searched.nodes : 0;
      if (!searched?.ok) continue;

      if (searched.found && typeof searched.solution === "string") {
        const candidateSolution = normalizeOuterAlgorithm(searched.solution);
        const candidateLength = splitMoves(candidateSolution).length;
        if (
          candidateSolution
          && candidateLength <= targetBound
          && !shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)
          && await verifySolution(normalizedScramble, candidateSolution)
        ) {
          bestSolution = candidateSolution;
          bestMoveCount = candidateLength;
          bestSource = "exact_twophase_improvement";
          improved = true;
          emitProgress(onProgress, {
            type: "exact_search_improved",
            moveCount: bestMoveCount,
            nodes: totalNodes,
            approximate: true,
          });
          break;
        }
      }

      if (!searched.interrupted && !searched.found) {
        exhausted = true;
        lastExhaustedBound = targetBound;
        break;
      }
    }

    if (improved) {
      if (bestMoveCount <= inverseUpperBoundLength + goodEnoughSlack) break;
      targetBound = Math.max(0, bestMoveCount - 1);
      continue;
    }
    if (exhausted) break;
    break;
  }

  // If the tight search found nothing displayable, deliberately relax the
  // ceiling. A near-minimal non-inverse solution is better than MINMOVE_NOT_PROVEN.
  if (!bestSolution && Date.now() < globalDeadlineTs) {
    const relaxedCeiling = inverseUpperBoundLength + Math.max(approxSlack + 4, 8);
    const relaxed = await findTwoPhaseSeed(
      normalizedScramble,
      relaxedCeiling,
      seedConfigs,
      rejectLiteralInverse ? inverseScramble : "",
      globalDeadlineTs,
    );
    if (relaxed?.ok && typeof relaxed.solution === "string") {
      totalNodes += Number.isFinite(relaxed.nodes) ? relaxed.nodes : 0;
      const candidateSolution = normalizeOuterAlgorithm(relaxed.solution);
      const candidateLength = splitMoves(candidateSolution).length;
      if (
        candidateSolution
        && !shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)
        && await verifySolution(normalizedScramble, candidateSolution)
      ) {
        bestSolution = candidateSolution;
        bestMoveCount = candidateLength;
        bestSource = "relaxed_twophase_seed";
      }
    }
  }

  if (!bestSolution) {
    return failureResult("MINMOVE_NO_NONINVERSE_SOLUTION", {
      nodes: totalNodes,
      elapsedMs: Date.now() - startedAt,
    });
  }
  if (shouldRejectLiteralInverseSolution(normalizedScramble, bestSolution)) {
    return failureResult("MINMOVE_LITERAL_INVERSE_REJECTED", {
      nodes: totalNodes,
      elapsedMs: Date.now() - startedAt,
    });
  }
  if (!(await verifySolution(normalizedScramble, bestSolution))) {
    return failureResult("MINMOVE_DISPLAY_SOLUTION_INVALID", {
      nodes: totalNodes,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const optimalityProven = Number.isFinite(lastExhaustedBound)
    && bestMoveCount === lastExhaustedBound + 1;

  emitProgress(onProgress, {
    type: optimalityProven ? "optimality_proven" : "best_effort_done",
    moveCount: bestMoveCount,
    optimalityProven,
    nodes: totalNodes,
  });

  return approximateResult(bestSolution, bestMoveCount, {
    nodes: totalNodes,
    inverseUpperBoundLength,
    seedSource: bestSource,
    proofAttempts,
    timeBudgetMs,
    elapsedMs: Date.now() - startedAt,
    optimalityProven,
  });
}
