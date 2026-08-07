import { puzzles } from "../vendor/cubing/puzzles/index.js";

const EDGE_SLOT_PAIRS_444 = Object.freeze([
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
]);

const EDGE_TYPE_BY_WING_444 = (() => {
  const edgeTypes = new Uint8Array(24);
  edgeTypes.fill(255);
  EDGE_SLOT_PAIRS_444.forEach((pair, edgeType) => {
    for (const wing of pair) edgeTypes[wing] = edgeType;
  });
  return edgeTypes;
})();

// These four physical dedge slots form the protected bank used by the
// Dw-based 3-2-3 planner. They are the same stable slots the verified
// reduction engine locks first, but the human planner is free to place any
// four paired edge types in them.
const EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);
const EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);

const OUTER_MOVES_444 = Object.freeze(
  [..."URFDLB"].flatMap((face) => [face, `${face}'`, `${face}2`]),
);

// Center-preserving wing commutators harvested from the exact Rust edge
// tables. The planner only uses a handful of these to create a four-edge
// bank, then switches to slice-based 3-2-3. Keeping the verified macros here
// avoids running the old one-edge-at-a-time path for the whole edge stage.
const EDGE_SEED_MACROS_444 = Object.freeze([
  "R2 Uw' L' U L Uw", "Uw' L' U' L Uw R2", "R2 Lw2 U2 L' U2 Lw2", "Lw2 U2 L U2 Lw2 R2",
  "F2 Uw' L2 D L2 Uw", "Uw' L2 D' L2 Uw F2", "Bw2 R' F2 R Bw2 R", "R' Bw2 R' F2 R Bw2",
  "Dw L D2 L' Dw' L2", "L2 Dw L D2 L' Dw'", "Bw D2 F D2 F Bw'", "Bw F' D2 F' D2 Bw'",
  "Dw F' D F Dw' F2", "F2 Dw F' D' F Dw'", "Dw' R U' R' Dw B'", "B Dw' R U R' Dw",
  "Fw' B U2 F U2 Fw", "Fw' U2 F' U2 B' Fw", "Dw L D L' Dw' F'", "F Dw L D' L' Dw'",
  "L' Fw' U2 B' U2 Fw", "Fw' U2 B U2 Fw L", "Rw L2 F2 L F2 Rw'", "Rw F2 L' F2 L2 Rw'",
  "Fw' R' B R Fw L", "L' Fw' R' B' R Fw", "Bw U2 F' U2 Bw' D2", "D2 Bw U2 F U2 Bw'",
  "Fw D' B D Fw' B", "B' Fw D' B' D Fw'", "D Bw' U2 F2 U2 Bw", "Bw' U2 F2 U2 Bw D'",
  "Uw2 D2 B' D' B Uw2", "Uw2 B' D B D2 Uw2", "Fw R2 F' R2 Fw' B", "B' Fw R2 F R2 Fw'",
  "Uw2 L' D' L Uw2 D2", "D2 Uw2 L' D L Uw2", "Dw F2 L' F2 L Dw'", "Dw L' F2 L F2 Dw'",
  "Fw2 U2 B' U2 Fw2 D", "D' Fw2 U2 B U2 Fw2", "Uw' R' D2 R Uw D2", "D2 Uw' R' D2 R Uw",
  "Rw' U2 L2 U2 Rw D'", "D Rw' U2 L2 U2 Rw", "D Fw U2 B U2 Fw'", "Fw U2 B' U2 Fw' D'",
  "Rw L' F L F' Rw'", "Rw F L' F' L Rw'", "F Bw2 L2 F' L2 Bw2", "Bw2 L2 F L2 Bw2 F'",
  "Uw2 D' B' D B Uw2", "Uw2 B' D' B D Uw2", "Uw D' B' D B Uw'", "Uw B' D' B D Uw'",
  "Rw L' D' L D Rw'", "Rw D' L' D L Rw'", "Uw' F L' F' L Uw", "Uw' L' F L F' Uw",
  "Uw D' L' D L Uw'", "Uw L' D' L D Uw'", "Rw F L2 F' Rw' L2", "L2 Rw F L2 F' Rw'",
  "Uw' D2 F' D2 F Uw", "Uw' F' D2 F D2 Uw", "Uw D' B D B' Uw'", "Uw B D' B' D Uw'",
  "Uw' L D L' Uw D'", "D Uw' L D' L' Uw", "Fw' D2 B D2 Fw B'", "B Fw' D2 B' D2 Fw",
]);

const L2E_ALGORITHMS_444 = Object.freeze([
  "Rw' F R' F' R U' R U Rw R'",
  "Rw2 D Rw' U2 Rw D' Rw' U2 Rw'",
  "Rw U2 Rw D Rw' U2 Rw D' Rw2",
]);

const SEED_BEAM_WIDTH = 1200;
const SLICE_BEAM_WIDTH = 1000;
const SEED_GOAL_LIMIT = 30;
const SEED_MAX_MACROS = 5;
const SLICE_MAX_OUTER_MOVES = 5;

let plannerModelPromise = null;

function deadlineReached(deadlineTs) {
  const deadline = Number(deadlineTs);
  return Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline;
}

function splitAlgorithm(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

function invertMoveToken(token) {
  const value = String(token || "").trim();
  if (!value) return "";
  if (value.endsWith("2")) return value;
  return value.endsWith("'") ? value.slice(0, -1) : `${value}'`;
}

function invertAlgorithm(sequence) {
  return splitAlgorithm(sequence).reverse().map(invertMoveToken).join(" ");
}

function actionFromTransformation(transformation) {
  const data = transformation.transformationData;
  return {
    edgePermutation: Uint8Array.from(data.EDGES.permutation),
    edgeOrientationDelta: Uint8Array.from(data.EDGES.orientationDelta),
    centerPermutation: Uint8Array.from(data.CENTERS.permutation),
    centerOrientationDelta: Uint8Array.from(data.CENTERS.orientationDelta),
  };
}

function compactStateFromPattern(pattern) {
  const data = pattern.patternData;
  return {
    edgePieces: Uint8Array.from(data.EDGES.pieces),
    edgeOrientation: Uint8Array.from(data.EDGES.orientation),
    centerPieces: Uint8Array.from(data.CENTERS.pieces),
    centerOrientation: Uint8Array.from(data.CENTERS.orientation),
  };
}

function applyCompactAction(state, action, includeCenters = true) {
  const edgePieces = new Uint8Array(24);
  const edgeOrientation = new Uint8Array(24);
  for (let position = 0; position < 24; position += 1) {
    const source = action.edgePermutation[position];
    edgePieces[position] = state.edgePieces[source];
    edgeOrientation[position] = state.edgeOrientation[source] ^ action.edgeOrientationDelta[position];
  }
  if (!includeCenters) {
    return {
      edgePieces,
      edgeOrientation,
      centerPieces: state.centerPieces,
      centerOrientation: state.centerOrientation,
    };
  }

  const centerPieces = new Uint8Array(24);
  const centerOrientation = new Uint8Array(24);
  for (let position = 0; position < 24; position += 1) {
    const source = action.centerPermutation[position];
    centerPieces[position] = state.centerPieces[source];
    centerOrientation[position] = state.centerOrientation[source] ^ action.centerOrientationDelta[position];
  }
  return { edgePieces, edgeOrientation, centerPieces, centerOrientation };
}

function pairedSlotMask(state) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType !== 255 &&
      firstType === secondType &&
      state.edgeOrientation[first] === state.edgeOrientation[second]
    ) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

function bitCount(value) {
  let count = 0;
  let current = value >>> 0;
  while (current) {
    current &= current - 1;
    count += 1;
  }
  return count;
}

function maskContains(mask, required) {
  return (mask & required) === required;
}

function centersSolved(state, solvedCenterPieces) {
  for (let index = 0; index < 24; index += 1) {
    if (state.centerPieces[index] !== solvedCenterPieces[index]) {
      return false;
    }
  }
  return true;
}

function compactStateKey(state, includeCenters = false) {
  const values = [
    ...state.edgePieces,
    ...state.edgeOrientation,
  ];
  if (includeCenters) {
    values.push(...state.centerPieces, ...state.centerOrientation);
  }
  return String.fromCharCode(...values);
}

function simplifyOuterSequence(tokens) {
  const output = [];
  const parse = (token) => {
    const match = /^([URFDLB]w?)(2|')?$/.exec(token);
    if (!match) return null;
    return { base: match[1], amount: match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1 };
  };
  for (const token of tokens) {
    const current = parse(token);
    if (!current) {
      output.push(token);
      continue;
    }
    const previous = output.length ? parse(output[output.length - 1]) : null;
    if (!previous || previous.base !== current.base) {
      output.push(token);
      continue;
    }
    output.pop();
    const amount = (previous.amount + current.amount) % 4;
    if (amount === 1) output.push(current.base);
    if (amount === 2) output.push(`${current.base}2`);
    if (amount === 3) output.push(`${current.base}'`);
  }
  return output;
}

async function buildPlannerModel() {
  const kpuzzle = await puzzles["4x4x4"].kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const solvedCompact = compactStateFromPattern(solved);
  const actionCache = new Map();
  const actionFor = (algorithm) => {
    const key = String(algorithm || "").trim();
    if (!actionCache.has(key)) {
      actionCache.set(key, actionFromTransformation(kpuzzle.algToTransformation(key)));
    }
    return actionCache.get(key);
  };

  const seedActions = EDGE_SEED_MACROS_444.map((algorithm) => ({ algorithm, action: actionFor(algorithm) }));
  for (const seed of seedActions) {
    const after = applyCompactAction(solvedCompact, seed.action, true);
    if (!centersSolved(after, solvedCompact.centerPieces)) {
      throw new Error(`444_323_SEED_BREAKS_CENTERS:${seed.algorithm}`);
    }
  }

  const outerActions = new Map(OUTER_MOVES_444.map((move) => [move, actionFor(move)]));
  const l2eActions = L2E_ALGORITHMS_444.flatMap((algorithm) => {
    const inverse = invertAlgorithm(algorithm);
    return [
      { algorithm, action: actionFor(algorithm) },
      { algorithm: inverse, action: actionFor(inverse) },
    ];
  });

  return {
    kpuzzle,
    solved,
    solvedCompact,
    actionFor,
    seedActions,
    outerActions,
    l2eActions,
  };
}

async function getPlannerModel() {
  if (!plannerModelPromise) plannerModelPromise = buildPlannerModel();
  return plannerModelPromise;
}

function collectSeedCandidates(initialState, model, deadlineTs) {
  if (maskContains(pairedSlotMask(initialState), EDGE_323_BANK_MASK)) {
    return [{ state: initialState, path: [], score: Number.MAX_SAFE_INTEGER }];
  }

  let beam = [{ state: initialState, path: [], score: 0 }];
  const goals = [];
  for (let depth = 0; depth < SEED_MAX_MACROS; depth += 1) {
    if (deadlineReached(deadlineTs)) return [];
    const seen = new Map();
    for (const node of beam) {
      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, false);
        const nextMask = pairedSlotMask(nextState);
        const bankCount = bitCount(nextMask & EDGE_323_BANK_MASK);
        const score = bankCount * 5000 + bitCount(nextMask) * 1000 - depth;
        const key = compactStateKey(nextState, false);
        const previous = seen.get(key);
        if (!previous || previous.score < score) {
          seen.set(key, {
            state: nextState,
            path: [...node.path, actionIndex],
            score,
          });
        }
      }
    }
    beam = [...seen.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, SEED_BEAM_WIDTH);
    for (const node of beam) {
      if (maskContains(pairedSlotMask(node.state), EDGE_323_BANK_MASK)) goals.push(node);
    }
    if (goals.length >= SEED_GOAL_LIMIT) break;
  }

  return goals
    .sort((left, right) => right.score - left.score)
    .slice(0, SEED_GOAL_LIMIT);
}

function searchSliceCycle(initialState, lockedMask, targetCount, model, deadlineTs) {
  const solvedCenters = model.solvedCompact;
  const openMoves = ["Dw", "Dw'"];

  for (const openMove of openMoves) {
    const closeMove = openMove.endsWith("'") ? "Dw" : "Dw'";
    const openAction = model.actionFor(openMove);
    const closeAction = model.actionFor(closeMove);
    let beam = [{
      state: applyCompactAction(initialState, openAction, true),
      path: [],
      lastFace: "",
      score: 0,
    }];

    for (let depth = 0; depth <= SLICE_MAX_OUTER_MOVES; depth += 1) {
      if (deadlineReached(deadlineTs)) return null;
      const seen = new Map();
      for (const node of beam) {
        const closedState = applyCompactAction(node.state, closeAction, true);
        const closedMask = pairedSlotMask(closedState);
        if (
          maskContains(closedMask, lockedMask) &&
          bitCount(closedMask) >= targetCount &&
          centersSolved(closedState, solvedCenters.centerPieces)
        ) {
          return {
            state: closedState,
            mask: closedMask,
            moves: [openMove, ...node.path, closeMove],
          };
        }
        if (depth === SLICE_MAX_OUTER_MOVES) continue;

        for (const move of OUTER_MOVES_444) {
          if (node.lastFace && move[0] === node.lastFace) continue;
          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
          const candidateMask = pairedSlotMask(closedCandidate);
          const score = bitCount(candidateMask) * 180 + bitCount(candidateMask & lockedMask) * 220 - depth;
          const key = compactStateKey(nextState, true);
          const previous = seen.get(key);
          if (!previous || previous.score < score) {
            seen.set(key, {
              state: nextState,
              path: [...node.path, move],
              lastFace: move[0],
              score,
            });
          }
        }
      }
      beam = [...seen.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, SLICE_BEAM_WIDTH);
    }
  }
  return null;
}

function enumerateSetupPaths(maxDepth = 3) {
  const paths = [[]];
  let frontier = [[]];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const next = [];
    for (const path of frontier) {
      const lastFace = path.length ? path[path.length - 1][0] : "";
      for (const move of OUTER_MOVES_444) {
        if (lastFace && move[0] === lastFace) continue;
        const candidate = [...path, move];
        paths.push(candidate);
        next.push(candidate);
      }
    }
    frontier = next;
  }
  return paths;
}

const L2E_SETUP_PATHS = enumerateSetupPaths(3);

function applyMovePath(state, moves, model) {
  let current = state;
  for (const move of moves) current = applyCompactAction(current, model.outerActions.get(move), true);
  return current;
}

function findL2E(initialState, model, deadlineTs) {
  const solvedCenters = model.solvedCompact;
  for (let setupIndex = 0; setupIndex < L2E_SETUP_PATHS.length; setupIndex += 1) {
    if ((setupIndex & 0x01ff) === 0 && deadlineReached(deadlineTs)) return null;
    const setup = L2E_SETUP_PATHS[setupIndex];
    const setupState = applyMovePath(initialState, setup, model);
    const undo = setup.slice().reverse().map(invertMoveToken);
    for (const l2e of model.l2eActions) {
      let candidate = applyCompactAction(setupState, l2e.action, true);
      candidate = applyMovePath(candidate, undo, model);
      if (
        bitCount(pairedSlotMask(candidate)) === 12 &&
        centersSolved(candidate, solvedCenters.centerPieces)
      ) {
        return {
          state: candidate,
          moves: [...setup, ...splitAlgorithm(l2e.algorithm), ...undo],
        };
      }
    }
  }
  return null;
}

function buildSegment(id, name, moves, pairStart, pairEnd) {
  const simplified = simplifyOuterSequence(moves);
  return {
    id,
    name,
    solution: simplified.join(" "),
    moveCount: simplified.length,
    pairStart,
    pairEnd,
    verified: true,
  };
}

export async function solveEdgePairing323(publicScramble, publicCenterSolution, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const model = await getPlannerModel();
  if (deadlineReached(deadlineTs)) {
    return { ok: false, reason: "444_323_DEADLINE_REACHED", solution: "", segments: [] };
  }

  let pattern = model.solved;
  const scramble = String(publicScramble || "").trim();
  const centers = String(publicCenterSolution || "").trim();
  if (scramble) pattern = pattern.applyAlg(scramble);
  if (centers) pattern = pattern.applyAlg(centers);
  const initialState = compactStateFromPattern(pattern);
  if (!centersSolved(initialState, model.solvedCompact.centerPieces)) {
    return { ok: false, reason: "444_323_CENTERS_NOT_SOLVED", solution: "", segments: [] };
  }

  const initialMask = pairedSlotMask(initialState);
  if (bitCount(initialMask) === 12) {
    return { ok: true, reason: null, solution: "", moveCount: 0, segments: [], method: "3-2-3" };
  }

  const seedCandidates = collectSeedCandidates(initialState, model, deadlineTs);
  for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const seed = seedCandidates[seedIndex];
    const seedMask = pairedSlotMask(seed.state);
    const firstTarget = Math.max(7, bitCount(seedMask));
    const firstThree = searchSliceCycle(seed.state, seedMask, firstTarget, model, deadlineTs);
    if (!firstThree) continue;

    const secondTarget = Math.max(9, bitCount(firstThree.mask));
    const nextTwo = searchSliceCycle(firstThree.state, firstThree.mask, secondTarget, model, deadlineTs);
    if (!nextTwo) continue;

    let finalSetup = null;
    let beforeL2E = nextTwo;
    if (bitCount(nextTwo.mask) < 10) {
      finalSetup = searchSliceCycle(nextTwo.state, nextTwo.mask, 10, model, deadlineTs);
      if (!finalSetup) continue;
      beforeL2E = finalSetup;
    }

    const l2e = findL2E(beforeL2E.state, model, deadlineTs);
    if (!l2e) continue;

    const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
    const seedCount = bitCount(seedMask);
    const firstCount = bitCount(firstThree.mask);
    const secondCount = bitCount(nextTwo.mask);
    const finalSetupCount = finalSetup ? bitCount(finalSetup.mask) : secondCount;
    const segments = [
      buildSegment("edge323Bank", `Edge Bank ${seedCount}/12`, seedMoves, 1, seedCount),
      buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, seedCount + 1, firstCount),
      buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstCount + 1, secondCount),
    ];
    if (finalSetup) {
      segments.push(buildSegment(
        "edge323Last3Setup",
        "3-2-3 · Last 3 setup",
        finalSetup.moves,
        secondCount + 1,
        finalSetupCount,
      ));
    }
    segments.push(buildSegment(
      "edge323L2E",
      "3-2-3 · L2E",
      l2e.moves,
      finalSetupCount + 1,
      12,
    ));

    const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");
    const verifiedPattern = solution ? pattern.applyAlg(solution) : pattern;
    const verifiedState = compactStateFromPattern(verifiedPattern);
    if (
      bitCount(pairedSlotMask(verifiedState)) !== 12 ||
      !centersSolved(verifiedState, model.solvedCompact.centerPieces)
    ) {
      continue;
    }

    return {
      ok: true,
      reason: null,
      solution,
      moveCount: splitAlgorithm(solution).length,
      segments,
      method: "3-2-3",
      meta: {
        seedCandidateIndex: seedIndex,
        seedPairCount: seedCount,
        afterFirstThree: firstCount,
        afterNextTwo: secondCount,
        beforeL2E: finalSetupCount,
      },
    };
  }

  return {
    ok: false,
    reason: deadlineReached(deadlineTs) ? "444_323_DEADLINE_REACHED" : "444_323_NO_PLAN",
    solution: "",
    moveCount: 0,
    segments: [],
    method: "3-2-3",
  };
}
