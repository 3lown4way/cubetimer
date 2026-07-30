import { KPattern } from "../vendor/cubing/kpuzzle/index.js";
import { cube3x3x3 } from "../vendor/cubing/puzzles/index.js";
import { ZBLS_CASE_INDEX } from "../solver/zbllCaseIndex.js";
import { ZBLS_SUPPLEMENTAL_CASES } from "../solver/zblsSupplementalCases.js";

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const supplemental = new Map(ZBLS_SUPPLEMENTAL_CASES);

const remainingCornerPositions = [0, 1, 2, 3, 6];
const remainingCornerPieces = [0, 1, 2, 3, 6];
const remainingEdgePositions = [0, 1, 2, 3, 11];
const remainingEdgePieces = [0, 1, 2, 3, 11];

function permutationParity(values) {
  let parity = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i] > values[j]) parity ^= 1;
    }
  }
  return parity;
}

function buildEvenPermutation(positions, pieces, specialPiece, specialPosition) {
  const assignment = new Map([[specialPosition, specialPiece]]);
  const freePositions = positions.filter((position) => position !== specialPosition);
  const freePieces = pieces.filter((piece) => piece !== specialPiece);
  freePositions.forEach((position, index) => assignment.set(position, freePieces[index]));
  if (permutationParity(positions.map((position) => assignment.get(position))) !== 0) {
    const [a, b] = freePositions;
    const tmp = assignment.get(a);
    assignment.set(a, assignment.get(b));
    assignment.set(b, tmp);
  }
  return assignment;
}

function buildZblsKey(data) {
  let cornerPosition = -1;
  let cornerOrientation = 0;
  let edgePosition = -1;
  let edgeOrientation = 0;
  for (let position = 0; position < 8; position++) {
    if (data.CORNERS.pieces[position] === 6) {
      cornerPosition = position;
      cornerOrientation = data.CORNERS.orientation[position];
      break;
    }
  }
  for (let position = 0; position < 12; position++) {
    if (data.EDGES.pieces[position] === 11) {
      edgePosition = position;
      edgeOrientation = data.EDGES.orientation[position];
      break;
    }
  }
  const topEdgeOrientation = [0, 1, 2, 3]
    .map((position) => `o${data.EDGES.orientation[position]}`)
    .join(",");
  return `BL:c${cornerPosition},o${cornerOrientation},e${edgePosition},o${edgeOrientation}|TE:${topEdgeOrientation}`;
}

function isZblsSolved(data) {
  for (const position of [4, 5, 6, 7]) {
    if (data.CORNERS.pieces[position] !== position || data.CORNERS.orientation[position] !== 0) return false;
  }
  for (const position of [4, 5, 6, 7, 8, 9, 10, 11]) {
    if (data.EDGES.pieces[position] !== position || data.EDGES.orientation[position] !== 0) return false;
  }
  return [0, 1, 2, 3].every((position) => data.EDGES.orientation[position] === 0);
}

function applyMoves(pattern, moves) {
  try {
    let next = pattern;
    for (const move of moves) next = next.applyMove(move);
    return next;
  } catch {
    return null;
  }
}

function candidateMovesForKey(key) {
  const candidates = [];
  const supplement = supplemental.get(key);
  if (supplement) candidates.push(supplement.trim().split(/\s+/));
  const packedCandidates = ZBLS_CASE_INDEX[key];
  if (Array.isArray(packedCandidates)) {
    for (const packed of packedCandidates) {
      if (Array.isArray(packed?.[2]) && packed[2].length) candidates.push(packed[2]);
    }
  }
  return candidates;
}

const patterns = new Map();
for (const cornerPosition of remainingCornerPositions) {
  for (let cornerOrientation = 0; cornerOrientation < 3; cornerOrientation++) {
    for (const edgePosition of remainingEdgePositions) {
      for (let edgeOrientation = 0; edgeOrientation < 2; edgeOrientation++) {
        for (let topEdgeBits = 0; topEdgeBits < 16; topEdgeBits++) {
          if (edgePosition < 4 && ((topEdgeBits >> edgePosition) & 1) !== edgeOrientation) continue;
          const topFlipCount = topEdgeBits.toString(2).split("1").length - 1;
          if (edgePosition === 11 && ((topFlipCount + edgeOrientation) & 1) !== 0) continue;

          const data = structuredClone(solved.patternData);
          const cornerAssignment = buildEvenPermutation(
            remainingCornerPositions,
            remainingCornerPieces,
            6,
            cornerPosition,
          );
          const edgeAssignment = buildEvenPermutation(
            remainingEdgePositions,
            remainingEdgePieces,
            11,
            edgePosition,
          );
          for (const [position, piece] of cornerAssignment) data.CORNERS.pieces[position] = piece;
          for (const [position, piece] of edgeAssignment) data.EDGES.pieces[position] = piece;
          data.CORNERS.orientation.fill(0);
          data.EDGES.orientation.fill(0);
          data.CORNERS.orientation[cornerPosition] = cornerOrientation;
          const balancingCorner = remainingCornerPositions.find((position) => position !== cornerPosition);
          data.CORNERS.orientation[balancingCorner] = (3 - cornerOrientation) % 3;
          for (let position = 0; position < 4; position++) {
            data.EDGES.orientation[position] = (topEdgeBits >> position) & 1;
          }
          if (edgePosition === 11) {
            data.EDGES.orientation[11] = edgeOrientation;
          } else {
            data.EDGES.orientation[edgePosition] = edgeOrientation;
            data.EDGES.orientation[11] = data.EDGES.orientation.slice(0, 4).reduce((a, b) => a + b, 0) & 1;
          }

          const key = buildZblsKey(data);
          if (!patterns.has(key)) patterns.set(key, new KPattern(kpuzzle, data));
        }
      }
    }
  }
}

const duplicateSupplementKeys = ZBLS_SUPPLEMENTAL_CASES.length - supplemental.size;
const uncovered = [];
const invalidSupplements = [];
let requiredStates = 0;
let coveredStates = 0;

for (const [key, pattern] of patterns) {
  if (isZblsSolved(pattern.patternData)) continue;
  requiredStates += 1;
  const candidates = candidateMovesForKey(key);
  const valid = candidates.some((moves) => {
    const result = applyMoves(pattern, moves);
    return result && isZblsSolved(result.patternData);
  });
  if (valid) coveredStates += 1;
  else uncovered.push(key);
}

for (const [key, algorithm] of ZBLS_SUPPLEMENTAL_CASES) {
  const pattern = patterns.get(key);
  const result = pattern && applyMoves(pattern, algorithm.trim().split(/\s+/));
  if (!result || !isZblsSolved(result.patternData)) invalidSupplements.push(key);
}

const summary = {
  legalKeys: patterns.size,
  requiredStates,
  coveredStates,
  uncoveredCount: uncovered.length,
  supplementalCount: ZBLS_SUPPLEMENTAL_CASES.length,
  duplicateSupplementKeys,
  invalidSupplementCount: invalidSupplements.length,
};
console.log(JSON.stringify(summary));

if (uncovered.length || duplicateSupplementKeys || invalidSupplements.length) {
  if (uncovered.length) console.error("Uncovered ZBLS keys:", uncovered);
  if (invalidSupplements.length) console.error("Invalid supplemental ZBLS keys:", invalidSupplements);
  process.exit(1);
}
