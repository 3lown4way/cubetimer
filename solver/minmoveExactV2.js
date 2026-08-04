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
  { maxPhase1Solutions: 2_048, phase1MaxDepth: 18, phase1NodeLimit: 80_000_000, phase2NodeLimit: 100_000_000 },
  { maxPhase1Solutions: 8_192, phase1MaxDepth: 19, phase1NodeLimit: 250_000_000, phase2NodeLimit: 250_000_000 },
];
const DEFAULT_EXACT_PROFILES = [
  { phase1NodeLimit: 1_000_000, phase2NodeLimit: 8_000_000 },
  { phase1NodeLimit: 4_000_000, phase2NodeLimit: 32_000_000 },
  { phase1NodeLimit: 16_000_000, phase2NodeLimit: 128_000_000 },
  { phase1NodeLimit: 64_000_000, phase2NodeLimit: 512_000_000 },
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

function normalizeExactSearchState(searched) {
  const status = String(searched?.status || "").trim().toLowerCase();
  return {
    found: searched?.found === true || status === "found",
    interrupted: searched?.interrupted === true || status === "interrupted",
    exhausted: searched?.exhausted === true || status === "exhausted",
    status,
  };
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

async function findTwoPhaseSeed(scramble, incumbentLength, seedConfigs) {
  for (const config of seedConfigs) {
    let searchId = null;
    try {
      const prepared = await prepareTwophase333(scramble, {
        maxPhase1Solutions: config.maxPhase1Solutions,
        phase1MaxDepth: config.phase1MaxDepth,
        phase1NodeLimit: config.phase1NodeLimit,
      });
      if (!prepared?.ok || !Number.isFinite(prepared.searchId)) continue;
      searchId = prepared.searchId;
      const searched = await searchTwophase333(searchId, {
        incumbentLength,
        phase2MaxDepth: 20,
        phase2NodeLimit: config.phase2NodeLimit,
      });
      if (searched?.ok && typeof searched.solution === "string") {
        return searched;
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
  const exactProfiles = Array.isArray(options.exactProfiles) && options.exactProfiles.length
    ? options.exactProfiles
    : DEFAULT_EXACT_PROFILES;

  const ready = await ensureTwophase333Ready().catch(() => null);
  if (!ready) return { ok: false, reason: "MINMOVE_TWOPHASE_UNAVAILABLE" };

  let incumbentSolution = inverseScramble;
  let incumbentLength = splitMoves(incumbentSolution).length;
  let incumbentSource = "inverse_scramble";
  let totalNodes = 0;

  emitProgress(onProgress, {
    type: "upper_bound_start",
    stageName: "Exact minmove v2 seed",
    upperBoundLength: incumbentLength,
  });

  for (const direction of [
    { scramble: normalizedScramble, invert: false, source: "twophase_seed" },
    { scramble: inverseScramble, invert: true, source: "inverse_twophase_seed" },
  ]) {
    if (Date.now() >= deadlineTs) break;
    const seed = await findTwoPhaseSeed(direction.scramble, incumbentLength, seedConfigs);
    if (!seed?.ok || typeof seed.solution !== "string") continue;
    totalNodes += Number.isFinite(seed.nodes) ? seed.nodes : 0;
    const candidateSolution = direction.invert ? invertAlgorithm(seed.solution) : seed.solution.trim();
    const candidateLength = splitMoves(candidateSolution).length;
    if (!candidateSolution || candidateLength >= incumbentLength) continue;
    if (!(await verifySolution(normalizedScramble, candidateSolution))) continue;
    incumbentSolution = candidateSolution;
    incumbentLength = candidateLength;
    incumbentSource = direction.source;
  }

  if (!(await verifySolution(normalizedScramble, incumbentSolution))) {
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

    for (const profile of exactProfiles) {
      if (Date.now() >= deadlineTs) break;
      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: targetBound,
        phase1NodeLimit: profile.phase1NodeLimit,
        phase2NodeLimit: profile.phase2NodeLimit,
      }).catch(() => null);
      if (!searched?.ok) {
        lastReason = searched?.reason || "MINMOVE_EXACT_SEARCH_FAILED";
        continue;
      }
      totalNodes += Number.isFinite(searched.nodes) ? searched.nodes : 0;
      const exactState = normalizeExactSearchState(searched);

      if (exactState.found && typeof searched.solution === "string") {
        const candidateSolution = searched.solution.trim();
        const candidateLength = splitMoves(candidateSolution).length;
        if (
          candidateSolution
          && candidateLength <= targetBound
          && candidateLength < incumbentLength
          && await verifySolution(normalizedScramble, candidateSolution)
        ) {
          incumbentSolution = candidateSolution;
          incumbentLength = candidateLength;
          incumbentSource = "exact_twophase_bound";
          improved = true;
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

      if (exactState.exhausted) {
        exhausted = true;
        break;
      }
      if (exactState.interrupted) {
        lastReason = searched.reason || "MINMOVE_EXACT_SEARCH_LIMIT";
        continue;
      }
      lastReason = searched.reason || "MINMOVE_EXACT_STATUS_MISSING";
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
        elapsedMs,
      };
    }

    return notProvenResult(incumbentSolution, incumbentLength, {
      nodes: totalNodes,
      bound: targetBound,
      interruptedReason: lastReason || "MINMOVE_EXACT_SEARCH_LIMIT",
      elapsedMs: Date.now() - startedAt,
    });
  }

  return notProvenResult(incumbentSolution, incumbentLength, {
    nodes: totalNodes,
    bound: Math.max(0, incumbentLength - 1),
    interruptedReason: "MINMOVE_EXACT_TIMEOUT",
    elapsedMs: Date.now() - startedAt,
  });
}
