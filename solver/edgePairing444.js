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
const EDGE_SLOT_TO_333_444 = Object.freeze([0, 8, 9, 4, 5, 7, 6, 3, 11, 10, 2, 1]);
const EDGE_NAMES_333_444 = Object.freeze(["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"]);

export function crossEdgeTypeMask444(crossColor = "D") {
  const face = /^[URFDLB]$/i.test(String(crossColor || "D"))
    ? String(crossColor || "D").toUpperCase()
    : "D";
  let mask = 0;
  EDGE_SLOT_TO_333_444.forEach((cubieIndex, edgeType) => {
    if (EDGE_NAMES_333_444[cubieIndex].includes(face)) mask |= 1 << edgeType;
  });
  return mask;
}

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

function solvedEdgeTypeMask(state) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType === slot &&
      secondType === slot &&
      state.edgeOrientation[first] === 0 &&
      state.edgeOrientation[second] === 0
    ) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

function chooseTargetTypeMask(pairedMask, targetMask, requiredMask, targetCount) {
  if (!maskContains(pairedMask, requiredMask)) return 0;
  let selected = requiredMask & targetMask;
  for (let edgeType = 0; edgeType < 12 && bitCount(selected) < targetCount; edgeType += 1) {
    const bit = 1 << edgeType;
    if ((targetMask & bit) && (pairedMask & bit) && !(selected & bit)) selected |= bit;
  }
  return bitCount(selected) === targetCount ? selected : 0;
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
  requiredSolvedTypeMask = 0,
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
      requiredSolvedTypeMask,
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

function edgePairDistanceHeuristic444(state, lockedTypeMask, targetCount, closeMove, model, targetTypeMask = 0x0fff) {
  const needed = Math.max(0, targetCount - bitCount(lockedTypeMask & targetTypeMask));
  if (!needed) return 0;
  const table = buildEdgePairDistanceTable444(closeMove, model);
  const distances = [];
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (!(targetTypeMask & (1 << edgeType))) continue;
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

  const centerPositionsByFace = {};
  for (const face of "URFDLB") {
    const action = actionFor(face);
    centerPositionsByFace[face] = [];
    for (let position = 0; position < 24; position += 1) {
      if (action.centerPermutation[position] !== position) centerPositionsByFace[face].push(position);
    }
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
    centerPositionsByFace,
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

function protectedCenterFacesSolved444(state, model, faces) {
  for (const face of faces) {
    const positions = model.centerPositionsByFace[face] || [];
    if (positions.length !== 4) return false;
    for (const position of positions) {
      if (state.centerPieces[position] !== model.solvedCompact.centerPieces[position]) return false;
    }
  }
  return true;
}

function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES, requiredSolvedTypeMask = 0, options = {}) {
  const solvedCenters = model.solvedCompact;
  const openMoves = sliceFamily.openMoves;
  const targetTypeMask = (Number(options?.targetTypeMask) >>> 0) || 0x0fff;
  const exactTargetCount = options?.exactTargetCount === true;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const centersOkay = (state) => requireAllCenters
    ? centersSolved(state, solvedCenters.centerPieces)
    : protectedCenterFacesSolved444(state, model, protectedCenterFaces);

  for (const openMove of openMoves) {
    // A human 3-2-3 cycle must restore the same working slice it opened.
    // The old code always closed with Dw/Dw', even when a rotated frame opened
    // Uw/Fw/Bw/Rw/Lw, forcing the beam search to compensate with unnatural moves.
    const closeMove = invertMoveToken(openMove);
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
        const targetPairedCount = bitCount(closedMask & targetTypeMask);
        if (
          maskContains(closedMask, lockedMask) &&
          (exactTargetCount ? targetPairedCount === targetCount : targetPairedCount >= targetCount) &&
          (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(closedState), requiredSolvedTypeMask)) &&
          centersOkay(closedState)
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
            nextState, lockedMask, targetCount, closeMove, model, targetTypeMask,
          );
          const score = bitCount(candidateMask & targetTypeMask) * 520
            + bitCount(candidateMask) * 80
            + bitCount(candidateMask & lockedMask) * 360
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

function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0) {
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
        (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(candidate), requiredSolvedTypeMask)) &&
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

const YAU_TARGET_BEAM_WIDTH = 3600;
const YAU_TARGET_RESCUE_BEAM_WIDTH = 10000;
const YAU_TARGET_MAX_MACROS = 6;
const YAU_TARGET_RESCUE_MAX_MACROS = 10;
const YAU_ALIGNMENT_BEAM_WIDTH = 5000;
const YAU_ALIGNMENT_RESCUE_BEAM_WIDTH = 12000;
const YAU_ALIGNMENT_MAX_DEPTH = 8;
const YAU_ALIGNMENT_RESCUE_MAX_DEPTH = 11;

function sameCenterState444(left, right) {
  if (!left?.centerPieces || !right?.centerPieces) return false;
  if (left.centerPieces.length !== right.centerPieces.length) return false;
  for (let index = 0; index < left.centerPieces.length; index += 1) {
    if (left.centerPieces[index] !== right.centerPieces[index]) return false;
  }
  return true;
}

function targetEdgeProjectionKey444(state, targetTypeMask, includeCenters = false) {
  // Exact projection for frame probes: only the eight wings belonging to the
  // four target dedges influence whether those dedges can be paired and survive
  // the fixed remaining-center action.
  const positionByPiece = new Uint8Array(24);
  for (let position = 0; position < 24; position += 1) {
    positionByPiece[state.edgePieces[position]] = position;
  }
  const values = [];
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (!(targetTypeMask & (1 << edgeType))) continue;
    const [firstPiece, secondPiece] = EDGE_SLOT_PAIRS_444[edgeType];
    const firstPosition = positionByPiece[firstPiece];
    const secondPosition = positionByPiece[secondPiece];
    values.push(
      firstPosition,
      state.edgeOrientation[firstPosition],
      secondPosition,
      state.edgeOrientation[secondPosition],
    );
  }
  if (includeCenters) values.push(...state.centerPieces, ...state.centerOrientation);
  return String.fromCharCode(...values);
}

function searchTargetEdgeTypes444(
  initialState,
  targetTypeMask,
  requiredTypeMask,
  targetCount,
  model,
  deadlineTs,
  maxMacros = YAU_TARGET_MAX_MACROS,
  postAction = null,
  minPairCount = 0,
  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
) {
  const evaluate = (node) => {
    const pairedMask = pairedEdgeTypeMask(node.state);
    const targetPaired = bitCount(pairedMask & targetTypeMask);
    const centersPreserved = sameCenterState444(node.state, initialState);
    const postState = postAction ? applyCompactAction(node.state, postAction, true) : node.state;
    const postPairedMask = pairedEdgeTypeMask(postState);
    const preservedTarget = bitCount(pairedMask & postPairedMask & targetTypeMask);
    return {
      ...node,
      pairedMask,
      postPairedMask,
      targetPaired,
      preservedTarget,
      centersPreserved,
      score: (centersPreserved ? 500000 : 0)
        + preservedTarget * 250000
        + targetPaired * 100000
        + bitCount(pairedMask) * 1000
        - node.path.length,
    };
  };

  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
  for (let depth = 0; depth <= maxMacros; depth += 1) {
    if (deadlineReached(deadlineTs)) return null;
    const goals = beam
      .filter((node) =>
        node.centersPreserved &&
        maskContains(node.pairedMask, requiredTypeMask) &&
        maskContains(node.postPairedMask, requiredTypeMask) &&
        node.targetPaired >= targetCount &&
        node.preservedTarget >= targetCount
      )
      .sort((left, right) => {
        const leftExact = left.targetPaired === targetCount ? 1 : 0;
        const rightExact = right.targetPaired === targetCount ? 1 : 0;
        return rightExact - leftExact || right.score - left.score;
      });
    if (goals.length && goals[0].targetPaired === targetCount) return goals[0];
    if (goals.length && !overshoot) overshoot = goals[0];
    if (depth === maxMacros) break;

    const seen = new Map();
    for (const node of beam) {
      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);
        const pairedMask = pairedEdgeTypeMask(nextState);
        if (!maskContains(pairedMask, requiredTypeMask)) continue;
        if (bitCount(pairedMask) < minPairCount) continue;
        const candidate = evaluate({ state: nextState, path: [...node.path, actionIndex] });
        // Only the Yau target-edge search may opt into a center-aware key.
        // Do not touch collectSeedCandidates(): that is the standard 3-2-3
        // reduction path and intentionally keys only the wing state.
        const key = projectTargetState
          ? targetEdgeProjectionKey444(nextState, targetTypeMask, centerAwareKey)
          : compactStateKey(nextState, centerAwareKey);
        const previous = seen.get(key);
        if (!previous || previous.score < candidate.score) seen.set(key, candidate);
      }
    }
    beam = [...seen.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, beamWidth);
  }
  return overshoot;
}

function searchOuterCrossAlignment444(
  initialState,
  targetTypeMask,
  model,
  deadlineTs,
  maxDepth = YAU_ALIGNMENT_MAX_DEPTH,
  beamWidth = YAU_ALIGNMENT_BEAM_WIDTH,
) {
  const solvedCenters = model.solvedCompact;
  const initialSolvedMask = solvedEdgeTypeMask(initialState);
  if (
    maskContains(initialSolvedMask, targetTypeMask) &&
    centersSolved(initialState, solvedCenters.centerPieces)
  ) {
    return { state: initialState, moves: [] };
  }

  let beam = [{
    state: initialState,
    path: [],
    lastFace: "",
    score: bitCount(initialSolvedMask & targetTypeMask) * 10000,
  }];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (deadlineReached(deadlineTs)) return null;
    const seen = new Map();
    for (const node of beam) {
      for (const move of OUTER_MOVES_444) {
        if (node.lastFace && node.lastFace === move[0]) continue;
        const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
        if (!maskContains(pairedEdgeTypeMask(nextState), targetTypeMask)) continue;
        const solvedMask = solvedEdgeTypeMask(nextState);
        const path = [...node.path, move];
        if (
          maskContains(solvedMask, targetTypeMask) &&
          centersSolved(nextState, solvedCenters.centerPieces)
        ) {
          return { state: nextState, moves: path };
        }
        const score = bitCount(solvedMask & targetTypeMask) * 10000
          + bitCount(solvedMask) * 120
          - path.length;
        const key = compactStateKey(nextState, true);
        const previous = seen.get(key);
        if (!previous || previous.score < score) {
          seen.set(key, { state: nextState, path, lastFace: move[0], score });
        }
      }
    }
    beam = [...seen.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, beamWidth);
  }
  return null;
}

export async function debugEdge323Frames444() {
  const model = await getPlannerModel();
  return model.sliceFamilies.map((family) => ({
    rotation: family.rotation,
    bankMask: family.bankMask,
    openMoves: [...family.openMoves],
  }));
}

export async function solveTargetEdgeTypes444(
  publicScramble,
  publicSetupSolution,
  targetTypeMask,
  options = {},
) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const model = await getPlannerModel();
  const targetMask = Number(targetTypeMask) >>> 0;
  const requiredTypeMask = Number(options?.requiredTypeMask) >>> 0;
  const targetCount = Math.max(1, Math.min(bitCount(targetMask), Number(options?.targetCount) || bitCount(targetMask)));
  const maxMacros = Math.max(0, Math.min(YAU_TARGET_RESCUE_MAX_MACROS, Number(options?.maxMacros) || YAU_TARGET_MAX_MACROS));
  const enableRescue = options?.enableRescue !== false;
  const alignSolved = options?.alignSolved === true;
  const postSequence = String(options?.postSequence || "").trim();
  const postAction = postSequence ? model.actionFor(postSequence) : null;
  if (!targetMask || deadlineReached(deadlineTs)) {
    return { ok: false, reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_BAD_TARGET" };
  }

  let pattern = model.solved;
  const scramble = String(publicScramble || "").trim();
  const setup = String(publicSetupSolution || "").trim();
  if (scramble) pattern = pattern.applyAlg(scramble);
  if (setup) pattern = pattern.applyAlg(setup);
  const centerSnapshot = JSON.stringify(pattern.patternData.CENTERS);
  const initialState = compactStateFromPattern(pattern);
  const initialPaired = pairedEdgeTypeMask(initialState);
  if (!maskContains(initialPaired, requiredTypeMask)) {
    return { ok: false, reason: "444_YAU_REQUIRED_CROSS_BROKEN" };
  }

  let paired = searchTargetEdgeTypes444(
    initialState,
    targetMask,
    requiredTypeMask,
    targetCount,
    model,
    deadlineTs,
    maxMacros,
    postAction,
    0,
    YAU_TARGET_BEAM_WIDTH,
    false,
    options?.projectTargetState === true,
  );
  let searchRescueUsed = false;
  let searchMaxMacros = maxMacros;
  if (enableRescue && !paired && maxMacros > 0 && !deadlineReached(deadlineTs)) {
    searchMaxMacros = Math.max(maxMacros, YAU_TARGET_RESCUE_MAX_MACROS);
    paired = searchTargetEdgeTypes444(
      initialState,
      targetMask,
      requiredTypeMask,
      targetCount,
      model,
      deadlineTs,
      searchMaxMacros,
      postAction,
      0,
      YAU_TARGET_RESCUE_BEAM_WIDTH,
      true,
      false,
    );
    searchRescueUsed = paired != null;
  }
  if (!paired) {
    return {
      ok: false,
      reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_TARGET_EDGES_NOT_FOUND",
      detail: JSON.stringify({ targetCount, maxMacros, rescueEnabled: enableRescue, rescueMaxMacros: searchMaxMacros }),
    };
  }

  const lockedTypeMask = chooseTargetTypeMask(
    paired.pairedMask & paired.postPairedMask,
    targetMask,
    requiredTypeMask,
    targetCount,
  );
  if (!lockedTypeMask) return { ok: false, reason: "444_YAU_TARGET_LOCK_FAILED" };

  const pairMoves = paired.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
  let finalState = paired.state;
  let alignmentMoves = [];
  let alignmentRescueUsed = false;
  if (alignSolved) {
    let alignment = searchOuterCrossAlignment444(finalState, targetMask, model, deadlineTs);
    if (enableRescue && !alignment && !deadlineReached(deadlineTs)) {
      alignment = searchOuterCrossAlignment444(
        finalState,
        targetMask,
        model,
        deadlineTs,
        YAU_ALIGNMENT_RESCUE_MAX_DEPTH,
        YAU_ALIGNMENT_RESCUE_BEAM_WIDTH,
      );
      alignmentRescueUsed = alignment != null;
    }
    if (!alignment) {
      return {
        ok: false,
        reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_CROSS_ALIGNMENT_FAILED",
        detail: JSON.stringify({
          rescueEnabled: enableRescue,
          primaryMaxDepth: YAU_ALIGNMENT_MAX_DEPTH,
          rescueMaxDepth: YAU_ALIGNMENT_RESCUE_MAX_DEPTH,
        }),
      };
    }
    finalState = alignment.state;
    alignmentMoves = alignment.moves;
  }

  const moves = simplifyOuterSequence([...pairMoves, ...alignmentMoves]);
  const solution = moves.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedPaired = pairedEdgeTypeMask(verifiedState);
  if (
    bitCount(verifiedPaired & targetMask) < targetCount ||
    !maskContains(verifiedPaired, requiredTypeMask)
  ) {
    return { ok: false, reason: "444_YAU_TARGET_VERIFICATION_FAILED" };
  }
  if (alignSolved && !maskContains(solvedEdgeTypeMask(verifiedState), targetMask)) {
    return { ok: false, reason: "444_YAU_CROSS_ALIGNMENT_VERIFICATION_FAILED" };
  }
  if (alignSolved) {
    if (!centersSolved(verifiedState, model.solvedCompact.centerPieces)) {
      return { ok: false, reason: "444_YAU_ALIGNMENT_BREAKS_CENTERS" };
    }
  } else if (JSON.stringify(verified.patternData.CENTERS) !== centerSnapshot) {
    return { ok: false, reason: "444_YAU_PAIRING_BREAKS_CENTERS" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: moves.length,
    pairedTargetMask: verifiedPaired & targetMask,
    lockedTypeMask,
    solvedTargetMask: solvedEdgeTypeMask(verifiedState) & targetMask,
    targetCount,
    macroCount: paired.path.length,
    alignmentMoveCount: alignmentMoves.length,
    searchRescueUsed,
    searchMaxMacros,
    alignmentRescueUsed,
    method: "Yau Cross Edges",
  };
}

export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(150, Math.min(2500, Number(options?.timeBudgetMs) || 1200));
  const startedAt = Date.now();
  const localDeadlineTs = globalDeadlineTs > 0 ? Math.min(globalDeadlineTs, startedAt + budgetMs) : startedAt + budgetMs;
  const model = await getPlannerModel();
  let pattern = model.solved;
  if (publicScramble) pattern = pattern.applyAlg(String(publicScramble));
  if (publicSetupSolution) pattern = pattern.applyAlg(String(publicSetupSolution));
  let state = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : ["D", "U"];
  if (!protectedCenterFacesSolved444(state, model, protectedCenterFaces)) return { ok: false, reason: "444_YAU_NATURAL_CROSS3_CENTERS_NOT_READY" };
  let lockedMask = pairedEdgeTypeMask(state) & targetMask;
  let count = bitCount(lockedMask);
  if (count > 3) return { ok: false, reason: "444_YAU_NATURAL_CROSS3_OVERSHOOT_START" };
  const moves = [];
  const cycles = [];
  while (count < 3 && !deadlineReached(localDeadlineTs)) {
    const nextTarget = count + 1;
    let best = null;
    for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
      if (deadlineReached(localDeadlineTs)) break;
      const found = searchSliceCycle(
        state, lockedMask, nextTarget, model.sliceFamilies[frameIndex], model, localDeadlineTs, 4, 0,
        { targetTypeMask: targetMask, exactTargetCount: true, protectedCenterFaces, requireAllCenters: false },
      );
      if (!found) continue;
      if (!best || found.moves.length < best.moves.length) best = { ...found, frameIndex };
      if (found.moves.length <= 4) break;
    }
    if (!best) return {
      ok: false,
      reason: deadlineReached(localDeadlineTs) ? "444_YAU_NATURAL_CROSS3_TIMEOUT" : "444_YAU_NATURAL_CROSS3_NO_CYCLE",
      moveCount: moves.length, pairCount: count, elapsedMs: Date.now() - startedAt,
    };
    state = best.state;
    lockedMask = pairedEdgeTypeMask(state) & targetMask;
    count = bitCount(lockedMask);
    moves.push(...best.moves);
    cycles.push({ frameIndex: best.frameIndex, workingSlice: best.moves[0], moveCount: best.moves.length, pairCount: count });
  }
  const simplified = simplifyOuterSequence(moves);
  const solution = simplified.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedMask = pairedEdgeTypeMask(verifiedState) & targetMask;
  if (bitCount(verifiedMask) !== 3 || !protectedCenterFacesSolved444(verifiedState, model, protectedCenterFaces)) {
    return { ok: false, reason: "444_YAU_NATURAL_CROSS3_VERIFY_FAILED" };
  }
  return {
    ok: true, reason: null, solution, moveCount: simplified.length,
    lockedTypeMask: verifiedMask, pairedTargetMask: verifiedMask, cycleCount: cycles.length, cycles,
    elapsedMs: Date.now() - startedAt, method: "Yau Natural Slice Cross 3/4",
  };
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
  const requiredTypeMask = Number(options?.requiredTypeMask) >>> 0;
  const requiredSolvedTypeMask = Number(options?.requiredSolvedTypeMask) >>> 0;
  const yauBank = bitCount(requiredTypeMask) === 4;
  const edgeMethod = yauBank ? "Yau 3-2-3" : "3-2-3";
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
  const initialTypeMask = pairedEdgeTypeMask(initialState);
  if (!maskContains(initialTypeMask, requiredTypeMask)) {
    return { ok: false, reason: "444_323_REQUIRED_TYPES_NOT_PAIRED", solution: "", segments: [], method: edgeMethod };
  }
  if (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(initialState), requiredSolvedTypeMask)) {
    return { ok: false, reason: "444_323_REQUIRED_CROSS_NOT_SOLVED", solution: "", segments: [], method: edgeMethod };
  }
  if (bitCount(initialMask) === 12) {
    return { ok: true, reason: null, solution: "", moveCount: 0, segments: [], method: edgeMethod };
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
    const seedCandidates = yauBank
      ? [{ state: initialState, path: [], score: Number.MAX_SAFE_INTEGER }]
      : collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);
    diagnostics.seedCandidates += seedCandidates.length;
    for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seed = seedCandidates[seedIndex];
      const seedSlotMask = pairedSlotMask(seed.state);
      const bankTypeMask = yauBank
        ? chooseProtectedTypeMask(pairedEdgeTypeMask(seed.state), requiredTypeMask, 4)
        : pairedEdgeTypeMaskInSlots(seed.state, sliceFamily.bankMask);
      if (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(seed.state), requiredSolvedTypeMask)) continue;
      if (bitCount(bankTypeMask) !== 4) continue;

      const firstTarget = 7;
      const firstThree = searchSliceCycle(
        seed.state,
        bankTypeMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
        yauBank ? 7 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
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
      const secondTarget = 9;
      let nextTwo;
      let secondLockedMask;
      if (yauBank) {
        const nextTwoFirst = searchTargetEdgeTypes444(
          firstThree.state,
          0x0fff,
          requiredTypeMask,
          eighthTarget,
          model,
          deadlineTs,
          2,
          null,
          7,
        );
        if (!nextTwoFirst) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const eighthLockedMask = chooseProtectedTypeMask(
          nextTwoFirst.pairedMask,
          requiredTypeMask,
          eighthTarget,
        );
        if (bitCount(eighthLockedMask) !== eighthTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const nextTwoSecond = searchTargetEdgeTypes444(
          nextTwoFirst.state,
          0x0fff,
          requiredTypeMask,
          secondTarget,
          model,
          deadlineTs,
          2,
          null,
          8,
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.pairedMask,
          requiredTypeMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const firstMoves = nextTwoFirst.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        const secondMoves = nextTwoSecond.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        nextTwo = {
          state: nextTwoSecond.state,
          mask: nextTwoSecond.pairedMask,
          moves: [...firstMoves, ...secondMoves],
          firstInsertionMoves: firstMoves,
          secondInsertionMoves: secondMoves,
          sliceFamily,
          frameRotation: sliceFamily.rotation,
          workingSlice: sliceFamily.openMoves[0][0],
          firstFrameRotation: sliceFamily.rotation,
          firstWorkingSlice: sliceFamily.openMoves[0][0],
        };
      } else {
        const nextTwoFirst = searchSliceCycleAcrossFrames(
          firstThree.state,
          firstLockedMask,
          eighthTarget,
          sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
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

        const nextTwoSecond = searchSliceCycleAcrossFrames(
          nextTwoFirst.state,
          eighthLockedMask,
          secondTarget,
          nextTwoFirst.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.mask,
          eighthLockedMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        nextTwo = {
          ...nextTwoSecond,
          moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
          firstInsertionMoves: nextTwoFirst.moves,
          secondInsertionMoves: nextTwoSecond.moves,
          firstFrameRotation: nextTwoFirst.frameRotation,
          firstWorkingSlice: nextTwoFirst.workingSlice,
        };
      }

      let finalSetup = null;
      let beforeL2E = nextTwo;
      let beforeL2ELockedCount = secondTarget;
      if (bitCount(nextTwo.mask) < 10) {
        if (yauBank) {
          const multiCycle = searchTargetEdgeTypes444(
            nextTwo.state,
            0x0fff,
            requiredTypeMask,
            10,
            model,
            deadlineTs,
            3,
            null,
            9,
          );
          finalSetup = multiCycle
            ? {
                state: multiCycle.state,
                mask: multiCycle.pairedMask,
                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(model.seedActions[actionIndex].algorithm)
                ),
                sliceFamily: nextTwo.sliceFamily || sliceFamily,
                frameRotation: nextTwo.frameRotation || sliceFamily.rotation,
                workingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
              }
            : null;
        } else {
          finalSetup = searchSliceCycleAcrossFrames(
            nextTwo.state,
            secondLockedMask,
            10,
            nextTwo.sliceFamily || sliceFamily,
            model,
            deadlineTs,
            7,
            requiredSolvedTypeMask,
          );
        }
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        const finalLockedMask = chooseProtectedTypeMask(
          finalSetup.mask,
          yauBank ? requiredTypeMask : secondLockedMask,
          10,
        );
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
        : findL2E(beforeL2E.state, model, deadlineTs, requiredSolvedTypeMask);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const bankSegment = yauBank
        ? {
            id: "edge323Bank",
            name: "Yau Cross Bank 4/12",
            solution: "",
            moveCount: 0,
            pairStart: 1,
            pairEnd: 4,
            alreadyPaired: true,
            verified: true,
          }
        : buildSegment("edge323Bank", "Edge Bank 4/12", seedMoves, 1, 4);
      const segments = [
        bankSegment,
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
        method: edgeMethod,
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
    method: edgeMethod,
    meta: diagnostics,
  };
}
