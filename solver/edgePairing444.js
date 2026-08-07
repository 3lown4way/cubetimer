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

// Base protected bank for the human 3-2-3 planner. The solver derives the
// five x/z-rotated equivalents too, so it can choose a natural working slice
// instead of forcing every solve through Dw in one fixed physical frame.
const EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);
const EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_FRAME_ROTATIONS = Object.freeze(["", "x", "x2", "x'", "z", "z'"]);

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


function transformSlotMask(mask, action) {
  const destinationBySource = new Uint8Array(24);
  for (let destination = 0; destination < 24; destination += 1) {
    destinationBySource[action.edgePermutation[destination]] = destination;
  }
  let transformed = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(mask & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const targetFirst = destinationBySource[first];
    const targetSecond = destinationBySource[second];
    const targetSlot = EDGE_SLOT_PAIRS_444.findIndex(([left, right]) =>
      (left === targetFirst && right === targetSecond) ||
      (left === targetSecond && right === targetFirst));
    if (targetSlot < 0) throw new Error(`444_323_SLOT_ROTATION_FAILED:${slot}`);
    transformed |= 1 << targetSlot;
  }
  return transformed;
}

function compactActionsEqual(left, right) {
  for (const key of ["edgePermutation", "edgeOrientationDelta", "centerPermutation", "centerOrientationDelta"]) {
    const a = left[key];
    const b = right[key];
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) return false;
    }
  }
  return true;
}

function findEquivalentWideMove(action, actionFor) {
  for (const face of "URFDLB") {
    for (const suffix of ["", "'", "2"]) {
      const move = `${face}w${suffix}`;
      if (compactActionsEqual(action, actionFor(move))) return move;
    }
  }
  return null;
}

function pairedEdgeTypeMask(state) {
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
      mask |= 1 << firstType;
    }
  }
  return mask;
}

function pairedEdgeTypeMaskInSlots(state, slotMask) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(slotMask & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType !== 255 &&
      firstType === secondType &&
      state.edgeOrientation[first] === state.edgeOrientation[second]
    ) {
      mask |= 1 << firstType;
    }
  }
  return mask;
}

function chooseProtectedTypeMask(pairedMask, requiredMask, targetCount) {
  if (!maskContains(pairedMask, requiredMask)) return 0;
  let protectedMask = requiredMask;
  for (let edgeType = 0; edgeType < 12 && bitCount(protectedMask) < targetCount; edgeType += 1) {
    const bit = 1 << edgeType;
    if ((pairedMask & bit) && !(protectedMask & bit)) protectedMask |= bit;
  }
  return protectedMask;
}

function searchSliceCycleAcrossFrames(
  initialState,
  lockedTypeMask,
  targetCount,
  preferredFamily,
  model,
  deadlineTs,
  maxOuterMoves = SLICE_MAX_OUTER_MOVES,
) {
  const orderedFamilies = [
    preferredFamily,
    ...model.sliceFamilies.filter((family) => family !== preferredFamily),
  ];
  for (const sliceFamily of orderedFamilies) {
    if (deadlineReached(deadlineTs)) return null;
    const result = searchSliceCycle(
      initialState,
      lockedTypeMask,
      targetCount,
      sliceFamily,
      model,
      deadlineTs,
      maxOuterMoves,
    );
    if (result) {
      return {
        ...result,
        sliceFamily,
        frameRotation: sliceFamily.rotation || "identity",
        workingSlice: sliceFamily.openMoves[0][0],
      };
    }
  }
  return null;
}

const EDGE_PAIR_SIGNATURE_SIZE_444 = 24 * 24 * 2 * 2;
const edgePairDistanceCache444 = new Map();

function edgeDestinationBySource444(action) {
  const destination = new Uint8Array(24);
  for (let target = 0; target < 24; target += 1) {
    destination[action.edgePermutation[target]] = target;
  }
  return destination;
}

function encodeEdgePairSignature444(firstPosition, secondPosition, firstOrientation, secondOrientation) {
  return (((firstPosition * 24 + secondPosition) * 2 + firstOrientation) * 2 + secondOrientation);
}

function decodeEdgePairSignature444(index) {
  const secondOrientation = index & 1;
  index >>= 1;
  const firstOrientation = index & 1;
  index >>= 1;
  const secondPosition = index % 24;
  const firstPosition = Math.floor(index / 24);
  return [firstPosition, secondPosition, firstOrientation, secondOrientation];
}

function transformEdgePairSignature444(index, action) {
  const [firstPosition, secondPosition, firstOrientation, secondOrientation] = decodeEdgePairSignature444(index);
  const destination = edgeDestinationBySource444(action);
  const nextFirst = destination[firstPosition];
  const nextSecond = destination[secondPosition];
  return encodeEdgePairSignature444(
    nextFirst,
    nextSecond,
    firstOrientation ^ action.edgeOrientationDelta[nextFirst],
    secondOrientation ^ action.edgeOrientationDelta[nextSecond],
  );
}

function edgePairSignatureIsPaired444(index) {
  const [firstPosition, secondPosition, firstOrientation, secondOrientation] = decodeEdgePairSignature444(index);
  if (firstOrientation !== secondOrientation) return false;
  return EDGE_SLOT_PAIRS_444.some(([left, right]) =>
    (left === firstPosition && right === secondPosition) ||
    (left === secondPosition && right === firstPosition));
}

function buildEdgePairDistanceTable444(closeMove, model) {
  const cacheKey = String(closeMove);
  const cached = edgePairDistanceCache444.get(cacheKey);
  if (cached) return cached;

  const closeAction = model.actionFor(closeMove);
  const outerActions = [...model.outerActions.values()];
  const distance = new Uint8Array(EDGE_PAIR_SIGNATURE_SIZE_444);
  distance.fill(255);
  const queue = new Uint16Array(EDGE_PAIR_SIGNATURE_SIZE_444);
  let head = 0;
  let tail = 0;

  for (let firstPosition = 0; firstPosition < 24; firstPosition += 1) {
    for (let secondPosition = 0; secondPosition < 24; secondPosition += 1) {
      if (firstPosition === secondPosition) continue;
      for (let firstOrientation = 0; firstOrientation < 2; firstOrientation += 1) {
        for (let secondOrientation = 0; secondOrientation < 2; secondOrientation += 1) {
          const index = encodeEdgePairSignature444(
            firstPosition,
            secondPosition,
            firstOrientation,
            secondOrientation,
          );
          const closed = transformEdgePairSignature444(index, closeAction);
          if (!edgePairSignatureIsPaired444(closed)) continue;
          distance[index] = 0;
          queue[tail++] = index;
        }
      }
    }
  }

  while (head < tail) {
    const current = queue[head++];
    const nextDistance = distance[current] + 1;
    for (const action of outerActions) {
      const next = transformEdgePairSignature444(current, action);
      if (distance[next] !== 255) continue;
      distance[next] = nextDistance;
      queue[tail++] = next;
    }
  }

  edgePairDistanceCache444.set(cacheKey, distance);
  return distance;
}

function edgeTypeSignature444(state, edgeType) {
  const [firstPiece, secondPiece] = EDGE_SLOT_PAIRS_444[edgeType];
  let firstPosition = -1;
  let secondPosition = -1;
  for (let position = 0; position < 24; position += 1) {
    if (state.edgePieces[position] === firstPiece) firstPosition = position;
    if (state.edgePieces[position] === secondPiece) secondPosition = position;
  }
  if (firstPosition < 0 || secondPosition < 0) return -1;
  return encodeEdgePairSignature444(
    firstPosition,
    secondPosition,
    state.edgeOrientation[firstPosition],
    state.edgeOrientation[secondPosition],
  );
}

function edgePairDistanceHeuristic444(state, lockedTypeMask, targetCount, closeMove, model) {
  const needed = Math.max(0, targetCount - bitCount(lockedTypeMask));
  if (!needed) return 0;
  const table = buildEdgePairDistanceTable444(closeMove, model);
  const distances = [];
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (lockedTypeMask & (1 << edgeType)) continue;
    const signature = edgeTypeSignature444(state, edgeType);
    if (signature < 0) continue;
    const value = table[signature];
    if (value !== 255) distances.push(value);
  }
  distances.sort((left, right) => left - right);
  if (distances.length < needed) return 99;
  let score = 0;
  for (let index = 0; index < needed; index += 1) score += distances[index];
  return score;
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

  const sliceFamilies = EDGE_323_FRAME_ROTATIONS.map((rotation) => {
    if (!rotation) {
      return {
        rotation,
        bankMask: EDGE_323_BANK_MASK,
        openMoves: ["Dw", "Dw'"],
      };
    }
    const inverseRotation = invertAlgorithm(rotation);
    const rotationAction = actionFor(rotation);
    const bankMask = transformSlotMask(EDGE_323_BANK_MASK, rotationAction);
    const conjugatedOpen = actionFor(`${rotation} Dw ${inverseRotation}`);
    const openMove = findEquivalentWideMove(conjugatedOpen, actionFor);
    if (!openMove || openMove.endsWith("2")) {
      throw new Error(`444_323_SLICE_FRAME_FAILED:${rotation}`);
    }
    return {
      rotation,
      bankMask,
      openMoves: [openMove, invertMoveToken(openMove)],
    };
  });
  const uniqueFrames = new Set(sliceFamilies.map((family) => `${family.bankMask}:${family.openMoves[0][0]}`));
  if (uniqueFrames.size !== 6) {
    throw new Error(`444_323_SLICE_FRAME_COUNT:${uniqueFrames.size}`);
  }

  return {
    kpuzzle,
    solved,
    solvedCompact,
    actionFor,
    seedActions,
    outerActions,
    l2eActions,
    sliceFamilies,
  };
}

async function getPlannerModel() {
  if (!plannerModelPromise) plannerModelPromise = buildPlannerModel();
  return plannerModelPromise;
}

function collectSeedCandidates(initialState, bankMask, model, deadlineTs) {
  if (maskContains(pairedSlotMask(initialState), bankMask)) {
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
        const bankCount = bitCount(nextMask & bankMask);
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
      if (maskContains(pairedSlotMask(node.state), bankMask)) goals.push(node);
    }
    if (goals.length >= SEED_GOAL_LIMIT) break;
  }

  return goals
    .sort((left, right) => right.score - left.score)
    .slice(0, SEED_GOAL_LIMIT);
}

function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES) {
  const solvedCenters = model.solvedCompact;
  const openMoves = sliceFamily.openMoves;

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

    for (let depth = 0; depth <= maxOuterMoves; depth += 1) {
      if (deadlineReached(deadlineTs)) return null;
      const seen = new Map();
      for (const node of beam) {
        const closedState = applyCompactAction(node.state, closeAction, true);
        const closedMask = pairedEdgeTypeMask(closedState);
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
        if (depth === maxOuterMoves) continue;

        for (const move of OUTER_MOVES_444) {
          if (node.lastFace && move[0] === node.lastFace) continue;
          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
          const candidateMask = pairedEdgeTypeMask(closedCandidate);
          const pairDistance = edgePairDistanceHeuristic444(
            nextState,
            lockedMask,
            targetCount,
            closeMove,
            model,
          );
          const score = bitCount(candidateMask) * 220
            + bitCount(candidateMask & lockedMask) * 260
            - pairDistance * 95
            - depth;
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

  const diagnostics = {
    frameCount: model.sliceFamilies.length,
    seedCandidates: 0,
    firstThreeFailures: 0,
    nextTwoFailures: 0,
    lastThreeFailures: 0,
    l2eFailures: 0,
    verificationFailures: 0,
  };

  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
    const seedCandidates = collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);
    diagnostics.seedCandidates += seedCandidates.length;
    for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seed = seedCandidates[seedIndex];
      const seedSlotMask = pairedSlotMask(seed.state);
      const bankTypeMask = pairedEdgeTypeMaskInSlots(seed.state, sliceFamily.bankMask);
      if (bitCount(bankTypeMask) !== 4) continue;

      const firstTarget = 7;
      const firstThree = searchSliceCycle(
        seed.state,
        bankTypeMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
      );
      if (!firstThree) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }
      const firstLockedMask = chooseProtectedTypeMask(firstThree.mask, bankTypeMask, firstTarget);
      if (bitCount(firstLockedMask) !== firstTarget) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }

      const eighthTarget = 8;
      const nextTwoFirst = searchSliceCycleAcrossFrames(
        firstThree.state,
        firstLockedMask,
        eighthTarget,
        sliceFamily,
        model,
        deadlineTs,
        7,
      );
      if (!nextTwoFirst) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const eighthLockedMask = chooseProtectedTypeMask(
        nextTwoFirst.mask,
        firstLockedMask,
        eighthTarget,
      );
      if (bitCount(eighthLockedMask) !== eighthTarget) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }

      const secondTarget = 9;
      const nextTwoSecond = searchSliceCycleAcrossFrames(
        nextTwoFirst.state,
        eighthLockedMask,
        secondTarget,
        nextTwoFirst.sliceFamily || sliceFamily,
        model,
        deadlineTs,
        7,
      );
      if (!nextTwoSecond) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const secondLockedMask = chooseProtectedTypeMask(
        nextTwoSecond.mask,
        eighthLockedMask,
        secondTarget,
      );
      if (bitCount(secondLockedMask) !== secondTarget) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const nextTwo = {
        ...nextTwoSecond,
        moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
        firstInsertionMoves: nextTwoFirst.moves,
        secondInsertionMoves: nextTwoSecond.moves,
        firstFrameRotation: nextTwoFirst.frameRotation,
        firstWorkingSlice: nextTwoFirst.workingSlice,
      };

      let finalSetup = null;
      let beforeL2E = nextTwo;
      let beforeL2ELockedCount = secondTarget;
      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          7,
        );
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        const finalLockedMask = chooseProtectedTypeMask(finalSetup.mask, secondLockedMask, 10);
        if (bitCount(finalLockedMask) !== 10) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        beforeL2ELockedCount = 10;
        beforeL2E = finalSetup;
      }

      const beforeL2ETypeCount = bitCount(pairedEdgeTypeMask(beforeL2E.state));
      const l2e = beforeL2ETypeCount === 12
        ? { state: beforeL2E.state, moves: [] }
        : findL2E(beforeL2E.state, model, deadlineTs);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const segments = [
        buildSegment("edge323Bank", "Edge Bank 4/12", seedMoves, 1, 4),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, 5, 7),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, 8, 9),
      ];
      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          10,
          10,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        beforeL2ELockedCount + 1,
        12,
      ));

      const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      const verifiedPattern = solution ? pattern.applyAlg(solution) : pattern;
      const verifiedState = compactStateFromPattern(verifiedPattern);
      if (
        bitCount(pairedSlotMask(verifiedState)) !== 12 ||
        !centersSolved(verifiedState, model.solvedCompact.centerPieces)
      ) {
        diagnostics.verificationFailures += 1;
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
          frameIndex,
          frameRotation: sliceFamily.rotation || "identity",
          workingSlice: sliceFamily.openMoves[0][0],
          nextFrameRotation: nextTwo.frameRotation || sliceFamily.rotation || "identity",
          nextWorkingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          nextTwoInsertionCount: 2,
          nextTwoFirstFrameRotation: nextTwo.firstFrameRotation || sliceFamily.rotation || "identity",
          nextTwoFirstWorkingSlice: nextTwo.firstWorkingSlice || sliceFamily.openMoves[0][0],
          finalFrameRotation: finalSetup?.frameRotation || nextTwo.frameRotation || sliceFamily.rotation || "identity",
          finalWorkingSlice: finalSetup?.workingSlice || nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          seedCandidateIndex: seedIndex,
          seedPairCount: 4,
          incidentalSeedPairs: Math.max(0, bitCount(seedSlotMask) - 4),
          afterFirstThree: 7,
          incidentalAfterFirstThree: Math.max(0, bitCount(firstThree.mask) - 7),
          afterNextTwo: 9,
          incidentalAfterNextTwo: Math.max(0, bitCount(nextTwo.mask) - 9),
          beforeL2E: beforeL2ELockedCount,
          diagnostics,
        },
      };
    }
  }

  const timedOut = deadlineReached(deadlineTs);
  return {
    ok: false,
    reason: timedOut ? "444_323_DEADLINE_REACHED" : "444_323_NO_PLAN",
    detail: JSON.stringify(diagnostics),
    solution: "",
    moveCount: 0,
    segments: [],
    method: "3-2-3",
    meta: diagnostics,
  };
}
