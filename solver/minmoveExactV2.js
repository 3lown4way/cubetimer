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

const DEFAULT_TIME_BUDGET_MS = 90_000;
const DEFAULT_SEED_CONFIGS = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 768, phase1MaxDepth: 18, phase1NodeLimit: 16_000_000, phase2NodeLimit: 80_000_000 },
];
const DEFAULT_EXACT_PROFILES = [
  { phase1NodeLimit: 1_000_000, phase2NodeLimit: 8_000_000 },
  { phase1NodeLimit: 4_000_000, phase2NodeLimit: 32_000_000 },
  { phase1NodeLimit: 16_000_000, phase2NodeLimit: 128_000_000 },
];
const DEADLINE_ONLY_EXACT_PROFILE = Object.freeze({
  phase1NodeLimit: 0,
  phase2NodeLimit: 0,
  deadlineOnly: true,
});

function normalizeNodeLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function buildExactProfiles(configuredProfiles, useFullProofBudget) {
  const profiles = configuredProfiles.map((profile) => ({
    phase1NodeLimit: normalizeNodeLimit(profile?.phase1NodeLimit),
    phase2NodeLimit: normalizeNodeLimit(profile?.phase2NodeLimit),
    deadlineOnly: profile?.deadlineOnly === true,
  }));
  if (
    useFullProofBudget
    && !profiles.some((profile) => profile.phase1NodeLimit === 0 && profile.phase2NodeLimit === 0)
  ) {
    profiles.push({ ...DEADLINE_ONLY_EXACT_PROFILE });
  }
  return profiles;
}

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
  incumbentLength,
  seedConfigs,
  excludedSolution = "",
  deadlineTs = null,
) {
  const normalizedExcluded = normalizeOuterAlgorithm(excludedSolution);
  for (const config of seedConfigs) {
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
        incumbentLength,
        excludedSolution: normalizedExcluded || undefined,
        strictIncumbent: false,
        phase2MaxDepth: 20,
        phase2NodeLimit: config.phase2NodeLimit,
        ...(Number.isFinite(deadlineTs) ? { deadlineTs } : {}),
      });
      if (searched?.ok && typeof searched.solution === "string") {
        const normalizedSolution = normalizeOuterAlgorithm(searched.solution);
        const candidateLength = splitMoves(normalizedSolution).length;
        if (!normalizedSolution) continue;
        if (normalizedExcluded && normalizedSolution === normalizedExcluded) continue;
        return {
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
  return null;
}

function notProvenResult(candidateSolution, candidateMoveCount, meta = {}) {
  return {
    ok: false,
    reason: "MINMOVE_NOT_PROVEN",
    solution: "",
    moveCount: 0,
    candidateSolution,
    candidateMoveCount,
    nodes: Number.isFinite(meta.nodes) ? meta.nodes : 0,
    bound: Number.isFinite(meta.bound) ? meta.bound : Math.max(0, candidateMoveCount - 1),
    source: "MINMOVE_333_EXACT_TWOPHASE_V2",
    metric: "HTM",
    optimalityProven: false,
    upperBoundLength: candidateMoveCount,
    proofSource: "exact_twophase_incomplete",
    fallbackReason: null,
    interruptedReason: meta.interruptedReason ? String(meta.interruptedReason) : null,
    proofAttempts: Number.isFinite(meta.proofAttempts) ? Math.max(0, Math.floor(meta.proofAttempts)) : 0,
    timeBudgetMs: Number.isFinite(meta.timeBudgetMs) ? Math.max(0, Math.floor(meta.timeBudgetMs)) : 0,
    budgetExhausted: meta.budgetExhausted === true,
    elapsedMs: Number.isFinite(meta.elapsedMs) ? meta.elapsedMs : 0,
  };
}

export async function solveMinmoveExactV2(scramble, onProgress = null, options = {}) {
  const normalizedScramble = splitMoves(scramble).join(" ");
  const inverseScramble = invertAlgorithm(normalizedScramble);
  if (!normalizedScramble || !inverseScramble) {
    return { ok: false, reason: "MINMOVE_BAD_SCRAMBLE" };
  }

  const startedAt = Date.now();
  const timeBudgetMs = Number.isFinite(Number(options.timeBudgetMs))
    ? Math.max(1_000, Math.floor(Number(options.timeBudgetMs)))
    : DEFAULT_TIME_BUDGET_MS;
  const deadlineTs = startedAt + timeBudgetMs;
  const seedConfigs = Array.isArray(options.seedConfigs) && options.seedConfigs.length
    ? options.seedConfigs
    : DEFAULT_SEED_CONFIGS;
  const configuredExactProfiles = Array.isArray(options.exactProfiles) && options.exactProfiles.length
    ? options.exactProfiles
    : DEFAULT_EXACT_PROFILES;
  const useFullProofBudget = options.useFullProofBudget !== false;
  const exactProfiles = buildExactProfiles(configuredExactProfiles, useFullProofBudget);

  const ready = await ensureTwophase333Ready().catch(() => null);
  if (!ready) return { ok: false, reason: "MINMOVE_TWOPHASE_UNAVAILABLE" };

  const inverseUpperBoundLength = splitMoves(inverseScramble).length;
  const rejectLiteralInverse = inverseUpperBoundLength > LITERAL_INVERSE_EXEMPT_MOVE_COUNT;
  let incumbentSolution = rejectLiteralInverse ? "" : inverseScramble;
  let incumbentLength = inverseUpperBoundLength;
  let incumbentSource = rejectLiteralInverse ? "inverse_upper_bound_only" : "short_inverse_exception";
  let totalNodes = 0;
  let proofAttempts = 0;

  emitProgress(onProgress, {
    type: "upper_bound_start",
    stageName: "Exact minmove v2 seed",
    upperBoundLength: incumbentLength,
  });

  for (const direction of [
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
  ]) {
    if (Date.now() >= deadlineTs) break;
    const seed = await findTwoPhaseSeed(
      direction.scramble,
      incumbentLength,
      seedConfigs,
      direction.excludedSolution,
      deadlineTs,
    );
    if (!seed?.ok || typeof seed.solution !== "string") continue;
    totalNodes += Number.isFinite(seed.nodes) ? seed.nodes : 0;
    const candidateSolution = direction.invert ? invertAlgorithm(seed.solution) : seed.solution.trim();
    const candidateLength = splitMoves(candidateSolution).length;
    if (!candidateSolution || (incumbentSolution && candidateLength > incumbentLength)) continue;
    if (shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)) continue;
    if (!(await verifySolution(normalizedScramble, candidateSolution))) continue;
    incumbentSolution = candidateSolution;
    incumbentLength = candidateLength;
    incumbentSource = direction.source;
  }

  if (!incumbentSolution) {
    return {
      ok: false,
      reason: "MINMOVE_NONTRIVIAL_SEED_NOT_FOUND",
      solution: "",
      moveCount: 0,
      inverseUpperBoundLength,
      optimalityProven: false,
      fallbackReason: null,
      elapsedMs: Date.now() - startedAt,
    };
  }
  if (
    shouldRejectLiteralInverseSolution(normalizedScramble, incumbentSolution)
    || !(await verifySolution(normalizedScramble, incumbentSolution))
  ) {
    return { ok: false, reason: "MINMOVE_SEED_INVALID" };
  }

  emitProgress(onProgress, {
    type: "upper_bound_done",
    upperBoundLength: incumbentLength,
    upperBoundSource: incumbentSource,
  });
  emitProgress(onProgress, {
    type: "exact_search_start",
    upperBoundLength: incumbentLength,
    proofEngine: "exact_twophase_v2",
  });

  while (incumbentLength > 0 && Date.now() < deadlineTs) {
    const targetBound = incumbentLength - 1;
    let exhausted = false;
    let improved = false;
    let lastReason = "";

    emitProgress(onProgress, {
      type: "bound_update",
      bound: targetBound,
      upperBoundLength: incumbentLength,
      nodes: totalNodes,
    });

    for (let profileIndex = 0; profileIndex < exactProfiles.length; profileIndex += 1) {
      if (Date.now() >= deadlineTs) break;
      const profile = exactProfiles[profileIndex];
      proofAttempts += 1;
      emitProgress(onProgress, {
        type: "proof_profile_start",
        bound: targetBound,
        profileIndex,
        phase1NodeLimit: profile.phase1NodeLimit,
        phase2NodeLimit: profile.phase2NodeLimit,
        deadlineOnly: profile.deadlineOnly === true,
        remainingMs: Math.max(0, deadlineTs - Date.now()),
      });

      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: targetBound,
        excludedSolution: rejectLiteralInverse ? inverseScramble : undefined,
        phase1NodeLimit: profile.phase1NodeLimit,
        phase2NodeLimit: profile.phase2NodeLimit,
        deadlineTs,
      }).catch(() => null);
      const searchedReason = searched?.reason || "MINMOVE_EXACT_SEARCH_FAILED";
      const searchedNodes = Number.isFinite(searched?.nodes) ? searched.nodes : 0;
      totalNodes += searchedNodes;
      const timedOut = searched?.timedOut === true || searchedReason === "TWOPHASE_DEADLINE_REACHED";
      if (timedOut) {
        lastReason = "TWOPHASE_DEADLINE_REACHED";
        emitProgress(onProgress, {
          type: "proof_profile_done",
          bound: targetBound,
          profileIndex,
          status: "timeout",
          reason: lastReason,
          nodes: searchedNodes,
        });
        break;
      }
      if (!searched?.ok) {
        lastReason = searchedReason;
        emitProgress(onProgress, {
          type: "proof_profile_done",
          bound: targetBound,
          profileIndex,
          status: "failed",
          reason: lastReason,
          nodes: searchedNodes,
        });
        continue;
      }
      if (searched.found && typeof searched.solution === "string") {
        const candidateSolution = searched.solution.trim();
        const candidateLength = splitMoves(candidateSolution).length;
        if (
          candidateSolution
          && candidateLength <= targetBound
          && candidateLength < incumbentLength
          && !shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)
          && await verifySolution(normalizedScramble, candidateSolution)
        ) {
          incumbentSolution = candidateSolution;
          incumbentLength = candidateLength;
          incumbentSource = "exact_twophase_bound";
          improved = true;
          emitProgress(onProgress, {
            type: "proof_profile_done",
            bound: targetBound,
            profileIndex,
            status: "improved",
            moveCount: incumbentLength,
            nodes: searchedNodes,
          });
          emitProgress(onProgress, {
            type: "exact_search_improved",
            moveCount: incumbentLength,
            bound: targetBound,
            nodes: totalNodes,
          });
          break;
        }
        return { ok: false, reason: "MINMOVE_EXACT_RESULT_INVALID" };
      }

      if (!searched.interrupted) {
        exhausted = true;
        emitProgress(onProgress, {
          type: "proof_profile_done",
          bound: targetBound,
          profileIndex,
          status: "exhausted",
          nodes: searchedNodes,
        });
        break;
      }
      lastReason = searchedReason || "MINMOVE_EXACT_SEARCH_LIMIT";
      emitProgress(onProgress, {
        type: "proof_profile_done",
        bound: targetBound,
        profileIndex,
        status: "interrupted",
        reason: lastReason,
        nodes: searchedNodes,
      });
    }

    if (improved) continue;
    if (exhausted) {
      const elapsedMs = Date.now() - startedAt;
      emitProgress(onProgress, {
        type: "optimality_proven",
        moveCount: incumbentLength,
        proofSource: "exact_twophase_exhaustion",
        nodes: totalNodes,
      });
      if (shouldRejectLiteralInverseSolution(normalizedScramble, incumbentSolution)) {
        return { ok: false, reason: "MINMOVE_LITERAL_INVERSE_REJECTED" };
      }
      return {
        ok: true,
        solution: incumbentSolution,
        moveCount: incumbentLength,
        nodes: totalNodes,
        bound: incumbentLength,
        source: "MINMOVE_333_EXACT_TWOPHASE_V2",
        metric: "HTM",
        optimalityProven: true,
        upperBoundLength: incumbentLength,
        proofSource: "exact_twophase_exhaustion",
        fallbackReason: null,
        seedSource: incumbentSource,
        proofAttempts,
        timeBudgetMs,
        elapsedMs,
      };
    }

    return notProvenResult(incumbentSolution, incumbentLength, {
      nodes: totalNodes,
      bound: targetBound,
      interruptedReason: lastReason || "MINMOVE_EXACT_SEARCH_LIMIT",
      proofAttempts,
      timeBudgetMs,
      budgetExhausted: Date.now() >= deadlineTs || lastReason === "TWOPHASE_DEADLINE_REACHED",
      elapsedMs: Date.now() - startedAt,
    });
  }

  return notProvenResult(incumbentSolution, incumbentLength, {
    nodes: totalNodes,
    bound: Math.max(0, incumbentLength - 1),
    interruptedReason: "MINMOVE_EXACT_TIMEOUT",
    proofAttempts,
    timeBudgetMs,
    budgetExhausted: true,
    elapsedMs: Date.now() - startedAt,
  });
}
