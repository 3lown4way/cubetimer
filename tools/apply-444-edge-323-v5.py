from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Runs after v2/v3/v4. Build an exact tiny 2-wing distance table for each
# slice-closing move. The beam can then recognize an almost-complete dedge even
# when closing the slice *right now* would not yet increase the pair count.
marker = '''function centersSolved(state, solvedCenterPieces) {\n'''
helper = r'''const EDGE_PAIR_SIGNATURE_SIZE_444 = 24 * 24 * 2 * 2;
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

'''
if 'function edgePairDistanceHeuristic444(' not in s:
    if marker not in s:
        raise SystemExit('centersSolved insertion marker missing')
    s = s.replace(marker, helper + marker, 1)

old = '          const score = bitCount(candidateMask) * 180 + bitCount(candidateMask & lockedMask) * 220 - depth;\n'
new = '''          const pairDistance = edgePairDistanceHeuristic444(\n            nextState,\n            lockedMask,\n            targetCount,\n            closeMove,\n            model,\n          );\n          const score = bitCount(candidateMask) * 220\n            + bitCount(candidateMask & lockedMask) * 260\n            - pairDistance * 95\n            - depth;\n'''
if old not in s:
    raise SystemExit('slice beam score block missing')
s = s.replace(old, new, 1)

p.write_text(s)
