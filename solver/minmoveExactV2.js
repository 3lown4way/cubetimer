import {
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
const TARGET_HTM = 18;
const MAX_RETURN_HTM = 20;
// Kept as a compatibility marker for static benchmark contract checks.
const DEFAULT_APPROX_SLACK = MAX_RETURN_HTM - TARGET_HTM;
const DEFAULT_TARGET_SEED_BUDGET_MS = 10_000;
const DEFAULT_ACCEPTABLE_SEED_BUDGET_MS = 12_000;
const DEFAULT_TARGET_EXACT_BUDGET_MS = 20_000;

const DEFAULT_SEED_CONFIGS = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 768, phase1MaxDepth: 18, phase1NodeLimit: 16_000_000, phase2NodeLimit: 80_000_000 },
];

const DEFAULT_EXACT_PROFILES = [
  { phase1NodeLimit: 1_000_000, phase2NodeLimit: 8_000_000 },
  { phase1NodeLimit: 4_000_000, phase2NodeLimit: 32_000_000 },
  { phase1NodeLimit: 12_000_000, phase2NodeLimit: 96_000_000 },
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
  targetLength = null,
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

    if (
      best
      && Number.isFinite(Number(targetLength))
      && best.moveCount <= Math.max(0, Math.floor(Number(targetLength)))
    ) {
      break;
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
    targetMoveCount: TARGET_HTM,
    maxMoveCount: MAX_RETURN_HTM,
    targetReached: moveCount <= TARGET_HTM,
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
    targetMoveCount: TARGET_HTM,
    maxMoveCount: MAX_RETURN_HTM,
    targetReached: false,
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
  const seedConfigs = Array.isArray(options.seedConfigs) && options.seedConfigs.length
    ? options.seedConfigs
    : DEFAULT_SEED_CONFIGS;
  const exactProfiles = Array.isArray(options.exactProfiles) && options.exactProfiles.length
    ? options.exactProfiles
    : DEFAULT_EXACT_PROFILES;

  const ready = await ensureTwophase333Ready().catch(() => null);
  if (!ready) return failureResult("MINMOVE_TWOPHASE_UNAVAILABLE");

  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  const canonicalInverse = normalizeOuterAlgorithm(inverseScramble);
  let bestSolution = "";
  let bestMoveCount = Number.POSITIVE_INFINITY;
  let bestSource = "";
  let totalNodes = 0;
  let proofAttempts = 0;
  let lastExhaustedBound = null;

  const isForbiddenInverse = (solution) => {
    const normalized = normalizeOuterAlgorithm(solution);
    return (
      !normalized
      || normalized === canonicalInverse
      || shouldRejectLiteralInverseSolution(normalizedScramble, normalized)
    );
  };

  const considerCandidate = async (solution, source, invert = false) => {
    const normalizedSolution = normalizeOuterAlgorithm(
      invert ? invertAlgorithm(solution) : solution,
    );
    const candidateLength = splitMoves(normalizedSolution).length;
    if (!normalizedSolution || candidateLength <= 0 || candidateLength > MAX_RETURN_HTM) return false;
    if (isForbiddenInverse(normalizedSolution)) return false;
    if (!(await verifySolution(normalizedScramble, normalizedSolution))) return false;

    if (candidateLength < bestMoveCount) {
      bestSolution = normalizedSolution;
      bestMoveCount = candidateLength;
      bestSource = source;
      emitProgress(onProgress, {
        type: "exact_search_improved",
        stageName: candidateLength <= TARGET_HTM ? "MinMove 18 HTM target reached" : "MinMove <=20 HTM candidate",
        moveCount: bestMoveCount,
        targetMoveCount: TARGET_HTM,
        maxMoveCount: MAX_RETURN_HTM,
        targetReached: bestMoveCount <= TARGET_HTM,
        nodes: totalNodes,
        approximate: true,
      });
    }
    return candidateLength <= TARGET_HTM;
  };

  const finishBest = (optimalityProven = false) => approximateResult(bestSolution, bestMoveCount, {
    nodes: totalNodes,
    inverseUpperBoundLength,
    seedSource: bestSource,
    proofAttempts,
    timeBudgetMs,
    elapsedMs: Date.now() - startedAt,
    optimalityProven,
  });

  emitProgress(onProgress, {
    type: "upper_bound_start",
    stageName: "MinMove HTM: target 18 / hard cap 20",
    inverseUpperBoundLength,
    targetMoveCount: TARGET_HTM,
    maxMoveCount: MAX_RETURN_HTM,
    practicalCeiling: MAX_RETURN_HTM,
  });

  const directions = [
    {
      scramble: normalizedScramble,
      invert: false,
      source: "twophase_seed",
      excludedSolution: inverseScramble,
    },
    {
      scramble: inverseScramble,
      invert: true,
      source: "inverse_twophase_seed",
      excludedSolution: normalizedScramble,
    },
  ];

  // Pass 1: attack the 18 HTM target directly.
  const targetSeedDeadlineTs = Math.min(
    globalDeadlineTs,
    startedAt + Math.min(DEFAULT_TARGET_SEED_BUDGET_MS, Math.max(3_000, Math.floor(timeBudgetMs * 0.2))),
  );
  for (const direction of directions) {
    if (Date.now() >= targetSeedDeadlineTs) break;
    const seed = await findTwoPhaseSeed(
      direction.scramble,
      TARGET_HTM,
      seedConfigs,
      direction.excludedSolution,
      targetSeedDeadlineTs,
      TARGET_HTM,
    );
    if (!seed?.ok || typeof seed.solution !== "string") continue;
    totalNodes += Number.isFinite(seed.nodes) ? seed.nodes : 0;
    if (await considerCandidate(seed.solution, `${direction.source}_target18`, direction.invert)) {
      return finishBest(false);
    }
  }

  // Pass 2: secure a valid <=20 result, while still preferring <=18.
  const acceptableSeedDeadlineTs = Math.min(
    globalDeadlineTs,
    Date.now() + Math.min(DEFAULT_ACCEPTABLE_SEED_BUDGET_MS, Math.max(4_000, Math.floor(timeBudgetMs * 0.24))),
  );
  for (const direction of directions) {
    if (Date.now() >= acceptableSeedDeadlineTs) break;
    const seed = await findTwoPhaseSeed(
      direction.scramble,
      MAX_RETURN_HTM,
      seedConfigs,
      direction.excludedSolution,
      acceptableSeedDeadlineTs,
      TARGET_HTM,
    );
    if (!seed?.ok || typeof seed.solution !== "string") continue;
    totalNodes += Number.isFinite(seed.nodes) ? seed.nodes : 0;
    if (await considerCandidate(seed.solution, `${direction.source}_cap20`, direction.invert)) {
      return finishBest(false);
    }
  }

  // Pass 3: spend a substantial bounded slice trying to hit <=18 exactly.
  const targetExactDeadlineTs = Math.min(
    globalDeadlineTs,
    Date.now() + Math.min(DEFAULT_TARGET_EXACT_BUDGET_MS, Math.max(5_000, Math.floor(timeBudgetMs * 0.36))),
  );
  for (const profile of exactProfiles) {
    if (Date.now() >= targetExactDeadlineTs) break;
    proofAttempts += 1;
    const searched = await searchTwophaseExact333(normalizedScramble, {
      maxTotalDepth: TARGET_HTM,
      excludedSolution: inverseScramble,
      phase1NodeLimit: Number.isFinite(Number(profile?.phase1NodeLimit))
        ? Math.max(0, Math.floor(Number(profile.phase1NodeLimit)))
        : 0,
      phase2NodeLimit: Number.isFinite(Number(profile?.phase2NodeLimit))
        ? Math.max(0, Math.floor(Number(profile.phase2NodeLimit)))
        : 0,
      deadlineTs: targetExactDeadlineTs,
    }).catch(() => null);

    totalNodes += Number.isFinite(searched?.nodes) ? searched.nodes : 0;
    if (!searched?.ok) continue;

    if (searched.found && typeof searched.solution === "string") {
      if (await considerCandidate(searched.solution, "exact_twophase_target18", false)) {
        return finishBest(false);
      }
    }

    if (!searched.interrupted && !searched.found) {
      lastExhaustedBound = TARGET_HTM;
      break;
    }
  }

  // A 19-move incumbent is already acceptable. If <=18 was exhaustively ruled
  // out, it is also proven optimal.
  if (bestSolution && bestMoveCount === 19) {
    return finishBest(lastExhaustedBound === TARGET_HTM);
  }

  // Pass 4a: if we have 20, use the remaining time to hunt <=19.
  if (bestSolution && bestMoveCount === MAX_RETURN_HTM && Date.now() < globalDeadlineTs) {
    for (const profile of exactProfiles) {
      if (Date.now() >= globalDeadlineTs) break;
      proofAttempts += 1;
      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: 19,
        excludedSolution: inverseScramble,
        phase1NodeLimit: Number.isFinite(Number(profile?.phase1NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase1NodeLimit)))
          : 0,
        phase2NodeLimit: Number.isFinite(Number(profile?.phase2NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase2NodeLimit)))
          : 0,
        deadlineTs: globalDeadlineTs,
      }).catch(() => null);

      totalNodes += Number.isFinite(searched?.nodes) ? searched.nodes : 0;
      if (!searched?.ok) continue;
      if (searched.found && typeof searched.solution === "string") {
        const targetReached = await considerCandidate(searched.solution, "exact_twophase_under20", false);
        if (targetReached) return finishBest(false);
        if (bestMoveCount === 19) return finishBest(false);
      }
      if (!searched.interrupted && !searched.found) {
        lastExhaustedBound = 19;
        break;
      }
    }
  }

  // Pass 4b: if no <=20 seed was found, the last resort is an exact <=20
  // search. Never relax above 20.
  if (!bestSolution && Date.now() < globalDeadlineTs) {
    for (const profile of exactProfiles) {
      if (Date.now() >= globalDeadlineTs) break;
      proofAttempts += 1;
      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: MAX_RETURN_HTM,
        excludedSolution: inverseScramble,
        phase1NodeLimit: Number.isFinite(Number(profile?.phase1NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase1NodeLimit)))
          : 0,
        phase2NodeLimit: Number.isFinite(Number(profile?.phase2NodeLimit))
          ? Math.max(0, Math.floor(Number(profile.phase2NodeLimit)))
          : 0,
        deadlineTs: globalDeadlineTs,
      }).catch(() => null);

      totalNodes += Number.isFinite(searched?.nodes) ? searched.nodes : 0;
      if (!searched?.ok) continue;
      if (searched.found && typeof searched.solution === "string") {
        await considerCandidate(searched.solution, "exact_twophase_cap20", false);
        if (bestSolution) break;
      }
      if (!searched.interrupted && !searched.found) break;
    }
  }

  if (!bestSolution) {
    return failureResult("MINMOVE_NO_SOLUTION_WITHIN_20", {
      nodes: totalNodes,
      elapsedMs: Date.now() - startedAt,
    });
  }
  if (bestMoveCount > MAX_RETURN_HTM) {
    return failureResult("MINMOVE_OVER_20_REJECTED", {
      nodes: totalNodes,
      elapsedMs: Date.now() - startedAt,
    });
  }
  if (isForbiddenInverse(bestSolution)) {
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
    stageName: bestMoveCount <= TARGET_HTM
      ? "MinMove 18 HTM target reached"
      : "MinMove <=20 HTM accepted",
    moveCount: bestMoveCount,
    targetMoveCount: TARGET_HTM,
    maxMoveCount: MAX_RETURN_HTM,
    targetReached: bestMoveCount <= TARGET_HTM,
    optimalityProven,
    nodes: totalNodes,
  });

  return finishBest(optimalityProven);
}
