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
const EDGE_323_MIDDLE_SLOTS = Object.freeze([1, 2, 8, 9]); // FR FL BL BR
const EDGE_323_MIDDLE_MASK = EDGE_323_MIDDLE_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_OPPOSITE_SLOTS = Object.freeze([3, 4, 5, 6]); // DF DR DL DB
const EDGE_323_OPPOSITE_MASK = EDGE_323_OPPOSITE_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
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
  const centerPermutation = Uint8Array.from(data.CENTERS.permutation);
  const centerOrientationDelta = Uint8Array.from(data.CENTERS.orientationDelta);
  let centerPermutationIdentity = true;
  let centerOrientationIdentity = true;
  for (let position = 0; position < 24; position += 1) {
    if (centerPermutation[position] !== position) centerPermutationIdentity = false;
    if (centerOrientationDelta[position] !== 0) centerOrientationIdentity = false;
  }
  return {
    edgePermutation: Uint8Array.from(data.EDGES.permutation),
    edgeOrientationDelta: Uint8Array.from(data.EDGES.orientationDelta),
    centerPermutation,
    centerOrientationDelta,
    centerPermutationIdentity,
    centerOrientationIdentity,
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

  const centerPieces = action.centerPermutationIdentity
    ? state.centerPieces
    : new Uint8Array(24);
  const reuseCenterOrientation = action.centerPermutationIdentity && action.centerOrientationIdentity;
  const centerOrientation = reuseCenterOrientation
    ? state.centerOrientation
    : new Uint8Array(24);
  if (!action.centerPermutationIdentity) {
    for (let position = 0; position < 24; position += 1) {
      const source = action.centerPermutation[position];
      centerPieces[position] = state.centerPieces[source];
    }
  }
  if (!reuseCenterOrientation) {
    for (let position = 0; position < 24; position += 1) {
      const source = action.centerPermutation[position];
      centerOrientation[position] = state.centerOrientation[source] ^ action.centerOrientationDelta[position];
    }
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

const CUBE_ROTATION_FACE_MAPS_444 = Object.freeze({
  x: Object.freeze({ U: "B", B: "D", D: "F", F: "U", R: "R", L: "L" }),
  y: Object.freeze({ U: "U", R: "B", B: "L", L: "F", F: "R", D: "D" }),
  z: Object.freeze({ U: "R", R: "D", D: "L", L: "U", F: "F", B: "B" }),
});

function composeFaceMap444(faceMap, rotationMap) {
  const result = {};
  for (const face of "URFDLB") result[face] = rotationMap[faceMap[face]];
  return result;
}

function buildCubeOrientationFaceMaps444() {
  const identity = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };
  const keyFor = (faceMap) => [..."URFDLB"].map((face) => faceMap[face]).join("");
  const queue = [identity];
  const maps = [];
  const seen = new Set();
  while (queue.length) {
    const faceMap = queue.shift();
    const key = keyFor(faceMap);
    if (seen.has(key)) continue;
    seen.add(key);
    maps.push(Object.freeze({ ...faceMap }));
    for (const rotation of ["x", "y", "z"]) {
      queue.push(composeFaceMap444(faceMap, CUBE_ROTATION_FACE_MAPS_444[rotation]));
    }
  }
  if (maps.length !== 24) throw new Error(`444_ORIENTATION_FACE_MAP_COUNT:${maps.length}`);
  return Object.freeze(maps);
}

const CUBE_ORIENTATION_FACE_MAPS_444 = buildCubeOrientationFaceMaps444();

function remapMoveToken444(token, faceMap) {
  const match = /^([URFDLB])(w)?(2|')?$/.exec(String(token || ""));
  if (!match) return token;
  return `${faceMap[match[1]]}${match[2] || ""}${match[3] || ""}`;
}

function remapAlgorithmToWideFace444(algorithm, targetWideFace) {
  const tokens = splitAlgorithm(algorithm);
  const wideFaces = [...new Set(tokens.filter((token) => /^[URFDLB]w/.test(token)).map((token) => token[0]))];
  if (wideFaces.length !== 1) return null;
  const sourceWideFace = wideFaces[0];
  const targetFace = String(targetWideFace || "").charAt(0).toUpperCase();
  const faceMap = CUBE_ORIENTATION_FACE_MAPS_444.find((candidate) => candidate[sourceWideFace] === targetFace);
  if (!faceMap) return null;
  return tokens.map((token) => remapMoveToken444(token, faceMap)).join(" ");
}

function conjugatedActionPoolForWideFace444(baseActions, targetWideFace, model) {
  const seen = new Set();
  const pool = [];
  for (const base of baseActions) {
    const algorithm = remapAlgorithmToWideFace444(base.algorithm, targetWideFace);
    if (!algorithm || seen.has(algorithm)) continue;
    seen.add(algorithm);
    pool.push({ algorithm, action: model.actionFor(algorithm) });
  }
  return pool;
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

const IDENTITY_EDGE_ACTION_444 = {
  edgePermutation: Uint8Array.from({ length: 24 }, (_, position) => position),
  edgeOrientationDelta: new Uint8Array(24),
};

function pairedEdgeTypeMask(state, action = IDENTITY_EDGE_ACTION_444) {
  return pairedEdgeTypeMaskInSlots(state, 0x0fff, action);
}

function solvedEdgeTypeMask(state, action = IDENTITY_EDGE_ACTION_444, slots = 0x0fff) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(slots & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstSource = action.edgePermutation[first];
    const secondSource = action.edgePermutation[second];
    if (
      EDGE_TYPE_BY_WING_444[state.edgePieces[firstSource]] === slot &&
      EDGE_TYPE_BY_WING_444[state.edgePieces[secondSource]] === slot &&
      state.edgeOrientation[firstSource] === action.edgeOrientationDelta[first] &&
      state.edgeOrientation[secondSource] === action.edgeOrientationDelta[second]
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

function pairedEdgeTypeMaskInSlots(state, slotMask, action = IDENTITY_EDGE_ACTION_444) {
  const { edgePermutation, edgeOrientationDelta } = action;
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(slotMask & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstSource = edgePermutation[first];
    const secondSource = edgePermutation[second];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[firstSource]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[secondSource]];
    if (
      firstType !== 255 &&
      firstType === secondType &&
      (state.edgeOrientation[firstSource] ^ edgeOrientationDelta[first]) ===
        (state.edgeOrientation[secondSource] ^ edgeOrientationDelta[second])
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

function transformEdgePairSignature444(index, action, destination) {
  const [firstPosition, secondPosition, firstOrientation, secondOrientation] = decodeEdgePairSignature444(index);
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
  const closeDestination = edgeDestinationBySource444(closeAction);
  const outerActions = [...model.outerActions.values()].map((action) => ({
    action,
    destination: edgeDestinationBySource444(action),
  }));
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
          const closed = transformEdgePairSignature444(index, closeAction, closeDestination);
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
    for (const { action, destination } of outerActions) {
      const next = transformEdgePairSignature444(current, action, destination);
      if (distance[next] !== 255) continue;
      distance[next] = nextDistance;
      queue[tail++] = next;
    }
  }

  edgePairDistanceCache444.set(cacheKey, distance);
  return distance;
}

function edgePairDistanceHeuristic444(state, lockedTypeMask, targetCount, closeMove, model, targetTypeMask = 0x0fff) {
  const needed = Math.max(0, targetCount - bitCount(lockedTypeMask & targetTypeMask));
  if (!needed) return 0;
  const table = buildEdgePairDistanceTable444(closeMove, model);
  const positions = new Uint8Array(24);
  for (let position = 0; position < 24; position += 1) {
    positions[state.edgePieces[position]] = position;
  }

  const distances = [];
  const openTypes = targetTypeMask & ~lockedTypeMask;
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (!(openTypes & (1 << edgeType))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[edgeType];
    const firstPosition = positions[first];
    const secondPosition = positions[second];
    const signature = encodeEdgePairSignature444(
      firstPosition, secondPosition, state.edgeOrientation[firstPosition], state.edgeOrientation[secondPosition],
    );
    const distance = table[signature];
    if (distance !== 255) distances.push(distance);
  }
  if (distances.length < needed) return 99;
  if (distances.length > needed) distances.sort((left, right) => left - right);
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
  const edges = String.fromCharCode.apply(null, state.edgePieces) +
    String.fromCharCode.apply(null, state.edgeOrientation);
  return includeCenters
    ? edges + String.fromCharCode.apply(null, state.centerPieces) +
      String.fromCharCode.apply(null, state.centerOrientation)
    : edges;
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
        middleMask: EDGE_323_MIDDLE_MASK,
        lastLayerMask: EDGE_323_OPPOSITE_MASK,
        openMoves: ["Dw", "Dw'"],
      };
    }
    const inverseRotation = invertAlgorithm(rotation);
    const rotationAction = actionFor(rotation);
    const bankMask = transformSlotMask(EDGE_323_BANK_MASK, rotationAction);
    const middleMask = transformSlotMask(EDGE_323_MIDDLE_MASK, rotationAction);
    const lastLayerMask = transformSlotMask(EDGE_323_OPPOSITE_MASK, rotationAction);
    const conjugatedOpen = actionFor(`${rotation} Dw ${inverseRotation}`);
    const openMove = findEquivalentWideMove(conjugatedOpen, actionFor);
    if (!openMove || openMove.endsWith("2")) {
      throw new Error(`444_323_SLICE_FRAME_FAILED:${rotation}`);
    }
    return {
      rotation,
      bankMask,
      middleMask,
      lastLayerMask,
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

function sliceCyclePath444(node) {
  const moves = [];
  for (let current = node; current?.parent; current = current.parent) {
    moves.push(current.move);
  }
  return moves.reverse();
}

function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES, requiredSolvedTypeMask = 0, options = {}) {
  const solvedCenters = model.solvedCompact;
  const openMoves = sliceFamily.openMoves;
  const targetTypeMask = (Number(options?.targetTypeMask) >>> 0) || 0x0fff;
  const exactTargetCount = options?.exactTargetCount === true;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
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
    const openedState = applyCompactAction(initialState, openAction, true);
    if (
      requiredPairedEveryMoveMask &&
      !maskContains(pairedEdgeTypeMask(openedState), requiredPairedEveryMoveMask)
    ) continue;
    let beam = [{
      state: openedState,
      parent: null,
      move: "",
      lastFace: "",
      score: 0,
    }];

    for (let depth = 0; depth <= maxOuterMoves; depth += 1) {
      if (deadlineReached(deadlineTs)) return null;
      for (const node of beam) {
        const closedMask = pairedEdgeTypeMask(node.state, closeAction);
        const targetPairedCount = bitCount(closedMask & targetTypeMask);
        if (
          maskContains(closedMask, lockedMask) &&
          (exactTargetCount ? targetPairedCount === targetCount : targetPairedCount >= targetCount)
        ) {
          const closedState = applyCompactAction(node.state, closeAction, true);
          if (
            (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(closedState), requiredSolvedTypeMask)) &&
            centersOkay(closedState)
          ) {
            return { state: closedState, mask: closedMask, moves: [openMove, ...sliceCyclePath444(node), closeMove] };
          }
        }
      }
      if (depth === maxOuterMoves) break;

      const seen = new Map();
      for (let index = 0; index < beam.length; index += 1) {
        if ((index & 63) === 0 && deadlineReached(deadlineTs)) return null;
        const node = beam[index];
        for (const move of OUTER_MOVES_444) {
          if (node.lastFace && move[0] === node.lastFace) continue;
          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          if (
            requiredPairedEveryMoveMask &&
            !maskContains(pairedEdgeTypeMask(nextState), requiredPairedEveryMoveMask)
          ) continue;
          const candidateMask = pairedEdgeTypeMask(nextState, closeAction);
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
              parent: node,
              move,
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

function applyTokenPathPreservingPairedTypes444(state, moves, model, requiredPairedMask = 0) {
  let current = state;
  for (const move of moves) {
    current = applyCompactAction(current, model.actionFor(move), true);
    if (requiredPairedMask && !maskContains(pairedEdgeTypeMask(current), requiredPairedMask)) return null;
  }
  return current;
}

function findL2E(
  initialState,
  model,
  deadlineTs,
  requiredSolvedTypeMask = 0,
  actionPool = null,
  requiredPairedEveryMoveMask = 0,
  crossGap = null,
) {
  const solvedCenters = model.solvedCompact;
  const l2eActions = Array.isArray(actionPool) ? actionPool : model.l2eActions;
  for (let setupIndex = 0; setupIndex < L2E_SETUP_PATHS.length; setupIndex += 1) {
    if ((setupIndex & 0x01ff) === 0 && deadlineReached(deadlineTs)) return null;
    const rawSetup = L2E_SETUP_PATHS[setupIndex];
    // In Yau the setup rotates D only to aim the working gap.
    if (crossGap && rawSetup.some((turn) => turn[0] === "D")) continue;
    const setup = crossGap ? aimYauCrossGap444(rawSetup, crossGap) : rawSetup;
    const setupState = applyMovePath(initialState, setup, model);
    for (const l2e of l2eActions) {
      // Outer setup/undo turns preserve pairing. Test the macro as a single
      // permutation before paying for a per-move replay and the undo turns.
      if (pairedEdgeTypeMask(setupState, l2e.action) !== 0x0fff) continue;
      const undo = setup.slice().reverse().map(invertMoveToken);
      const algorithm = splitAlgorithm(l2e.algorithm);
      const afterMacro = requiredPairedEveryMoveMask
        ? applyTokenPathPreservingPairedTypes444(setupState, algorithm, model, requiredPairedEveryMoveMask)
        : applyCompactAction(setupState, l2e.action, true);
      if (!afterMacro) continue;
      const candidate = applyMovePath(afterMacro, undo, model);
      if (
        (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(candidate), requiredSolvedTypeMask)) &&
        centersSolved(candidate, solvedCenters.centerPieces)
      ) {
        return { state: candidate, moves: [...setup, ...algorithm, ...undo] };
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
  actionPool = null,
  requiredPairedEveryMoveMask = 0,
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

  const searchActions = Array.isArray(actionPool) ? actionPool : model.seedActions;
  if (!searchActions.length) return null;
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
      for (let actionIndex = 0; actionIndex < searchActions.length; actionIndex += 1) {
        const searchAction = searchActions[actionIndex];
        const nextState = requiredPairedEveryMoveMask
          ? applyTokenPathPreservingPairedTypes444(
              node.state,
              splitAlgorithm(searchAction.algorithm),
              model,
              requiredPairedEveryMoveMask,
            )
          : applyCompactAction(node.state, searchAction.action, true);
        if (!nextState) continue;
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
  const requestedMacros = Number(options?.maxMacros ?? YAU_TARGET_MAX_MACROS);
  const maxMacros = Number.isFinite(requestedMacros)
    ? Math.max(0, Math.min(YAU_TARGET_RESCUE_MAX_MACROS, Math.trunc(requestedMacros)))
    : YAU_TARGET_MAX_MACROS;
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

function crossFaceTurns444(model, face) {
  return ["", face, `${face}2`, `${face}'`].map((turn) => ({ turn, action: model.actionFor(turn) }));
}

function crossBankAlignment444(state, faceTurns, lockedMask) {
  return faceTurns.find(({ action }) => maskContains(solvedEdgeTypeMask(state, action, lockedMask), lockedMask));
}

function wingSignatureForType444(state, edgeType) {
  const [first, second] = EDGE_SLOT_PAIRS_444[edgeType];
  const p1 = state.edgePieces.indexOf(first);
  const p2 = state.edgePieces.indexOf(second);
  return encodeEdgePairSignature444(p1, p2, state.edgeOrientation[p1], state.edgeOrientation[p2]);
}

function projectedWingMove444(model, moves) {
  const action = model.actionFor(moves.join(" "));
  const destination = edgeDestinationBySource444(action);
  return { moves, apply: (signature) => transformEdgePairSignature444(signature, action, destination) };
}

function* yauWingSetups444(start, moves, deadlineTs) {
  const pending = [{ signature: start, moves: [] }];
  const seen = new Set([start]);
  for (let index = 0; index < pending.length; index += 1) {
    if (deadlineReached(deadlineTs)) return;
    const entry = pending[index];
    yield entry;
    for (const move of moves) {
      const signature = move.apply(entry.signature);
      if (seen.has(signature)) continue;
      seen.add(signature);
      pending.push({ signature, moves: [...entry.moves, ...move.moves] });
    }
  }
}

function wingSignaturePairedIn444(signature, slots) {
  const [a, b, ao, bo] = decodeEdgePairSignature444(signature);
  const slot = EDGE_TYPE_BY_WING_444[a];
  return ao === bo && a !== b && slot === EDGE_TYPE_BY_WING_444[b] && Boolean(slots & (1 << slot));
}

function crossSideFace444(type) {
  return EDGE_NAMES_333_444[EDGE_SLOT_TO_333_444[type]].replace("D", "");
}

export function crossSideColors444(mask) {
  return EDGE_SLOT_PAIRS_444.flatMap((_, type) => mask & (1 << type) ? [crossSideFace444(type)] : []);
}

function cross3Turns444(model, lockedMask, backFace) {
  const outerAndWide = ["U", "Uw", "F", "R", "L", "B"]
    .filter((layer) => layer !== backFace)
    .flatMap((layer) => [layer, `${layer}'`, `${layer}2`].map((turn) => [turn]));
  const moves = [...outerAndWide, ["Dw", "D'"], ["Dw'", "D"], ["Dw2", "D2"]];
  return moves.filter((turns) => maskContains(
    solvedEdgeTypeMask(model.solvedCompact, model.actionFor(turns.join(" ")), lockedMask), lockedMask,
  )).map((turns) => ({ ...projectedWingMove444(model, turns), cost: turns.length === 1 ? 2 : 5 }));
}

function findCross3Insertion444(state, moves, edgeType, model, deadlineTs) {
  const goal = wingSignatureForType444(model.solvedCompact, edgeType);
  const start = wingSignatureForType444(state, edgeType);
  const buckets = [[{ signature: start, turns: [] }]];
  const costs = new Map([[start, 0]]);
  for (let cost = 0; cost < buckets.length; cost += 1) {
    if (deadlineReached(deadlineTs)) return null;
    for (const entry of buckets[cost] ?? []) {
      if (cost !== costs.get(entry.signature)) continue;
      if (entry.signature === goal) return { turns: entry.turns, cost };
      for (const move of moves) {
        const signature = move.apply(entry.signature);
        const nextCost = cost + move.cost;
        if (nextCost >= (costs.get(signature) ?? Infinity)) continue;
        costs.set(signature, nextCost);
        (buckets[nextCost] ??= []).push({ signature, turns: [...entry.turns, ...move.moves] });
      }
    }
  }
  return null;
}

function planYauCross3(pattern, initial, model, initialMask, targetMask, backFace, deadlineTs) {
  let current = pattern;
  let state = initial;
  let lockedMask = initialMask;
  const steps = [];
  const faceTurns = crossFaceTurns444(model, "D");
  while (bitCount(lockedMask) < 3) {
    const allowed = cross3Turns444(model, lockedMask, backFace);
    let best = null;
    for (let type = 0; type < EDGE_SLOT_PAIRS_444.length; type += 1) {
      if (!((targetMask & ~lockedMask) & (1 << type))) continue;
      const insertion = findCross3Insertion444(state, allowed, type, model, deadlineTs);
      if (insertion && (!best || insertion.cost < best.cost)) best = { type, ...insertion };
    }
    if (!best) return null;
    for (const turn of best.turns) {
      current = current.applyMove(turn);
      state = compactStateFromPattern(current);
      if (!crossBankAlignment444(state, faceTurns, lockedMask) || !protectedCenterFacesSolved444(state, model, ["D", "U"])) {
        throw new Error("444_YAU_CROSS3_LOCK_FAILED");
      }
    }
    lockedMask |= 1 << best.type;
    if (!maskContains(solvedEdgeTypeMask(state), lockedMask)) throw new Error("444_YAU_CROSS3_PLACEMENT_FAILED");
    steps.push({ turns: best.turns, lockedMask, edgeFace: crossSideFace444(best.type) });
  }

  const crossMask = crossEdgeTypeMask444("D");
  if (lockedMask === crossMask) lockedMask &= lockedMask - 1;
  const workingFace = crossSideFace444(31 - Math.clz32(crossMask & ~lockedMask));
  // If the working spoke also became solved, move just that spoke aside.
  if (maskContains(solvedEdgeTypeMask(state), crossMask)) {
    current = current.applyMove(workingFace);
    if ((solvedEdgeTypeMask(compactStateFromPattern(current)) & crossMask) !== lockedMask) {
      throw new Error("444_YAU_WORKING_GAP_FAILED");
    }
    steps.push({ turns: [workingFace], lockedMask, workingGap: true });
  }
  return { steps, pattern: current, initialMask, lockedMask, crossCount: 3, workingFace };
}

export async function solveYauFirstThreeCross444(pattern, deadlineTs, scorePlan) {
  const model = await getPlannerModel();
  const crossMask = crossEdgeTypeMask444("D");
  const initial = compactStateFromPattern(pattern);
  if (!protectedCenterFacesSolved444(initial, model, ["D", "U"])) {
    throw new Error("444_YAU_CROSS3_CENTERS_NOT_READY");
  }

  const initialMask = solvedEdgeTypeMask(initial) & crossMask;
  if (initialMask === crossMask && centersSolved(initial, model.solvedCompact.centerPieces)) {
    return { steps: [], pattern, initialMask, lockedMask: initialMask, crossCount: 4, workingFace: "F" };
  }

  let best = planYauCross3(pattern, initial, model, initialMask, crossMask, null, deadlineTs);
  if (!best) throw new Error(deadlineReached(deadlineTs) ? "444_DEADLINE_REACHED" : "444_YAU_CROSS3_NOT_FOUND");
  if (!scorePlan) return best;
  let bestScore = scorePlan(best);
  // Try leaving the rear slot empty while building the other three. That
  // can keep all three insertions in one grip before turning the gap up.
  for (const [type] of EDGE_SLOT_PAIRS_444.entries()) {
    const gap = 1 << type;
    if (!((crossMask & ~initialMask) & gap) || deadlineReached(deadlineTs)) continue;
    const backFace = crossSideFace444(type);
    const candidate = planYauCross3(pattern, initial, model, initialMask, crossMask & ~gap, backFace, deadlineTs);
    if (!candidate) continue;
    const score = scorePlan(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function yauCrossGap444(model, targetType, turns = crossFaceTurns444(model, "D")) {
  const [gapWing] = EDGE_SLOT_PAIRS_444[targetType];
  const offsets = {};
  for (const [offset, { action }] of turns.entries()) {
    const slot = EDGE_TYPE_BY_WING_444[action.edgePermutation.indexOf(gapWing)];
    const face = crossSideFace444(slot);
    offsets[face] = offset;
  }
  return { targetType, turns, offsets };
}

// Turn the empty spoke under each side turn and restore the cross after
// the trigger. U moves and the upper working slice leave the gap in place.
function aimYauCrossGap444(moves, gap) {
  let offset = 0;
  const result = [];
  for (const move of moves) {
    const next = gap.offsets[move[0]] ?? offset;
    if (next !== offset) result.push(gap.turns[(next - offset + 4) % 4].turn);
    result.push(move);
    offset = next;
  }
  if (offset) result.push(gap.turns[4 - offset].turn);
  return result;
}

function planYauLastCrossEdge444(initial, model, sliceFamily, requiredMask, gap, deadlineTs) {
  const targetType = gap.targetType;
  const workingFace = crossSideFace444(targetType);
  const triggers = yauOuterInsertions444(model, requiredMask, gap)
    .map(({ moves }) => projectedWingMove444(model, moves));
  const openers = sliceFamily.openMoves.map((open) => ({
    open: projectedWingMove444(model, [open]),
    close: projectedWingMove444(model, [invertMoveToken(open)]),
  }));
  const setups = [...triggers, ...[workingFace, `${workingFace}'`, `${workingFace}2`].map(
    (move) => projectedWingMove444(model, [move]),
  )].sort((a, b) => a.moves.length - b.moves.length);
  const goal = wingSignatureForType444(model.solvedCompact, targetType);
  const start = wingSignatureForType444(initial, targetType);
  const placements = new Map();
  for (const { signature, moves } of yauWingSetups444(goal, setups, deadlineTs)) {
    placements.set(signature, splitAlgorithm(invertAlgorithm(moves.join(" "))));
  }
  if (placements.has(start)) return { moves: placements.get(start), technique: "insert-paired", insertionMoves: placements.get(start).length };

  // With the other three spokes parked, identify the two missing wings.
  // Try bringing them together with the slice, or use the edge flip to
  // prepare a same-slice pair. Restore the centers before the cross insert.
  let best = null;
  for (const setup of yauWingSetups444(start, setups, deadlineTs)) {
    if (best && setup.moves.length + 3 >= best.moves.length) continue;
    for (const { open, close } of openers) {
      const opened = open.apply(setup.signature);
      const joined = wingSignaturePairedIn444(opened, sliceFamily.middleMask);
      for (const trigger of triggers) {
        const ready = trigger.apply(opened);
        if (joined) {
          if (!wingSignaturePairedIn444(ready, sliceFamily.lastLayerMask)) continue;
        } else if (trigger.moves.length !== 7) {
          continue;
        }
        const insertion = placements.get(close.apply(ready));
        if (!insertion) continue;
        const moves = [...setup.moves, ...open.moves, ...trigger.moves, ...close.moves, ...insertion];
        if (!best || moves.length < best.moves.length) {
          best = { moves, technique: joined ? "slice-park-insert" : "slice-flip-insert", insertionMoves: insertion.length };
        }
      }
    }
  }
  return best;
}

export async function solveYauCross4Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const startedAt = Date.now();
  const deadlineTs = Number(options.deadlineTs) || 0;
  const budgetMs = Math.max(250, Math.min(8000, Number(options.timeBudgetMs) || 500));
  const localDeadline = Math.min(deadlineTs || Infinity, startedAt + budgetMs);
  const model = await getPlannerModel();
  const pattern = model.solved.applyAlg(publicScramble || "").applyAlg(publicSetupSolution || "");
  const initial = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const requiredMask = Number(options.requiredTypeMask) >>> 0;
  if (targetMask !== crossEdgeTypeMask444("D") || bitCount(requiredMask) < 3 || !maskContains(targetMask, requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_MASK_INVALID" };
  }
  if (!centersSolved(initial, model.solvedCompact.centerPieces) || !maskContains(solvedEdgeTypeMask(initial), requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_SETUP_INVALID" };
  }
  const sliceFamily = model.sliceFamilies.find((family) => family.bankMask === targetMask);
  const targetType = 31 - Math.clz32(targetMask & ~requiredMask);
  const gapTurns = crossFaceTurns444(model, "D");
  const plan = maskContains(solvedEdgeTypeMask(initial), targetMask)
    ? { moves: [], technique: "already-paired", insertionMoves: 0 }
    : planYauLastCrossEdge444(
        initial, model, sliceFamily, requiredMask, yauCrossGap444(model, targetType, gapTurns), localDeadline,
      );
  if (!plan) {
    return { ok: false, reason: deadlineReached(localDeadline) ? "444_YAU_HUMAN_CROSS4_TIMEOUT" : "444_YAU_HUMAN_CROSS4_NOT_FOUND" };
  }
  let verified = initial;
  for (const move of plan.moves) {
    verified = applyCompactAction(verified, model.actionFor(move));
    if (!crossBankAlignment444(verified, gapTurns, requiredMask)) {
      return { ok: false, reason: "444_YAU_HUMAN_CROSS4_CROSS_LOCK_FAILED", detail: move };
    }
  }
  if (!centersSolved(verified, model.solvedCompact.centerPieces) || !maskContains(solvedEdgeTypeMask(verified), targetMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_VERIFY_FAILED" };
  }
  return {
    ok: true,
    solution: plan.moves.join(" "),
    moveCount: plan.moves.length,
    alignmentMoveCount: plan.insertionMoves,
    technique: plan.technique,
    method: "Yau Human Cross 4/4",
    elapsedMs: Date.now() - startedAt,
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

// D adjustments commute with U/Uw. Drop redundant turns of the cross face
// between working triggers while preserving the order of the pairing slice.
export function simplifyYauCrossTurns444(moves) {
  const result = [];
  let run = [];

  function flush() {
    const lastAdjustment = run.findLastIndex((turn) => /^D(?:2|')?$/.test(turn));
    let amount = 0;
    for (const turn of run) {
      if (turn[0] !== "D" || turn[1] === "w") continue;
      amount = (amount + (turn.endsWith("2") ? 2 : turn.endsWith("'") ? 3 : 1)) % 4;
    }
    for (const [index, turn] of run.entries()) {
      if (turn[0] !== "D" || turn[1] === "w") result.push(turn);
      else if (index === lastAdjustment && amount) result.push(`D${["", "", "2", "'"][amount]}`);
    }
    run = [];
  }

  for (const move of moves) {
    if (/^[UD]w?(?:2|')?$/.test(move)) run.push(move);
    else {
      flush();
      result.push(move);
    }
  }
  flush();
  return simplifyOuterSequence(result);
}

function yauRemainingPairedMask444(state, crossMask) {
  return pairedEdgeTypeMask(state) & (0x0fff ^ crossMask);
}

function yauBoundaryOkay444(state, model, crossMask, minimumRemaining = 0) {
  return centersSolved(state, model.solvedCompact.centerPieces) &&
    maskContains(pairedEdgeTypeMask(state), crossMask) &&
    maskContains(solvedEdgeTypeMask(state), crossMask) &&
    bitCount(yauRemainingPairedMask444(state, crossMask)) >= minimumRemaining;
}

const YAU_OUTER_INSERTIONS_444 = Object.freeze((() => {
  const moves = ["U", "U'", "U2"];
  const sides = ["R", "B", "L", "F"];
  for (let index = 0; index < sides.length; index += 1) {
    const side = sides[index];
    const front = sides[(index + 3) % sides.length];
    for (const u of ["U", "U'", "U2"]) {
      moves.push(`${side} ${u} ${side}'`, `${side}' ${u} ${side}`);
    }
    // Front-right edge flip, viewed from each side with the cross down.
    moves.push(`${side} U ${side}' ${front} ${side}' ${front}' ${side}`);
  }
  return moves;
})());

function yauOuterInsertions444(model, crossMask, gap = null) {
  model.yauOuterInsertions ??= new Map();
  const key = `${crossMask}:${gap?.targetType ?? ""}`;
  if (!model.yauOuterInsertions.has(key)) {
    const insertions = YAU_OUTER_INSERTIONS_444.map((original) => {
      const tokens = splitAlgorithm(original);
      const moves = gap ? aimYauCrossGap444(tokens, gap) : tokens;
      const algorithm = moves.join(" ");
      const cost = moves.reduce((sum, move) => sum + (move[0] === "D" ? 2 : 1), 0);
      return { algorithm, moves, cost, action: model.actionFor(algorithm), auf: original.startsWith("U") };
    }).filter(({ action }) => {
      const state = applyCompactAction(model.solvedCompact, action);
      return maskContains(solvedEdgeTypeMask(state), crossMask) &&
        centersSolved(state, model.solvedCompact.centerPieces);
    }).sort((a, b) => a.cost - b.cost);
    model.yauOuterInsertions.set(key, insertions);
  }
  return model.yauOuterInsertions.get(key);
}

function searchYauAlignedPairs444(initial, model, deadlineTs, pairing, targetCount) {
  const { sliceFamily, crossMask, insertions } = pairing;
  const initialPairs = yauRemainingPairedMask444(initial, crossMask);
  const needed = targetCount - bitCount(initialPairs);
  if (needed <= 0) {
    return [{ state: initial, moves: [], technique: "already-paired" }];
  }
  const alignments = new Map();
  const goals = new Map();
  let frontier = [];
  for (const open of sliceFamily.openMoves) {
    const close = invertMoveToken(open);
    const closeAction = model.actionFor(close);
    const state = applyCompactAction(initial, model.actionFor(open));
    if (!maskContains(solvedEdgeTypeMask(state), crossMask)) continue;
    const prepared = pairedEdgeTypeMaskInSlots(state, sliceFamily.middleMask, closeAction);
    frontier.push({ state, moves: [open], close, closeAction, prepared, auf: false, cost: 1, score: 0 });
  }

  // While the E slice is open, an edge is prepared when the *inverse slice*
  // would join the matching wings in a middle-layer slot. Keep these matches
  // as more partners are inserted. One inverse turn then joins the group.
  for (let depth = 0; frontier.length && depth < 6; depth += 1) {
    const next = new Map();
    for (const node of frontier) {
      if (deadlineReached(deadlineTs)) break;
      for (const insertion of insertions) {
        if (node.auf && insertion.auf) continue;
        const state = applyCompactAction(node.state, insertion.action, false);
        const prepared = pairedEdgeTypeMaskInSlots(state, sliceFamily.middleMask, node.closeAction);
        if (!maskContains(prepared, node.prepared)) continue;
        const moves = [...node.moves, ...insertion.moves];
        const cost = node.cost + insertion.cost;
        const preparedCount = bitCount(prepared);
        if (preparedCount >= needed) {
          const closed = applyCompactAction(state, node.closeAction);
          const newPairsOnClose = prepared & ~pairedEdgeTypeMask(state) & ~initialPairs;
          if (bitCount(newPairsOnClose) >= needed && yauBoundaryOkay444(closed, model, crossMask, targetCount) &&
              maskContains(pairedEdgeTypeMask(closed), initialPairs)) {
            const key = compactStateKey(closed);
            const previous = goals.get(key);
            if (!previous || cost < previous.cost) {
              goals.set(key, { state: closed, moves: [...moves, node.close], cost, technique: "align-then-close" });
            }
            if (goals.size >= 16) break;
            continue;
          }
        }
        const key = node.close + compactStateKey(state);
        const score = preparedCount * 100 - cost;
        if (score <= (alignments.get(key) ?? -Infinity)) continue;
        alignments.set(key, score);
        next.set(key, { ...node, state, moves, prepared, auf: insertion.auf, cost, score });
      }
      if (goals.size >= 16) break;
    }
    if (goals.size >= 8 || deadlineReached(deadlineTs)) break;
    frontier = [...next.values()].sort((left, right) => right.score - left.score).slice(0, 300);
  }
  return [...goals.values()].sort((a, b) => a.cost - b.cost).slice(0, 12);
}

function* yauOuterSetups444(initial, insertions) {
  yield { state: initial, moves: [], auf: false };
  const used = new Set([compactStateKey(initial)]);
  let frontier = [{ state: initial, moves: [], auf: false }];
  for (let depth = 0; depth < 2; depth += 1) {
    const next = [];
    for (const node of frontier) {
      for (const insertion of insertions) {
        if (node.auf && insertion.auf) continue;
        const state = applyCompactAction(node.state, insertion.action, false);
        const key = compactStateKey(state);
        if (used.has(key)) continue;
        used.add(key);
        const entry = { state, moves: [...node.moves, ...insertion.moves], auf: insertion.auf };
        yield entry;
        next.push(entry);
      }
    }
    frontier = next;
  }
}

function* searchYauPairingCycles444(initial, targetCount, model, deadlineTs, pairing) {
  const beforePairs = pairedEdgeTypeMask(initial);
  const { sliceFamily, crossMask, insertions, closersByOpenTurn } = pairing;
  const seen = new Set();
  let prepareIndex = 0;
  for (const pre of yauOuterSetups444(initial, insertions)) {
    if (deadlineReached(deadlineTs)) return;
    // One trigger on each side of the slice is tried first. Reserve a second
    // trigger after the opening for the short setups, before widening the set.
    const maxInsertions = prepareIndex++ <= insertions.length ? 2 : 1;
    for (const open of sliceFamily.openMoves) {
      const close = invertMoveToken(open);
      const opened = applyCompactAction(pre.state, model.actionFor(open));
      if (!maskContains(solvedEdgeTypeMask(opened), crossMask)) continue;
      const pairedOnOpen = pairedEdgeTypeMaskInSlots(opened, sliceFamily.middleMask) & ~beforePairs;
      if (!pairedOnOpen) continue;
      const closers = closersByOpenTurn.get(open);
      let frontier = [{ state: opened, moves: [], auf: false }];
      for (let depth = 0; depth < maxInsertions; depth += 1) {
        const next = [];
        for (const node of frontier) {
          for (const insertion of closers) {
            if (node.auf && insertion.auf) continue;
            if (depth + 1 < maxInsertions) {
              next.push({ state: applyCompactAction(node.state, insertion.action, false), moves: insertion.moves, auf: insertion.auf });
            }
            const pairs = pairedEdgeTypeMask(node.state, insertion.closedAction);
            if (!maskContains(pairs, beforePairs) || bitCount(pairs & ~crossMask) < targetCount) continue;
            const parked = pairedEdgeTypeMaskInSlots(node.state, sliceFamily.lastLayerMask, insertion.action) & pairedOnOpen;
            const pairedOnClose = (pairs & ~beforePairs) & ~pairedEdgeTypeMask(node.state, insertion.action);
            if (!parked || !pairedOnClose) continue;
            const state = applyCompactAction(node.state, insertion.closedAction);
            if (!yauBoundaryOkay444(state, model, crossMask, targetCount)) continue;
            const key = compactStateKey(state);
            if (seen.has(key)) continue;
            seen.add(key);
            yield {
              state,
              moves: [...pre.moves, open, ...node.moves, ...insertion.moves, close],
              technique: "pair-park-close",
            };
          }
          if (deadlineReached(deadlineTs)) return;
        }
        frontier = next;
      }
    }
  }
}

function* collectYauNextTwoCandidates444(first, model, deadlineTs, pairing) {
  if (bitCount(yauRemainingPairedMask444(first, pairing.crossMask)) >= 5) {
    yield { state: first, moves: [], technique: "already-paired" };
    return;
  }
  let foundCycle = false;
  for (const cycle of searchYauPairingCycles444(first, 5, model, deadlineTs, pairing)) {
    foundCycle = true;
    yield cycle;
  }
  if (!foundCycle) yield* searchYauAlignedPairs444(first, model, deadlineTs, pairing, 5);
}

function finishYauLastThree444(initial, model, deadlineTs, pairing) {
  const { crossMask, l2eActions, gap } = pairing;
  const pairedCount = bitCount(yauRemainingPairedMask444(initial, crossMask));
  if (pairedCount === 8) return { state: initial, moves: [], technique: "already-paired" };
  if (pairedCount >= 6) {
    const l2e = findL2E(initial, model, deadlineTs, crossMask, l2eActions, crossMask, gap);
    if (l2e) return { ...l2e, technique: "last-two-edges" };
  }
  const cycle = searchYauPairingCycles444(initial, 8, model, deadlineTs, pairing).next().value;
  return cycle || searchYauAlignedPairs444(initial, model, deadlineTs, pairing, 8)[0] || null;
}

function yauGapL2EActions444(model, gap) {
  // Put the L2E slice above the cross, where it cannot split the three spokes.
  const rotations = CUBE_ORIENTATION_FACE_MAPS_444.filter((map) => map.R === "U");
  return rotations.flatMap((rotation) => model.l2eActions.map(({ algorithm }) => {
    const rotated = splitAlgorithm(algorithm).map((move) => remapMoveToken444(move, rotation));
    const safe = aimYauCrossGap444(rotated, gap).join(" ");
    return { algorithm: safe, action: model.actionFor(safe) };
  }));
}

export async function solveYauLastEight323444(publicScramble, publicYauSetup, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossMask = Number(options?.crossTypeMask ?? options?.requiredTypeMask) >>> 0;
  const startedAt = Date.now();
  const model = await getPlannerModel();
  if (bitCount(crossMask) !== 4) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_MASK_INVALID", solution: "", segments: [] };
  }
  if (deadlineReached(deadlineTs)) {
    return { ok: false, reason: "444_YAU_LAST8_DEADLINE_REACHED", solution: "", segments: [] };
  }

  let pattern = model.solved;
  const scramble = String(publicScramble || "").trim();
  const setup = String(publicYauSetup || "").trim();
  if (scramble) pattern = pattern.applyAlg(scramble);
  if (setup) pattern = pattern.applyAlg(setup);
  const state = compactStateFromPattern(pattern);

  if (!centersSolved(state, model.solvedCompact.centerPieces)) {
    return { ok: false, reason: "444_YAU_LAST8_CENTERS_NOT_SOLVED", solution: "", segments: [] };
  }
  if (!maskContains(pairedEdgeTypeMask(state), crossMask)) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_NOT_PAIRED", solution: "", segments: [] };
  }
  if (!maskContains(solvedEdgeTypeMask(state), crossMask)) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_NOT_SOLVED", solution: "", segments: [] };
  }

  // In the canonical solver frame the four solved cross slots are exactly the
  // protected bank of one 3-2-3 slice family.  Human presentation later rotates
  // this frame so the same cross is visually on D.
  const sliceFamily = model.sliceFamilies.find((family) => family.bankMask === crossMask);
  if (!sliceFamily) {
    return { ok: false, reason: "444_YAU_LAST8_WORKING_SLICE_MISSING", solution: "", segments: [] };
  }
  const protectedMask = Number(options.protectedCrossTypeMask) >>> 0;
  if (protectedMask && (bitCount(protectedMask) !== 3 || !maskContains(crossMask, protectedMask) ||
      crossMask !== crossEdgeTypeMask444("D"))) {
    return { ok: false, reason: "444_YAU_LAST8_PROTECTED_CROSS_MASK_INVALID", solution: "", segments: [] };
  }
  const gap = protectedMask ? yauCrossGap444(model, 31 - Math.clz32(crossMask & ~protectedMask)) : null;
  const insertions = yauOuterInsertions444(model, crossMask, gap);
  const closersByOpenTurn = new Map(sliceFamily.openMoves.map((open) => {
    const close = invertMoveToken(open);
    return [open, insertions.map((insertion) => ({
      ...insertion,
      closedAction: model.actionFor(`${insertion.algorithm} ${close}`),
    }))];
  }));
  const pairing = {
    sliceFamily,
    crossMask,
    gap,
    insertions,
    l2eActions: gap ? yauGapL2EActions444(model, gap) : null,
    closersByOpenTurn,
  };

  const initialRemainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  const budgetMs = Math.max(1000, Math.min(20000, Number(options?.timeBudgetMs) || 12000));
  const localDeadline = startedAt + budgetMs;
  const edgeStageDeadline = deadlineTs > 0 ? Math.min(deadlineTs, localDeadline) : localDeadline;

  // FIRST 3: only the completed cross is sacred. Incidental non-cross pairs
  // are not locked; a human Yau solver may let those move while forming the
  // three stored pairs.
  const first3Candidates = searchYauAlignedPairs444(
    state, model, edgeStageDeadline, pairing, 3,
  ).filter((candidate) => yauBoundaryOkay444(candidate.state, model, crossMask));
  if (!first3Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }

  let chosenPipeline = null;
  let nextCandidateCount = 0;
  for (const [index, first] of first3Candidates.entries()) {
    if (deadlineReached(edgeStageDeadline)) break;
    const now = Date.now();
    const timePerCandidate = (edgeStageDeadline - now) / (first3Candidates.length - index);
    const firstDeadline = Math.min(edgeStageDeadline, now + Math.max(900, Math.floor(timePerCandidate)));
    const next2Candidates = collectYauNextTwoCandidates444(first.state, model, firstDeadline, pairing);
    for (const next of next2Candidates) {
      if (deadlineReached(firstDeadline)) break;
      nextCandidateCount += 1;
      const finish = finishYauLastThree444(next.state, model, firstDeadline, pairing);
      if (finish) {
        chosenPipeline = { first, next, finish };
        break;
      }
    }
    if (chosenPipeline) break;
  }

  if (!chosenPipeline) {
    return {
      ok: false,
      reason: deadlineReached(edgeStageDeadline)
        ? "444_YAU_LAST8_LOCAL_DEADLINE"
        : "444_YAU_LAST8_LOOKAHEAD_FAILED",
      detail: JSON.stringify({ firstCandidates: first3Candidates.length, nextCandidates: nextCandidateCount }),
      solution: "",
      segments: [],
    };
  }

  const phases = [
    ["yau323First3", "3-2-3 · First 3", chosenPipeline.first],
    ["yau323Next2", "3-2-3 · Next 2", chosenPipeline.next],
    ["yau323Last3", "3-2-3 · Last 3", chosenPipeline.finish],
  ];
  let pairedBefore = 4 + initialRemainingCount;
  const segments = phases.map(([id, label, plan]) => {
    const alreadyPaired = plan.technique === "already-paired";
    const pairedAfter = bitCount(pairedEdgeTypeMask(plan.state));
    const name = plan.technique === "last-two-edges" ? "3-2-3 · L2E" : label;
    const segment = buildSegment(id, name, plan.moves, alreadyPaired ? pairedBefore : pairedBefore + 1, pairedAfter);
    const pairedAdded = pairedAfter - pairedBefore;
    pairedBefore = pairedAfter;
    return { ...segment, technique: plan.technique, alreadyPaired, pairedAdded, crossLockedEveryMove: Boolean(gap) };
  });
  const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");

  let replayState = state;
  const checkpoints = [3, 5, 8];
  for (const [index, segment] of segments.entries()) {
    const before = pairedEdgeTypeMask(replayState);
    let opened = null;
    let beforeClose = null;
    const moves = splitAlgorithm(segment.solution);
    const wide = moves.filter((move) => move[1] === "w");
    const singleCycle = segment.technique === "align-then-close" || segment.technique === "pair-park-close";
    if (singleCycle && (wide.length !== 2 || invertMoveToken(wide[0]) !== wide[1] || moves.at(-1) !== wide[1])) {
      return { ok: false, reason: "444_YAU_LAST8_SLICE_NOT_RESTORED", detail: segment.name, solution: "", segments: [] };
    }
    for (const move of moves) {
      if (singleCycle && move === wide[1]) beforeClose = replayState;
      replayState = applyCompactAction(replayState, model.actionFor(move));
      if (singleCycle && move === wide[0]) opened = replayState;
      if (!maskContains(pairedEdgeTypeMask(replayState), crossMask)) {
        return { ok: false, reason: "444_YAU_LAST8_CROSS_SPLIT", detail: `${segment.name}:${move}`, solution: "", segments: [] };
      }
      if (gap && !crossBankAlignment444(replayState, gap.turns, protectedMask)) {
        return { ok: false, reason: "444_YAU_LAST8_CROSS_LOCK_FAILED", detail: `${segment.name}:${move}`, solution: "", segments: [] };
      }
    }
    const after = pairedEdgeTypeMask(replayState);
    if (!yauBoundaryOkay444(replayState, model, crossMask, checkpoints[index]) || !maskContains(after, before)) {
      return { ok: false, reason: "444_YAU_LAST8_CHECKPOINT_FAILED", detail: segment.name, solution: "", segments: [] };
    }
    if (!singleCycle) continue;
    const createdOnClose = after & ~pairedEdgeTypeMask(beforeClose);
    if (segment.technique === "align-then-close") {
      const aligned = pairedEdgeTypeMaskInSlots(replayState, sliceFamily.middleMask) & createdOnClose & ~before;
      const needed = checkpoints[index] - bitCount(before & ~crossMask);
      if (moves[0] !== wide[0] || bitCount(aligned) < needed) {
        return { ok: false, reason: "444_YAU_WINGS_NOT_ALIGNED", detail: segment.name, solution: "", segments: [] };
      }
      segment.alignedPairs = bitCount(aligned);
    } else {
      const createdOnOpen = pairedEdgeTypeMaskInSlots(opened, sliceFamily.middleMask) & ~before;
      const parked = pairedEdgeTypeMaskInSlots(beforeClose, sliceFamily.lastLayerMask) & createdOnOpen;
      if (!parked || !(createdOnClose & ~before)) {
        return { ok: false, reason: "444_YAU_CYCLE_WINGS_NOT_PARKED", detail: segment.name, solution: "", segments: [] };
      }
      segment.pairedOnOpen = bitCount(parked);
      segment.pairedOnClose = bitCount(createdOnClose & ~before);
      const expectedGain = index === 1 ? 2 : 3;
      if (segment.pairedAdded !== expectedGain) {
        segment.name = `Yau · ${index === 1 ? "Next" : "Last"} ${segment.pairedAdded}`;
      }
    }
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: splitAlgorithm(solution).length,
    segments,
    method: "Yau 3-2-3 · Last 8",
    meta: {
      lastEightOnly: true,
      crossRestoreRequired: false,
      protectedCrossPairedEveryMove: true,
      crossSolvedAtSegmentBoundaries: true,
      initialRemainingPairedCount: initialRemainingCount,
      workingSlice: sliceFamily.openMoves[0][0],
      diagnostics: { elapsedMs: Math.max(0, Date.now() - startedAt) },
    },
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

  const candidateFamilies = yauBank
    ? model.sliceFamilies.filter((family) => family.bankMask === requiredTypeMask)
    : model.sliceFamilies;
  const diagnostics = {
    frameCount: candidateFamilies.length,
    seedCandidates: 0,
    firstThreeFailures: 0,
    nextTwoFailures: 0,
    lastThreeFailures: 0,
    l2eFailures: 0,
    verificationFailures: 0,
  };

  for (let frameIndex = 0; frameIndex < candidateFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = candidateFamilies[frameIndex];
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
      const yauSeedActions = yauBank
        ? conjugatedActionPoolForWideFace444(model.seedActions, sliceFamily.openMoves[0][0], model)
        : model.seedActions;
      const yauL2EActions = yauBank
        ? conjugatedActionPoolForWideFace444(model.l2eActions, sliceFamily.openMoves[0][0], model)
        : model.l2eActions;
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
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          yauSeedActions,
          requiredTypeMask,
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
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          yauSeedActions,
          requiredTypeMask,
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
          splitAlgorithm(yauSeedActions[actionIndex].algorithm)
        );
        const secondMoves = nextTwoSecond.path.flatMap((actionIndex) =>
          splitAlgorithm(yauSeedActions[actionIndex].algorithm)
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
            YAU_TARGET_BEAM_WIDTH,
            false,
            false,
            yauSeedActions,
            requiredTypeMask,
          );
          finalSetup = multiCycle
            ? {
                state: multiCycle.state,
                mask: multiCycle.pairedMask,
                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(yauSeedActions[actionIndex].algorithm)
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
        : findL2E(
            beforeL2E.state,
            model,
            deadlineTs,
            requiredSolvedTypeMask,
            yauBank ? yauL2EActions : null,
            yauBank ? requiredTypeMask : 0,
          );
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
