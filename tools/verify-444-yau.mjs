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

function centerColorGroupedSomewhere(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  return FACES.some((face) => CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
  ));
}

function centerFaceForColor(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  return FACES.find((face) => CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
  )) || null;
}

function pairedCrossTypesAdjacentToCenter(pattern, crossColor) {
  const crossFace = centerFaceForColor(pattern, crossColor);
  if (!crossFace) return 0;
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    const slotFacePair = EDGE_NAMES_333[EDGE_SLOT_TO_333[slot]];
    if (!slotFacePair.includes(crossFace)) continue;
    const [a, b] = EDGE_SLOT_PAIRS[slot];
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (
      ta !== 255 && ta === tb &&
      (crossTypeMask(crossColor) & (1 << ta)) !== 0 &&
      Number(edges.orientation[a]) === Number(edges.orientation[b])
    ) {
      mask |= 1 << ta;
    }
  }
  return mask;
}

function allCentersGrouped(pattern) {
  const centers = pattern.patternData.CENTERS;
  const groupedColors = [];
  for (const face of FACES) {
    const colors = new Set(CENTER_POSITIONS_BY_FACE[face].map(
      (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])),
    ));
    if (colors.size !== 1) return false;
    groupedColors.push([...colors][0]);
  }
  return new Set(groupedColors).size === 6;
}

function isSolved(pattern) {
  return pattern.experimentalIsSolved({ ignorePuzzleOrientation: false });
}

async function verifyCase(scramble, crossColor, { expectNatural = false } = {}) {
  const result = await solve444(scramble, null, {
    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
    __yauProtectedCenterBudgetMs: 6000,
  });
  assert.equal(result.ok, true, `Yau failed for ${crossColor}: ${result.reason} ${result.detail || ""}`);
  assert.equal(result.verified, true);
  assert.equal(result.meta.method444, "yau");
  assert.equal(result.meta.yauAttempted, true);
  assert.equal(result.meta.yauFallbackReason, null);
  if (expectNatural) {
    assert.equal(result.meta.yauNaturalCross3Applied, true, `natural Cross 3/4 was not used for ${crossColor}: ${result.meta.yauNaturalCross3FallbackReason}`);
    assert.equal(result.meta.yauRemainingCentersRecomputed, true);
    assert.equal(result.meta.yauCross3Method, "Yau Human Cross 3/4");
    assert.equal(result.meta.yauHumanCross3Applied, true);
    assert.ok(Number(result.meta.yauCross3HumanStepCount) >= 1);
    assert.ok(Number(result.meta.yauCross3HumanStepCount) <= 3);
    assert.equal(bitCount(Number(result.meta.yauCross3SolvedTargetMask) >>> 0), 3);
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 30);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);
    assert.equal(result.meta.yauRemainingCentersCrossLockedEveryMove, true);
  }
  assert.equal(result.meta.humanViewpointApplied, true);
  assert.equal(result.meta.yauHumanGripApplied, true);
  assert.ok(Number(result.meta.yauViewpointRotationCount) >= 3, "Yau human grip did not reorient enough between method phases");
  assert.ok(Number(result.meta.yauViewpointRotationCount) <= 12, "Yau human grip inserted excessive cube rotations");
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
  assert.ok(Number(setup.segments[1].viewpointRotations) >= 1, "Yau opposite center did not flip the first center down");
  assert.ok(Number(setup.segments[2].viewpointRotations) >= 1, "Yau Cross 3/4 did not regrip with the cross center on the side");
  assert.ok(Number(setup.segments[4].viewpointRotations) >= 1, "Yau Cross 4/4 did not return the cross to the bottom");

  const targetMask = crossTypeMask(crossColor);
  let pattern = solved.applyAlg(scramble);
  pattern = setup.segments[0].solution ? pattern.applyAlg(setup.segments[0].solution) : pattern;
  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "first Yau center was not solved first");
  pattern = setup.segments[1].solution ? pattern.applyAlg(setup.segments[1].solution) : pattern;
  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "first Yau center was not preserved");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "opposite Yau center was not solved second");
  const cross3Tokens = String(setup.segments[2].solution || "").trim().split(/\s+/).filter(Boolean);
  const cross3WideTokens = cross3Tokens.filter((token) => /^[URFDLB]w(?:2|')?$/.test(token));
  assert.ok(cross3WideTokens.length >= 2, "human Yau Cross 3/4 did not use a working slice");
  assert.equal(
    cross3WideTokens.length,
    Number(result.meta.yauCross3HumanStepCount) * 2,
    "human Yau Cross 3/4 must use one working-slice open/close pair per committed cross edge",
  );
  for (let index = 0; index < cross3WideTokens.length; index += 2) {
    const open = cross3WideTokens[index];
    const close = cross3WideTokens[index + 1];
    const inverse = open.endsWith("2") ? open : open.endsWith("'") ? open.slice(0, -1) : `${open}'`;
    assert.equal(close, inverse, `human Yau Cross 3/4 did not restore its working slice: ${open} ... ${close}`);
  }
  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;
  const cross3Mask = Number(result.meta.yauCross3SolvedTargetMask) >>> 0;
  assert.equal(
    bitCount(cross3Mask),
    3,
    "canonical Yau Cross 3/4 must have three dedges in their correct cross slots before view rotation",
  );
  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "human-view Cross 3/4 must keep the cross center on the R face");
  const displayedCross3Mask = pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask;
  assert.equal(bitCount(displayedCross3Mask), 3, "displayed Yau Cross 3/4 is not attached to the cross center");
  assert.equal(setup.segments[3].crossLockedEveryMove, true);
  const remainingCenterTokens = String(setup.segments[3].solution || "").trim().split(/\s+/).filter(Boolean);
  for (const token of remainingCenterTokens) {
    pattern = pattern.applyAlg(token);
    assert.equal(
      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & displayedCross3Mask,
      displayedCross3Mask,
      `Yau remaining centers broke the 3-cross after move ${token}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau remaining centers must keep the 3-cross on the R face");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;
  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau Cross 4/4 must return the cross center to the D face before 3-2-3");
  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");
  assert.equal(
    pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,
    targetMask,
    "Yau Cross 4/4 is not a complete cross around the D-face cross center",
  );

  const edge = result.stages[1];
  assert.equal(edge.id, "edges");
  assert.equal(edge.method, "Yau 3-2-3");
  assert.ok(Array.isArray(edge.segments) && edge.segments.length >= 3);
  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau must keep the original four-cross bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  for (const segment of edge.segments) {
    const tokens = String(segment.solution || "").trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      pattern = pattern.applyAlg(token);
      assert.equal(
        pairedTypeMask(pattern) & targetMask,
        targetMask,
        `Yau cross dedge split during ${segment.name} at ${token}`,
      );
    }
  }
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
  return result;
}

await verifyCase("Rw U2 F' Lw D B2", "D", { expectNatural: true });
await verifyCase("Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2", "F", { expectNatural: true });
const crossFrameRegression = await verifyCase(
  "Rw U' F R2 F Bw' Fw' Dw Bw Dw Uw R Bw Fw2 B2 Fw2 B Uw2 Lw Bw2 R' Lw R' L Bw U2 Bw U' Fw2 D Bw' Uw'",
  "D",
);
assert.ok(Number(crossFrameRegression.meta?.yauFrameAttemptCount) >= 2, "Yau cross regression did not exercise frame selection");

console.log("4x4 Yau order, protected cross, cross-frame retry, 3-2-3 edges, LL parity, and final verification passed");
