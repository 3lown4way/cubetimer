import { getDefaultPattern } from "./context.js";
import { solveWithExternalSearch } from "./externalSolver.js";

const FMC_PREMOVE_SETS = [
  ["U"],
  ["U'"],
  ["U2"],
  ["R"],
  ["R'"],
  ["R2"],
  ["F"],
  ["F'"],
  ["F2"],
  ["U", "R"],
  ["R", "U"],
  ["U", "F"],
  ["F", "U"],
  ["R", "F"],
  ["F", "R"],
];

let solvedPatternPromise = null;

function splitMoves(alg) {
  if (!alg || typeof alg !== "string") return [];
  return alg
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function joinMoves(parts) {
  return parts
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMove(move) {
  if (!move || typeof move !== "string") return null;
  const match = /^([A-Za-z]+)(2'?|')?$/.exec(move);
  if (!match) return null;
  const suffix = match[2];
  const amount = suffix === "'" ? 3 : suffix === "2" || suffix === "2'" ? 2 : 1;
  return { face: match[1], amount };
}

function formatMove(face, amount) {
  if (!face) return null;
  if (amount === 1) return face;
  if (amount === 2) return `${face}2`;
  if (amount === 3) return `${face}'`;
  return null;
}

function simplifyMoves(moves) {
  if (!Array.isArray(moves) || !moves.length) return [];
  const stack = [];
  for (const move of moves) {
    const parsed = parseMove(move);
    if (!parsed) {
      stack.push({ face: null, raw: move });
      continue;
    }
    if (!stack.length || stack[stack.length - 1].face !== parsed.face) {
      const normalized = parsed.amount % 4;
      if (normalized) {
        stack.push({ face: parsed.face, amount: normalized });
      }
      continue;
    }
    const top = stack[stack.length - 1];
    const combined = (top.amount + parsed.amount) % 4;
    if (combined === 0) {
      stack.pop();
    } else {
      top.amount = combined;
    }
  }
  return stack
    .map((entry) => (entry.face ? formatMove(entry.face, entry.amount) : entry.raw))
    .filter(Boolean);
}

function invertToken(token) {
  if (!token) return token;
  if (token.endsWith("2")) return token;
  if (token.endsWith("'")) return token.slice(0, -1);
  return `${token}'`;
}

function invertMoves(moves) {
  const out = [];
  for (let i = moves.length - 1; i >= 0; i -= 1) {
    out.push(invertToken(moves[i]));
  }
  return out;
}

function invertAlg(algText) {
  return joinMoves(invertMoves(splitMoves(algText)));
}

async function getSolvedPattern() {
  if (!solvedPatternPromise) {
    solvedPatternPromise = getDefaultPattern("333");
  }
  return solvedPatternPromise;
}

function normalizeCandidateMoves(moves) {
  return simplifyMoves(Array.isArray(moves) ? moves : []);
}

function createCandidate(source, strategy, moves) {
  const normalized = normalizeCandidateMoves(moves);
  if (!normalized.length) return null;
  return {
    source,
    strategy,
    moves: normalized,
    solution: joinMoves(normalized),
    moveCount: normalized.length,
  };
}

async function verifyCandidate(scramble, candidate) {
  if (!candidate || !candidate.solution) return false;
  try {
    const solvedPattern = await getSolvedPattern();
    const afterScramble = solvedPattern.applyAlg(scramble);
    const afterSolution = afterScramble.applyAlg(candidate.solution);
    if (typeof afterSolution.experimentalIsSolved === "function") {
      return !!afterSolution.experimentalIsSolved({ ignorePuzzleOrientation: false });
    }
    return JSON.stringify(afterSolution.patternData) === JSON.stringify(solvedPattern.patternData);
  } catch (_) {
    return false;
  }
}

function pushUniqueCandidate(list, candidate) {
  if (!candidate) return;
  if (!list.some((existing) => existing.solution === candidate.solution)) {
    list.push(candidate);
  }
}

async function solveExternal333(scrambleText) {
  try {
    const result = await solveWithExternalSearch(scrambleText, "333");
    return result?.ok ? result : null;
  } catch (_) {
    return null;
  }
}

export async function solveWithFMCSearch(scramble, onProgress, options = {}) {
  const maxPremoveSets = Number.isFinite(options.maxPremoveSets)
    ? Math.max(0, Math.floor(options.maxPremoveSets))
    : FMC_PREMOVE_SETS.length;
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(1000, Math.floor(options.timeBudgetMs))
    : 90000;
  const startedAt = Date.now();
  const inverseScramble = invertAlg(scramble);
  const candidates = [];
  let attempts = 0;
  const totalStages = 3;
  let bestMoveCount = Infinity;

  const notify = (progress) => {
    if (typeof onProgress !== "function") return;
    try {
      void onProgress(progress);
    } catch (_) {
      // Progress callbacks are best-effort.
    }
  };

  const trackCandidate = (candidate) => {
    if (!candidate) return;
    pushUniqueCandidate(candidates, candidate);
    if (candidate.moveCount < bestMoveCount) {
      bestMoveCount = candidate.moveCount;
    }
  };

  notify({ type: "stage_start", stageIndex: 0, totalStages, stageName: "FMC Direct" });
  const direct = await solveExternal333(scramble);
  attempts += 1;
  if (direct?.solution) {
    trackCandidate(createCandidate("FMC_DIRECT", "direct", splitMoves(direct.solution)));
  }
  notify({
    type: "stage_done",
    stageIndex: 0,
    totalStages,
    stageName: "FMC Direct",
    moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
  });

  notify({ type: "stage_start", stageIndex: 1, totalStages, stageName: "FMC NISS" });
  const inverse = await solveExternal333(inverseScramble);
  attempts += 1;
  if (inverse?.solution) {
    trackCandidate(createCandidate("FMC_NISS", "inverse", invertMoves(splitMoves(inverse.solution))));
  }
  notify({
    type: "stage_done",
    stageIndex: 1,
    totalStages,
    stageName: "FMC NISS",
    moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
  });

  notify({ type: "stage_start", stageIndex: 2, totalStages, stageName: "FMC Premove Sweep" });
  for (let i = 0; i < FMC_PREMOVE_SETS.length && i < maxPremoveSets; i += 1) {
    if (Date.now() - startedAt >= timeBudgetMs) break;
    const premove = FMC_PREMOVE_SETS[i];

    const directScrambleWithPremove = joinMoves([scramble, ...premove]);
    const directWithPremove = await solveExternal333(directScrambleWithPremove);
    attempts += 1;
    if (directWithPremove?.solution) {
      const moves = premove.concat(splitMoves(directWithPremove.solution));
      trackCandidate(createCandidate("FMC_PREMOVE_DIRECT", `premove:${joinMoves(premove)}`, moves));
    }

    if (Date.now() - startedAt >= timeBudgetMs) break;

    const inverseScrambleWithPremove = joinMoves([inverseScramble, ...premove]);
    const inverseWithPremove = await solveExternal333(inverseScrambleWithPremove);
    attempts += 1;
    if (inverseWithPremove?.solution) {
      const moves = invertMoves(splitMoves(inverseWithPremove.solution)).concat(invertMoves(premove));
      trackCandidate(createCandidate("FMC_PREMOVE_NISS", `niss:${joinMoves(premove)}`, moves));
    }
  }
  notify({
    type: "stage_done",
    stageIndex: 2,
    totalStages,
    stageName: "FMC Premove Sweep",
    moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
  });

  candidates.sort((a, b) => {
    if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
    return a.solution.localeCompare(b.solution);
  });

  const validCandidates = [];
  const verifyLimit = Math.min(candidates.length, 8);
  for (let i = 0; i < verifyLimit; i += 1) {
    const candidate = candidates[i];
    if (await verifyCandidate(scramble, candidate)) {
      validCandidates.push(candidate);
    }
  }
  if (!validCandidates.length) {
    return {
      ok: false,
      reason: "FMC_NO_VALID_SOLUTION",
      attempts,
    };
  }

  const best = validCandidates[0];
  const candidateLines = validCandidates
    .slice(0, 3)
    .map((candidate, index) => `${index + 1}. ${candidate.moveCount}수 [${candidate.source}] ${candidate.solution}`);

  return {
    ok: true,
    solution: best.solution,
    moveCount: best.moveCount,
    nodes: 0,
    bound: best.moveCount,
    source: best.source,
    attempts,
    stages: [
      { name: "FMC Direct", solution: direct?.solution || "-" },
      { name: "FMC NISS", solution: inverse?.solution ? invertAlg(inverse.solution) : "-" },
      { name: "FMC Best", solution: best.solution },
    ],
    solutionDisplay: [best.solution, "", "Top Candidates", ...candidateLines].join("\n"),
  };
}
