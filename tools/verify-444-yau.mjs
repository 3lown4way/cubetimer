import assert from "node:assert/strict";
import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const EDGE_SLOT_PAIRS = [
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
];
const EDGE_SLOT_TO_333 = [0, 8, 9, 4, 5, 7, 6, 3, 11, 10, 2, 1];
const EDGE_NAMES_333 = ["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"];
const EDGE_TYPE_BY_WING = (() => {
  const output = new Uint8Array(24);
  output.fill(255);
  EDGE_SLOT_PAIRS.forEach((pair, type) => pair.forEach((wing) => { output[wing] = type; }));
  return output;
})();
const FACES = ["U", "R", "F", "D", "L", "B"];
const OPPOSITE = { U: "D", R: "L", F: "B", D: "U", L: "R", B: "F" };

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();
const CENTER_POSITIONS_BY_FACE = {};
const CENTER_FACE_BY_PIECE = new Map();
for (const face of FACES) {
  const permutation = kpuzzle.moveToTransformation(face).transformationData.CENTERS.permutation;
  const positions = permutation.flatMap((source, position) => Number(source) !== position ? [position] : []);
  assert.equal(positions.length, 4, `${face} must rotate exactly four 4x4 center slots`);
  CENTER_POSITIONS_BY_FACE[face] = positions;
  for (const position of positions) {
    const piece = Number(solved.patternData.CENTERS.pieces[position]);
    const previous = CENTER_FACE_BY_PIECE.get(piece);
    assert.ok(previous == null || previous === face, `center piece ${piece} belongs to conflicting faces`);
    CENTER_FACE_BY_PIECE.set(piece, face);
  }
}
assert.equal(CENTER_FACE_BY_PIECE.size, 6, "4x4 center orbit should expose six color identities");

function crossTypeMask(face) {
  let mask = 0;
  EDGE_SLOT_TO_333.forEach((cubieIndex, type) => {
    if (EDGE_NAMES_333[cubieIndex].includes(face)) mask |= 1 << type;
  });
  return mask;
}

function pairedTypeMask(pattern) {
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (const [a, b] of EDGE_SLOT_PAIRS) {
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (ta !== 255 && ta === tb && Number(edges.orientation[a]) === Number(edges.orientation[b])) {
      mask |= 1 << ta;
    }
  }
  return mask;
}

function solvedTypeMask(pattern) {
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    const [a, b] = EDGE_SLOT_PAIRS[slot];
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (
      ta === slot && tb === slot &&
      Number(edges.orientation[a]) === 0 && Number(edges.orientation[b]) === 0
    ) mask |= 1 << slot;
  }
  return mask;
}

function bitCount(value) {
  let count = 0;
  for (let x = value >>> 0; x; x &= x - 1) count += 1;
  return count;
}

function faceCentersSolved(pattern, face) {
  const centers = pattern.patternData.CENTERS;
  return CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === face,
  );
}

function allCentersSolved(pattern) {
  return FACES.every((face) => faceCentersSolved(pattern, face));
}

function isSolved(pattern) {
  return pattern.experimentalIsSolved({ ignorePuzzleOrientation: false });
}

async function verifyCase(scramble, crossColor) {
  const result = await solve444(scramble, null, {
    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
  });
  assert.equal(result.ok, true, `Yau failed for ${crossColor}: ${result.reason} ${result.detail || ""}`);
  assert.equal(result.verified, true);
  assert.equal(result.meta.method444, "yau");
  assert.equal(result.meta.yauAttempted, true);
  assert.equal(result.meta.yauFallbackReason, null);
  assert.equal(result.stages.length, 3);

  const setup = result.stages[0];
  assert.equal(setup.id, "centers");
  assert.equal(setup.name, "Yau Setup");
  assert.equal(setup.method, "Yau");
  assert.deepEqual(setup.segments.map((segment) => segment.name), [
    "Yau · First Center",
    "Yau · Opposite Center",
    "Yau · Cross Edges 3/4",
    "Yau · Remaining 4 Centers",
    "Yau · Cross Edge 4/4",
  ]);
  assert.equal(setup.segments.map((segment) => segment.solution).filter(Boolean).join(" "), setup.solution);

  const targetMask = crossTypeMask(crossColor);
  let pattern = solved.applyAlg(scramble);
  pattern = setup.segments[0].solution ? pattern.applyAlg(setup.segments[0].solution) : pattern;
  assert.equal(faceCentersSolved(pattern, crossColor), true, "first Yau center was not solved first");
  pattern = setup.segments[1].solution ? pattern.applyAlg(setup.segments[1].solution) : pattern;
  assert.equal(faceCentersSolved(pattern, OPPOSITE[crossColor]), true, "opposite Yau center was not solved second");
  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;
  assert.ok(bitCount(pairedTypeMask(pattern) & targetMask) >= 3, "Yau Cross 3/4 did not pair three cross dedges");
  const cross3Mask = pairedTypeMask(pattern) & targetMask;
  pattern = setup.segments[3].solution ? pattern.applyAlg(setup.segments[3].solution) : pattern;
  assert.equal(allCentersSolved(pattern), true, "Yau remaining centers did not finish all centers");
  assert.equal((pairedTypeMask(pattern) & cross3Mask), cross3Mask, "remaining centers broke a protected Yau cross dedge");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;
  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not align the completed cross");

  const edge = result.stages[1];
  assert.equal(edge.id, "edges");
  assert.equal(edge.method, "Yau 3-2-3");
  assert.ok(Array.isArray(edge.segments) && edge.segments.length >= 3);
  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  pattern = edge.solution ? pattern.applyAlg(edge.solution) : pattern;
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");

  const cfop = result.stages[2];
  assert.equal(cfop.id, "threeByThree");
  const crossStage = cfop.segments.find((segment) => segment.name === "Cross");
  assert.ok(crossStage, "Yau CFOP did not expose the Cross checkpoint");
  assert.equal(crossStage.moveCount, 0, "a true Yau reduction should enter F2L with the cross already solved");
  assert.equal(result.meta.parityHandledAt, "LL");

  pattern = cfop.solution ? pattern.applyAlg(cfop.solution) : pattern;
  assert.equal(isSolved(pattern), true, "Yau public stage sequence did not solve the cube");
  assert.equal(isSolved(solved.applyAlg(scramble).applyAlg(result.solution)), true);
}

await verifyCase("Rw U2 F' Lw D B2", "D");
await verifyCase("Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2", "F");

console.log("4x4 Yau order, protected cross, 3-2-3 edges, LL parity, and final verification passed");
