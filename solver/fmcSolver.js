import { getDefaultPattern } from "./context.js";
import { solve3x3StrictCfopFromPattern } from "./cfop3x3.js";
import { solve3x3InternalPhase } from "./solver3x3Phase/index.js";
import { MOVE_NAMES } from "./moves.js";

const FMC_PREMOVE_TURNS = ["", "'", "2"];
const FMC_PREMOVE_SINGLE_FACES = ["U", "R", "F", "D", "L", "B"];
const FMC_PREMOVE_PAIR_FACES = [
  ["U", "R"],
  ["R", "U"],
  ["U", "F"],
  ["F", "U"],
  ["R", "F"],
  ["F", "R"],
  ["D", "L"],
  ["L", "D"],
  ["D", "B"],
  ["B", "D"],
  ["L", "B"],
  ["B", "L"],
  ["U", "D"],
  ["D", "U"],
  ["R", "L"],
  ["L", "R"],
  ["F", "B"],
  ["B", "F"],
];

function buildFmcPremoveSets() {
  const sets = [];
  const seen = new Set();
  const pushSet = (moves) => {
    const normalized = simplifyMoves(moves);
    if (!normalized.length || normalized.length > 2) return;
    const key = normalized.join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    sets.push(normalized);
  };

  for (let i = 0; i < FMC_PREMOVE_SINGLE_FACES.length; i += 1) {
    const face = FMC_PREMOVE_SINGLE_FACES[i];
    for (let t = 0; t < FMC_PREMOVE_TURNS.length; t += 1) {
      pushSet([`${face}${FMC_PREMOVE_TURNS[t]}`]);
    }
  }

  for (let a = 0; a < FMC_PREMOVE_TURNS.length; a += 1) {
    for (let b = 0; b < FMC_PREMOVE_TURNS.length; b += 1) {
      for (let i = 0; i < FMC_PREMOVE_PAIR_FACES.length; i += 1) {
        const [faceA, faceB] = FMC_PREMOVE_PAIR_FACES[i];
        const first = `${faceA}${FMC_PREMOVE_TURNS[a]}`;
        const second = `${faceB}${FMC_PREMOVE_TURNS[b]}`;
        pushSet([first, second]);
      }
    }
  }

  return sets;
}

const FMC_PREMOVE_SETS = buildFmcPremoveSets();
const FMC_PHASE_PROFILES = [
  {
    id: "phase-micro",
    phase1MaxDepth: 11,
    phase2MaxDepth: 16,
    phase1NodeLimit: 220000,
    phase2NodeLimit: 320000,
  },
  {
    id: "phase-light",
    phase1MaxDepth: 12,
    phase2MaxDepth: 18,
    phase1NodeLimit: 700000,
    phase2NodeLimit: 1200000,
  },
  {
    id: "phase-mid",
    phase1MaxDepth: 13,
    phase2MaxDepth: 19,
    phase1NodeLimit: 2500000,
    phase2NodeLimit: 4500000,
  },
  {
    id: "phase-deep",
    phase1MaxDepth: 13,
    phase2MaxDepth: 20,
    phase1NodeLimit: 6000000,
    phase2NodeLimit: 10000000,
  },
  {
    id: "phase-xdeep",
    phase1MaxDepth: 14,
    phase2MaxDepth: 21,
    phase1NodeLimit: 12000000,
    phase2NodeLimit: 20000000,
  },
];

let solvedPatternPromise = null;
const FMC_INSERTION_MOVE_NAMES = MOVE_NAMES.slice();

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

function applyMovesToPattern(pattern, moves) {
  if (!pattern || !Array.isArray(moves) || !moves.length) return pattern;
  let current = pattern;
  for (let i = 0; i < moves.length; i += 1) {
    current = current.applyMove(moves[i]);
  }
  return current;
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`TIMEOUT_${timeoutMs}MS`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function remainingMs(deadlineTs) {
  if (!Number.isFinite(deadlineTs)) return Infinity;
  return deadlineTs - Date.now();
}

function clampAttemptDeadline(deadlineTs, attemptMs, reserveMs = 120) {
  const now = Date.now();
  if (!Number.isFinite(deadlineTs)) {
    return now + Math.max(100, Math.floor(attemptMs));
  }
  const remaining = deadlineTs - now;
  if (remaining <= reserveMs) return now;
  const bounded = Math.max(80, Math.min(Math.floor(attemptMs), remaining - reserveMs));
  return now + bounded;
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

function orbitStateKey(orbit) {
  if (!orbit) return "";
  const pieces = Array.isArray(orbit.pieces) ? orbit.pieces : [];
  const orientation = Array.isArray(orbit.orientation) ? orbit.orientation : [];
  return `${pieces.join(",")}/${orientation.join(",")}`;
}

function patternStateKey(pattern) {
  const data = pattern?.patternData;
  if (!data) return "";
  return `C:${orbitStateKey(data.CORNERS)}|E:${orbitStateKey(data.EDGES)}|N:${orbitStateKey(data.CENTERS)}`;
}

function buildPatternFrontier(rootPattern, depthLimit, direction = "forward") {
  const map = new Map();
  const rootKey = patternStateKey(rootPattern);
  map.set(rootKey, []);
  if (!Number.isFinite(depthLimit) || depthLimit <= 0) return map;

  const queue = [{ pattern: rootPattern, path: [], depth: 0, lastFace: "" }];
  let head = 0;

  while (head < queue.length) {
    const node = queue[head++];
    if (node.depth >= depthLimit) continue;

    for (let i = 0; i < FMC_INSERTION_MOVE_NAMES.length; i += 1) {
      const move = FMC_INSERTION_MOVE_NAMES[i];
      const face = move[0];
      if (face === node.lastFace) continue;

      const stepMove = direction === "forward" ? move : invertToken(move);
      const nextPattern = node.pattern.applyMove(stepMove);
      const nextPath = direction === "forward" ? node.path.concat(move) : [move].concat(node.path);
      const key = patternStateKey(nextPattern);
      const existing = map.get(key);
      if (existing && existing.length <= nextPath.length) continue;
      map.set(key, nextPath);
      queue.push({
        pattern: nextPattern,
        path: nextPath,
        depth: node.depth + 1,
        lastFace: face,
      });
    }
  }

  return map;
}

function findShorterEquivalentSegment(startPattern, targetPattern, maxDepth, currentLength) {
  if (!Number.isFinite(maxDepth) || maxDepth <= 0 || currentLength <= 1) return null;
  const startKey = patternStateKey(startPattern);
  const targetKey = patternStateKey(targetPattern);
  if (!startKey || !targetKey) return null;
  if (startKey === targetKey) return [];

  const searchDepth = Math.max(1, Math.min(Math.floor(maxDepth), currentLength - 1));
  const forwardDepth = Math.floor(searchDepth / 2);
  const backwardDepth = searchDepth - forwardDepth;
  const forwardMap = buildPatternFrontier(startPattern, forwardDepth, "forward");
  const backwardMap = buildPatternFrontier(targetPattern, backwardDepth, "backward");

  let best = null;
  let bestText = "";

  for (const [key, leftPath] of forwardMap.entries()) {
    const rightPath = backwardMap.get(key);
    if (!rightPath) continue;
    const merged = leftPath.concat(rightPath);
    if (merged.length >= currentLength || merged.length > searchDepth) continue;
    const mergedText = joinMoves(merged);
    if (!best || merged.length < best.length || (merged.length === best.length && mergedText < bestText)) {
      best = merged;
      bestText = mergedText;
    }
  }

  return best;
}

function buildPatternStates(scramblePattern, moves) {
  const states = new Array(moves.length + 1);
  states[0] = scramblePattern;
  for (let i = 0; i < moves.length; i += 1) {
    states[i + 1] = states[i].applyMove(moves[i]);
  }
  return states;
}

function optimizeSolutionWithInsertions(scramblePattern, moves, options = {}) {
  let current = simplifyMoves(Array.isArray(moves) ? moves : []);
  if (!current.length) return current;

  const maxPasses = Number.isFinite(options.maxPasses) ? Math.max(1, Math.floor(options.maxPasses)) : 3;
  const minWindow = Number.isFinite(options.minWindow) ? Math.max(2, Math.floor(options.minWindow)) : 3;
  const maxWindow = Number.isFinite(options.maxWindow) ? Math.max(minWindow, Math.floor(options.maxWindow)) : 7;
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Math.floor(options.maxDepth)) : 6;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    const states = buildPatternStates(scramblePattern, current);
    const windowCap = Math.min(maxWindow, current.length);

    outer: for (let window = windowCap; window >= minWindow; window -= 1) {
      for (let start = 0; start + window <= current.length; start += 1) {
        const end = start + window;
        const depthCap = Math.min(maxDepth, window - 1);
        const replacement = findShorterEquivalentSegment(states[start], states[end], depthCap, window);
        if (!replacement) continue;
        const next = simplifyMoves(current.slice(0, start).concat(replacement, current.slice(end)));
        if (next.length >= current.length) continue;
        current = next;
        improved = true;
        break outer;
      }
    }

    if (!improved) break;
  }

  return current;
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
  const metadata = strategy && typeof strategy === "object" ? strategy : { tag: strategy };
  return {
    source,
    strategy: metadata.tag || "",
    usesCfop: !!metadata.usesCfop,
    innerSource: metadata.innerSource || "",
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

function selectPhaseProfiles(profileLevel) {
  const profileIdsByLevel = {
    micro: ["phase-micro"],
    light: ["phase-light"],
    medium: ["phase-light", "phase-mid"],
    deep: ["phase-light", "phase-mid", "phase-deep"],
    xdeep: ["phase-light", "phase-mid", "phase-deep", "phase-xdeep"],
  };
  const ids = profileIdsByLevel[profileLevel] || profileIdsByLevel.medium;
  const selected = [];
  for (let i = 0; i < ids.length; i += 1) {
    const profile = FMC_PHASE_PROFILES.find((entry) => entry.id === ids[i]);
    if (profile) selected.push(profile);
  }
  return selected;
}

function getPhaseAttemptScale(profileId) {
  if (profileId === "phase-mid") return 1.15;
  if (profileId === "phase-deep") return 1.35;
  if (profileId === "phase-xdeep") return 1.6;
  return 1;
}

async function solveInternal333(scrambleText, options = {}) {
  try {
    if (remainingMs(options.deadlineTs) <= 300) return null;
    let pattern = options.startPattern || null;
    if (!pattern) {
      const solvedPattern = await getSolvedPattern();
      if (!scrambleText || typeof scrambleText !== "string") return null;
      pattern = solvedPattern.applyAlg(scrambleText);
    }
    if (remainingMs(options.deadlineTs) <= 300) return null;
    const phaseProfiles = selectPhaseProfiles(options.profileLevel || "medium");
    const phaseAttemptTimeoutMs = Number.isFinite(options.phaseAttemptTimeoutMs)
      ? Math.max(600, Math.floor(options.phaseAttemptTimeoutMs))
      : 4000;
    const phaseTimeCheckInterval = Number.isFinite(options.phaseTimeCheckInterval)
      ? Math.max(128, Math.floor(options.phaseTimeCheckInterval))
      : 1024;
    const targetMoveCount = Number.isFinite(options.targetMoveCount)
      ? Math.max(1, Math.floor(options.targetMoveCount))
      : null;
    let bestPhase = null;

    for (let i = 0; i < phaseProfiles.length; i++) {
      const phaseRemaining = remainingMs(options.deadlineTs);
      const profile = phaseProfiles[i];
      if (phaseRemaining <= 350) break;
      const scaledAttemptTimeoutMs = Math.max(
        600,
        Math.floor(phaseAttemptTimeoutMs * getPhaseAttemptScale(profile.id)),
      );
      const phaseDeadlineTs = clampAttemptDeadline(options.deadlineTs, scaledAttemptTimeoutMs, 100);
      const phaseResult = await solve3x3InternalPhase(pattern, {
        ...profile,
        deadlineTs: phaseDeadlineTs,
        timeCheckInterval: phaseTimeCheckInterval,
      }).catch(() => null);
      if (phaseResult?.ok) {
        const phaseCandidate = {
          ...phaseResult,
          source: `INTERNAL_FMC_${profile.id.toUpperCase()}`,
        };
        const candidateMoveCount = Number.isFinite(phaseCandidate.moveCount)
          ? phaseCandidate.moveCount
          : splitMoves(phaseCandidate.solution).length;
        if (!bestPhase || candidateMoveCount < bestPhase.moveCount) {
          bestPhase = {
            ...phaseCandidate,
            moveCount: candidateMoveCount,
          };
        }
        if (targetMoveCount && bestPhase.moveCount <= targetMoveCount) {
          break;
        }
      }
    }

    if (bestPhase?.solution) return bestPhase;

    if (options.allowCfopFallback === false) {
      return null;
    }

    const crossColors =
      Array.isArray(options.crossColors) && options.crossColors.length
        ? options.crossColors
        : ["D"];
    const cfopPerColorTimeoutMs = Number.isFinite(options.cfopPerColorTimeoutMs)
      ? Math.max(700, Math.floor(options.cfopPerColorTimeoutMs))
      : 3000;
    let bestCfop = null;
    for (let i = 0; i < crossColors.length; i++) {
      const cfopRemaining = remainingMs(options.deadlineTs);
      if (cfopRemaining <= 900) break;
      const boundedCfopTimeoutMs = Math.max(700, Math.min(cfopPerColorTimeoutMs, cfopRemaining - 200));
      const crossColor = crossColors[i];
      const cfopResult = await withTimeout(
        solve3x3StrictCfopFromPattern(pattern, {
          crossColor,
          mode: "strict",
          f2lMethod: "legacy",
        }),
        boundedCfopTimeoutMs,
      ).catch(() => null);
      if (!cfopResult?.ok) continue;
      if (!bestCfop || cfopResult.moveCount < bestCfop.moveCount) {
        bestCfop = {
          ...cfopResult,
          source: "INTERNAL_FMC_CFOP_FALLBACK",
        };
      }
    }
    if (bestCfop?.ok) return bestCfop;
    return null;
  } catch (_) {
    return null;
  }
}

export async function solveWithFMCSearch(scramble, onProgress, options = {}) {
  const maxPremoveSets = Number.isFinite(options.maxPremoveSets)
    ? Math.max(0, Math.floor(options.maxPremoveSets))
    : 4;
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(1000, Math.floor(options.timeBudgetMs))
    : 30000;
  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : 24;
  const sweepBudgetMs = Number.isFinite(options.sweepBudgetMs)
    ? Math.max(500, Math.floor(options.sweepBudgetMs))
    : Math.max(1500, Math.min(8000, Math.floor(timeBudgetMs * 0.35)));
  const sweepIncludeInverse = options.sweepIncludeInverse !== false;
  const startedAt = Date.now();
  const deadlineTs = startedAt + timeBudgetMs;
  const sweepDeadlineTs = startedAt + sweepBudgetMs;
  const directProfileLevel = options.directProfileLevel || "medium";
  const directPhaseAttemptTimeoutMs = Number.isFinite(options.directPhaseAttemptTimeoutMs)
    ? Math.max(600, Math.floor(options.directPhaseAttemptTimeoutMs))
    : 2500;
  const directCfopPerColorTimeoutMs = Number.isFinite(options.directCfopPerColorTimeoutMs)
    ? Math.max(700, Math.floor(options.directCfopPerColorTimeoutMs))
    : 2500;
  const directStageBudgetMs = Number.isFinite(options.directStageBudgetMs)
    ? Math.max(800, Math.floor(options.directStageBudgetMs))
    : Math.max(1200, Math.min(5000, Math.floor(timeBudgetMs * 0.42)));
  const nissStageBudgetMs = Number.isFinite(options.nissStageBudgetMs)
    ? Math.max(800, Math.floor(options.nissStageBudgetMs))
    : Math.max(1200, Math.min(5000, Math.floor(timeBudgetMs * 0.42)));
  const phaseTimeCheckInterval = Number.isFinite(options.phaseTimeCheckInterval)
    ? Math.max(128, Math.floor(options.phaseTimeCheckInterval))
    : 1024;
  const sweepProfileLevel = options.sweepProfileLevel || "micro";
  const sweepPhaseAttemptTimeoutMs = Number.isFinite(options.sweepPhaseAttemptTimeoutMs)
    ? Math.max(400, Math.floor(options.sweepPhaseAttemptTimeoutMs))
    : 900;
  const sweepCfopPerColorTimeoutMs = Number.isFinite(options.sweepCfopPerColorTimeoutMs)
    ? Math.max(700, Math.floor(options.sweepCfopPerColorTimeoutMs))
    : 900;
  const sweepAttemptBudgetMs = Number.isFinite(options.sweepAttemptBudgetMs)
    ? Math.max(500, Math.floor(options.sweepAttemptBudgetMs))
    : Math.max(700, Math.min(1800, Math.floor(sweepBudgetMs * 0.35)));
  const enableInsertions = options.enableInsertions !== false;
  const insertionCandidateLimit = Number.isFinite(options.insertionCandidateLimit)
    ? Math.max(1, Math.floor(options.insertionCandidateLimit))
    : 3;
  const insertionMaxPasses = Number.isFinite(options.insertionMaxPasses)
    ? Math.max(1, Math.floor(options.insertionMaxPasses))
    : 3;
  const insertionMinWindow = Number.isFinite(options.insertionMinWindow)
    ? Math.max(2, Math.floor(options.insertionMinWindow))
    : 3;
  const insertionMaxWindow = Number.isFinite(options.insertionMaxWindow)
    ? Math.max(insertionMinWindow, Math.floor(options.insertionMaxWindow))
    : 7;
  const insertionMaxDepth = Number.isFinite(options.insertionMaxDepth)
    ? Math.max(1, Math.floor(options.insertionMaxDepth))
    : 6;
  const insertionTimeMs = Number.isFinite(options.insertionTimeMs)
    ? Math.max(600, Math.floor(options.insertionTimeMs))
    : Math.max(1200, Math.min(16000, Math.floor(timeBudgetMs * 0.22)));
  const insertionThreshold = Number.isFinite(options.insertionThreshold)
    ? Math.max(1, Math.floor(options.insertionThreshold))
    : Math.max(targetMoveCount + 2, 22);
  const inverseScramble = invertAlg(scramble);
  const solvedPattern = await getSolvedPattern();
  const scramblePattern = solvedPattern.applyAlg(scramble);
  const inversePattern = solvedPattern.applyAlg(inverseScramble);
  const candidates = [];
  let attempts = 0;
  const hasSweep = maxPremoveSets > 0;
  const totalStages = hasSweep ? 3 : 2;
  let bestMoveCount = Infinity;
  const sweepLimit = Math.min(maxPremoveSets, FMC_PREMOVE_SETS.length);

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
  const currentTargetMoveCount = () =>
    Number.isFinite(bestMoveCount) ? Math.max(targetMoveCount, bestMoveCount - 1) : targetMoveCount;

  notify({ type: "stage_start", stageIndex: 0, totalStages, stageName: "FMC Direct" });
  const directDeadlineTs = Math.min(deadlineTs, Date.now() + directStageBudgetMs);
  const direct = await solveInternal333(scramble, {
    startPattern: scramblePattern,
    profileLevel: directProfileLevel,
    phaseAttemptTimeoutMs: directPhaseAttemptTimeoutMs,
    cfopPerColorTimeoutMs: directCfopPerColorTimeoutMs,
    allowCfopFallback: options.allowCfopFallback === true,
    crossColors: options.crossColors || ["D"],
    deadlineTs: directDeadlineTs,
    phaseTimeCheckInterval,
    targetMoveCount: currentTargetMoveCount(),
  });
  attempts += 1;
  if (direct?.solution) {
    trackCandidate(
      createCandidate(
        "FMC_DIRECT",
        {
          tag: "direct",
          usesCfop: direct.source === "INTERNAL_FMC_CFOP_FALLBACK",
          innerSource: direct.source,
        },
        splitMoves(direct.solution),
      ),
    );
  }
  notify({
    type: "stage_done",
    stageIndex: 0,
    totalStages,
    stageName: "FMC Direct",
    moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
  });

  notify({ type: "stage_start", stageIndex: 1, totalStages, stageName: "FMC NISS" });
  const nissDeadlineTs = Math.min(deadlineTs, Date.now() + nissStageBudgetMs);
  const inverse =
    remainingMs(nissDeadlineTs) > 400
      ? await solveInternal333(inverseScramble, {
          startPattern: inversePattern,
          profileLevel: directProfileLevel,
          phaseAttemptTimeoutMs: directPhaseAttemptTimeoutMs,
          cfopPerColorTimeoutMs: directCfopPerColorTimeoutMs,
          allowCfopFallback: options.allowCfopFallback === true,
          crossColors: options.crossColors || ["D"],
          deadlineTs: nissDeadlineTs,
          phaseTimeCheckInterval,
          targetMoveCount: currentTargetMoveCount(),
        })
      : null;
  attempts += 1;
  if (inverse?.solution) {
    trackCandidate(
      createCandidate(
        "FMC_NISS",
        {
          tag: "inverse",
          usesCfop: inverse.source === "INTERNAL_FMC_CFOP_FALLBACK",
          innerSource: inverse.source,
        },
        invertMoves(splitMoves(inverse.solution)),
      ),
    );
  }
  notify({
    type: "stage_done",
    stageIndex: 1,
    totalStages,
    stageName: "FMC NISS",
    moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
  });

  if (hasSweep) {
    notify({ type: "stage_start", stageIndex: 2, totalStages, stageName: "FMC Premove Sweep" });
    for (let i = 0; i < sweepLimit; i += 1) {
      if (Date.now() - startedAt >= timeBudgetMs) break;
      if (remainingMs(deadlineTs) <= 1200) break;
      if (remainingMs(sweepDeadlineTs) <= 500) break;
      if (bestMoveCount <= targetMoveCount) break;
      const premove = FMC_PREMOVE_SETS[i];
      const iterationDeadlineTs = Math.min(deadlineTs, sweepDeadlineTs, Date.now() + sweepAttemptBudgetMs);
      if (typeof onProgress === "function") {
        try {
          void onProgress({
            type: "fallback_start",
            stageName: `FMC Sweep ${i + 1}/${sweepLimit}`,
            reason: "PREMOVE",
          });
        } catch (_) {}
      }

      const directPatternWithPremove = applyMovesToPattern(scramblePattern, premove);
      const directWithPremove = await solveInternal333(scramble, {
        startPattern: directPatternWithPremove,
        profileLevel: sweepProfileLevel,
        phaseAttemptTimeoutMs: sweepPhaseAttemptTimeoutMs,
        cfopPerColorTimeoutMs: sweepCfopPerColorTimeoutMs,
        allowCfopFallback: options.premoveAllowCfopFallback === true,
        crossColors: options.crossColors || ["D"],
        deadlineTs: iterationDeadlineTs,
        phaseTimeCheckInterval,
        targetMoveCount: currentTargetMoveCount(),
      });
      attempts += 1;
      if (directWithPremove?.solution) {
        const moves = premove.concat(splitMoves(directWithPremove.solution));
        trackCandidate(
          createCandidate(
            "FMC_PREMOVE_DIRECT",
            {
              tag: `premove:${joinMoves(premove)}`,
              usesCfop: directWithPremove.source === "INTERNAL_FMC_CFOP_FALLBACK",
              innerSource: directWithPremove.source,
            },
            moves,
          ),
        );
      }

      if (!sweepIncludeInverse) {
        continue;
      }
      if (Date.now() - startedAt >= timeBudgetMs) break;
      if (remainingMs(deadlineTs) <= 1200) break;
      if (remainingMs(sweepDeadlineTs) <= 500) break;
      if (bestMoveCount <= targetMoveCount) break;

      const inversePatternWithPremove = applyMovesToPattern(inversePattern, premove);
      const inverseWithPremove = await solveInternal333(inverseScramble, {
        startPattern: inversePatternWithPremove,
        profileLevel: sweepProfileLevel,
        phaseAttemptTimeoutMs: sweepPhaseAttemptTimeoutMs,
        cfopPerColorTimeoutMs: sweepCfopPerColorTimeoutMs,
        allowCfopFallback: options.premoveAllowCfopFallback === true,
        crossColors: options.crossColors || ["D"],
        deadlineTs: iterationDeadlineTs,
        phaseTimeCheckInterval,
        targetMoveCount: currentTargetMoveCount(),
      });
      attempts += 1;
      if (inverseWithPremove?.solution) {
        const moves = invertMoves(splitMoves(inverseWithPremove.solution)).concat(invertMoves(premove));
        trackCandidate(
          createCandidate(
            "FMC_PREMOVE_NISS",
            {
              tag: `niss:${joinMoves(premove)}`,
              usesCfop: inverseWithPremove.source === "INTERNAL_FMC_CFOP_FALLBACK",
              innerSource: inverseWithPremove.source,
            },
            moves,
          ),
        );
      }
    }
    notify({
      type: "stage_done",
      stageIndex: 2,
      totalStages,
      stageName: "FMC Premove Sweep",
      moveCount: Number.isFinite(bestMoveCount) ? bestMoveCount : 0,
    });
  }

  candidates.sort((a, b) => {
    if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
    return a.solution.localeCompare(b.solution);
  });

  const validCandidates = [];
  const requestedVerifyLimit = Number.isFinite(options.verifyLimit)
    ? Math.max(8, Math.floor(options.verifyLimit))
    : 24;
  const verifyLimit = Math.min(candidates.length, requestedVerifyLimit);
  for (let i = 0; i < verifyLimit; i += 1) {
    const candidate = candidates[i];
    if (await verifyCandidate(scramble, candidate)) {
      validCandidates.push(candidate);
    }
  }
  if (!validCandidates.length && verifyLimit < candidates.length) {
    for (let i = verifyLimit; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (await verifyCandidate(scramble, candidate)) {
        validCandidates.push(candidate);
        if (validCandidates.length >= 3) break;
      }
    }
  }
  if (!validCandidates.length) {
    return {
      ok: false,
      reason: "FMC_NO_VALID_SOLUTION",
      attempts,
    };
  }
  const bestValidatedMoveCount = validCandidates.reduce(
    (best, candidate) => Math.min(best, candidate.moveCount),
    Infinity,
  );
  if (enableInsertions && bestValidatedMoveCount <= insertionThreshold && remainingMs(deadlineTs) > 900) {
    const insertionDeadlineTs = Math.min(deadlineTs, Date.now() + insertionTimeMs);
    const insertionTargets = validCandidates
      .slice()
      .sort((a, b) => {
        if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
        return a.solution.localeCompare(b.solution);
      })
      .slice(0, Math.min(insertionCandidateLimit, validCandidates.length));

    if (insertionTargets.length) {
      for (let i = 0; i < insertionTargets.length; i += 1) {
        if (remainingMs(insertionDeadlineTs) <= 250) break;
        if (remainingMs(deadlineTs) <= 250) break;
        const target = insertionTargets[i];
        if (typeof onProgress === "function") {
          try {
            void onProgress({
              type: "fallback_start",
              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`,
              reason: `${target.moveCount}T`,
            });
          } catch (_) {}
        }

        const optimizedMoves = optimizeSolutionWithInsertions(scramblePattern, target.moves, {
          maxPasses: insertionMaxPasses,
          minWindow: insertionMinWindow,
          maxWindow: insertionMaxWindow,
          maxDepth: insertionMaxDepth,
        });

        if (optimizedMoves.length < target.moveCount) {
          const insertionCandidate = createCandidate(
            "FMC_INSERTION",
            {
              tag: `insertion:${target.source}`,
              usesCfop: target.usesCfop,
              innerSource: target.innerSource || target.source,
            },
            optimizedMoves,
          );
          if (insertionCandidate && (await verifyCandidate(scramble, insertionCandidate))) {
            if (!validCandidates.some((existing) => existing.solution === insertionCandidate.solution)) {
              validCandidates.push(insertionCandidate);
              pushUniqueCandidate(candidates, insertionCandidate);
              if (insertionCandidate.moveCount < bestMoveCount) {
                bestMoveCount = insertionCandidate.moveCount;
              }
            }
          }
        }

        if (typeof onProgress === "function") {
          try {
            void onProgress({
              type: "fallback_done",
              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`,
            });
          } catch (_) {}
        }
      }
    }
  }

  const preferNonCfop = options.preferNonCfop === true;
  const nonCfopCandidates = preferNonCfop ? validCandidates.filter((candidate) => !candidate.usesCfop) : [];
  const rankedCandidates = (nonCfopCandidates.length ? nonCfopCandidates : validCandidates).slice().sort((a, b) => {
    if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;
    return a.solution.localeCompare(b.solution);
  });
  const best = rankedCandidates[0];
  const candidateLines = rankedCandidates
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
