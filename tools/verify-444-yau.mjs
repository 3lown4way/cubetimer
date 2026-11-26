import assert from "node:assert/strict";
import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";
import { solveYauLastEight323444 } from "../solver/edgePairing444.js";

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
const geometry = (await puzzles["4x4x4"].pg()).get3d();
const wingStickerFaces = Array.from({ length: 24 }, () => []);
for (const { orbit, ord, ori, face, isDup } of geometry.stickers) {
  if (orbit === "EDGES" && !isDup) wingStickerFaces[ord][ori] = geometry.faces[face].name;
}
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

function pairedTypeMask(pattern, allowedSlots = 0x0fff) {
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    if (!(allowedSlots & (1 << slot))) continue;
    const [a, b] = EDGE_SLOT_PAIRS[slot];
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

function orientedCrossSlots(pattern, crossColor) {
  const crossFace = centerFaceForColor(pattern, crossColor);
  const result = new Map();
  if (!crossFace) return result;
  const edges = pattern.patternData.EDGES;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    const [a, b] = EDGE_SLOT_PAIRS[slot];
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (
      ta !== 255 && ta === tb &&
      (crossTypeMask(crossColor) & (1 << ta)) !== 0 &&
      [a, b].every((wing) => {
        const facelet = wingStickerFaces[wing].indexOf(crossFace);
        const piece = Number(edges.pieces[wing]);
        return facelet >= 0 && wingStickerFaces[piece][facelet ^ edges.orientation[wing]] === crossColor;
      })
    ) {
      result.set(ta, slot);
    }
  }
  return result;
}

function pairedCrossTypesAdjacentToCenter(pattern, crossColor) {
  return [...orientedCrossSlots(pattern, crossColor).keys()].reduce((mask, type) => mask | (1 << type), 0);
}

function assertSameCrossSlots(pattern, crossColor, reference, label) {
  const current = orientedCrossSlots(pattern, crossColor);
  for (const [type, slot] of reference) assert.equal(current.get(type), slot, `${label} moved cross edge ${type}`);
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

const TOP_SLOTS = crossTypeMask("U");
const MIDDLE_SLOTS = 0x0fff ^ TOP_SLOTS ^ crossTypeMask("D");

function verifyYauPairingSegment(pattern, segment, tokens, targetMask, { crossColor, lockedMask, fixedSlots = false } = {}) {
  const before = pairedTypeMask(pattern);
  const reference = fixedSlots ? new Map([...orientedCrossSlots(pattern, crossColor)].filter(([type]) => lockedMask & (1 << type))) : null;
  const singleCycle = segment.technique === "align-then-close" || segment.technique === "pair-park-close";
  const wide = tokens.filter((token) => /^[URFDLB]w/.test(token));
  let opened = null;
  let beforeClose = null;
  if (singleCycle) {
    assert.equal(wide.length, 2, `${segment.name} must use one slice cycle`);
    assert.match(wide[0], /^Uw'?$/, "the completed cross stays on D during 3-2-3");
    assert.equal(wide[1], wide[0].endsWith("'") ? "Uw" : "Uw'");
    assert.equal(tokens.at(-1), wide[1]);
  }
  for (const token of tokens) {
    if (singleCycle && token === wide[1]) beforeClose = pattern;
    pattern = pattern.applyMove(token);
    if (singleCycle && token === wide[0]) opened = pattern;
    assert.equal(pairedTypeMask(pattern) & targetMask, targetMask, `cross split during ${segment.name} at ${token}`);
    if (lockedMask) {
      assert.equal(
        pairedCrossTypesAdjacentToCenter(pattern, crossColor) & lockedMask,
        lockedMask,
        `${segment.name} lifted one of the three original cross edges after ${token}`,
      );
    }
    if (reference) assertSameCrossSlots(pattern, crossColor, reference, `${segment.name} ${token}`);
  }
  const after = pairedTypeMask(pattern);
  assert.equal(after & before, before, `${segment.name} lost a completed pair at the checkpoint`);
  assert.equal(segment.pairEnd, bitCount(after));
  assert.equal(segment.pairedAdded, bitCount(after) - bitCount(before));
  if (segment.technique === "already-paired") {
    assert.equal(tokens.length, 0);
    assert.equal(segment.alreadyPaired, true);
  } else if (segment.technique === "align-then-close") {
    assert.equal(tokens[0], wide[0]);
    const formed = pairedTypeMask(pattern, MIDDLE_SLOTS) & ~pairedTypeMask(beforeClose) & ~before;
    const checkpoint = { yau323First3: 7, yau323Next2: 9, yau323Last3: 12 }[segment.id];
    assert.ok(bitCount(formed) >= checkpoint - bitCount(before), `${segment.name} did not pair enough edges on the inverse slice`);
    assert.equal(segment.alignedPairs, bitCount(formed));
  } else if (segment.technique === "pair-park-close") {
    const formed = pairedTypeMask(opened, MIDDLE_SLOTS) & ~before;
    const parked = pairedTypeMask(beforeClose, TOP_SLOTS) & formed;
    const restored = after & ~pairedTypeMask(beforeClose) & ~before;
    assert.ok(parked && restored, "the opened slice must create a pair that is parked while the inverse slice joins another pair");
    assert.equal(segment.pairedOnOpen, bitCount(parked));
    assert.equal(segment.pairedOnClose, bitCount(restored));
  } else {
    assert.equal(segment.technique, "last-two-edges");
    assert.equal(segment.name, "3-2-3 · L2E");
    assert.equal(bitCount(before), 10, "L2E must have exactly two edges left");
    assert.equal(bitCount(after), 12);
  }
  return pattern;
}

async function verifyCase(scramble, crossColor, { expectNatural = false } = {}) {
  const startedStages = new Set();
  const result = await solve444(scramble, (progress) => {
    if (progress.type === "444_stage_start") startedStages.add(progress.stage);
  }, {
    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
  });
  assert.equal(result.ok, true, `Yau failed for ${crossColor}: ${result.reason} ${result.detail || ""}`);
  assert.equal(result.verified, true);
  assert.equal(result.meta.method444, "yau");
  assert.equal(result.meta.yauIndependentStages, true);
  assert.equal(result.meta.yauPlaybackVerified, true);
  assert.equal(result.meta.yauAttempted, true);
  assert.equal(result.meta.yauFallbackReason, null);
  for (const stage of ["YAU_FRAME", "YAU_FIRST_CENTER", "YAU_OPPOSITE_CENTER", "YAU_CROSS3", "YAU_REMAINING_CENTERS", "YAU_CROSS4", "EDGES"]) {
    assert.ok(startedStages.has(stage), `missing Yau progress for ${stage}`);
  }
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
  assert.ok(Number(result.meta.yauViewpointRotationCount) <= 13, "Yau human grip inserted excessive cube rotations");
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
  assert.ok(result.solution.startsWith(`${setup.solution} `), "full playback must use the displayed Yau setup order");
  assert.ok(Number(setup.segments[1].viewpointRotations) >= 1, "Yau opposite center did not flip the first center down");
  assert.ok(Number(setup.segments[2].viewpointRotations) >= 1, "Yau Cross 3/4 did not regrip with the cross center on the side");
  assert.equal(centerFaceForColor(solved.applyAlg(scramble).applyAlg(setup.solution), crossColor), "R", "Yau setup must finish Cross 4/4 with the cross still on R");

  const targetMask = crossTypeMask(crossColor);
  let pattern = solved.applyAlg(scramble);
  pattern = setup.segments[0].solution ? pattern.applyAlg(setup.segments[0].solution) : pattern;
  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "first Yau center was not solved first");
  pattern = setup.segments[1].solution ? pattern.applyAlg(setup.segments[1].solution) : pattern;
  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "first Yau center was not preserved");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "opposite Yau center was not solved second");
  if (expectNatural) {
    assert.equal(allCentersGrouped(pattern), false, "remaining centers were already solved before Cross 3/4");
    assert.ok(bitCount(pairedCrossTypesAdjacentToCenter(pattern, crossColor)) < 3,
      "the Cross 3/4 fixture must start with fewer than three placed cross dedges");
  }
  const cross3 = setup.segments[2];
  const maskOfColors = (colors) => colors.reduce((mask, color) => mask | (crossTypeMask(color) & targetMask), 0);
  const placements = cross3.segments.filter((step) => step.edgeSideColor);
  assert.equal(placements.length, result.meta.yauCross3HumanStepCount);
  if (cross3.segments.length) assert.equal(cross3.segments.map((step) => step.solution).filter(Boolean).join(" "), cross3.solution);
  let held = maskOfColors(cross3.startingSideColors);
  for (const [index, step] of (cross3.segments.length ? cross3.segments : [cross3]).entries()) {
    const turns = step.solution.trim().split(/\s+/).filter(Boolean);
    if (index === 0) {
      while (/^[xyz](?:2|')?$/.test(turns[0] || "")) pattern = pattern.applyMove(turns.shift());
    }
    const anchored = new Map([...orientedCrossSlots(pattern, crossColor)].filter(([type]) => held & (1 << type)));
    assert.equal(anchored.size, bitCount(held));
    for (const turn of turns) {
      pattern = pattern.applyMove(turn);
      assertSameCrossSlots(pattern, crossColor, anchored, `cross insertion ${turn}`);
      assert.equal(centerFaceForColor(pattern, crossColor), "R");
      assert.equal(centerFaceForColor(pattern, OPPOSITE[crossColor]), "L");
    }
    const after = maskOfColors(step.protectedSideColors);
    assert.equal(pairedCrossTypesAdjacentToCenter(pattern, crossColor) & after, after, "cross insertion did not end in the right slot");
    if (step.edgeSideColor) assert.equal(bitCount(after & ~held), 1, "each insertion must complete one new cross edge");
    held = after;
  }
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
  const crossSlots = orientedCrossSlots(pattern, crossColor);
  assert.ok([...crossSlots.values()].every((slot) => !wingStickerFaces[EDGE_SLOT_PAIRS[slot][0]].includes("U")),
    "the working slot must be above the three placed pairs");
  if (expectNatural) {
    assert.equal(allCentersGrouped(pattern), false, "Cross 3/4 must precede the remaining centers in this fixture");
  }
  assert.equal(setup.segments[3].crossLockedEveryMove, true);
  const remainingCenterTokens = String(setup.segments[3].solution || "").trim().split(/\s+/).filter(Boolean);
  for (const token of remainingCenterTokens) {
    pattern = pattern.applyAlg(token);
    assertSameCrossSlots(pattern, crossColor, crossSlots, `last four centers ${token}`);
    assert.equal(
      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & displayedCross3Mask,
      displayedCross3Mask,
      `Yau remaining centers broke the 3-cross after move ${token}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau remaining centers must keep the 3-cross on the R face");
  assert.equal(setup.segments[4].crossLockedEveryMove, true);
  const cross4Tokens = String(setup.segments[4].solution || "").trim().split(/\s+/).filter(Boolean);
  for (const token of cross4Tokens) {
    pattern = pattern.applyAlg(token);
    assertSameCrossSlots(pattern, crossColor, crossSlots, `last cross ${token}`);
    assert.equal(
      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & displayedCross3Mask,
      displayedCross3Mask,
      `Yau Cross 4/4 lifted a completed cross edge after ${token} for ${crossColor}: ${scramble}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau Cross 4/4 disturbed the solved centers");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau Cross 4/4 must finish with the completed cross still on R");
  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");
  assert.equal(
    pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,
    targetMask,
    "Yau Cross 4/4 is not a complete cross around the R-face cross center",
  );

  const edge = result.stages[1];
  assert.equal(edge.id, "edges");
  assert.equal(edge.method, "Yau 3-2-3");
  assert.deepEqual(edge.segments.map((segment) => segment.id), [
    "yau323First3", "yau323Next2", "yau323Last3",
  ]);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  assert.ok(Number(edge.segments[0].viewpointRotations) >= 1, "Yau 3-2-3 must begin by regripping the completed cross from R to D");
  const first323Tokens = String(edge.segments[0].solution || "").trim().split(/\s+/).filter(Boolean);
  let first323TurnIndex = 0;
  while (first323TurnIndex < first323Tokens.length && /^[xyz](?:2|')?$/.test(first323Tokens[first323TurnIndex])) {
    pattern = pattern.applyAlg(first323Tokens[first323TurnIndex]);
    assert.equal(pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask, targetMask);
    first323TurnIndex += 1;
  }
  assert.ok(first323TurnIndex >= 1, "Yau 3-2-3 did not expose a leading cross-down regrip");
  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau 3-2-3 must put the cross on D before its first pairing turn");
  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true);
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  assert.equal(result.meta.yauLastEightOnly, true, "Yau edge pairing must target only the last eight edges");
  assert.equal(result.meta.yauCrossSolvedAtEdgeSegmentBoundaries, true);
  assert.equal(Number(result.meta.yauCrossRestoreMoveCount), 0, "true Yau must not need Cross Restore");
  assert.ok(!edge.segments.some((segment) => /Cross Restore/i.test(segment.name)), "Cross Restore must not exist in Yau");
  for (let segmentIndex = 0; segmentIndex < edge.segments.length; segmentIndex += 1) {
    const segment = edge.segments[segmentIndex];
    const tokens = String(segment.solution || "").trim().split(/\s+/).filter(Boolean);
    const startIndex = segmentIndex === 0 ? first323TurnIndex : 0;
    assert.equal(segment.crossLockedEveryMove, true);
    pattern = verifyYauPairingSegment(pattern, segment, tokens.slice(startIndex), targetMask, {
      crossColor,
      lockedMask: displayedCross3Mask,
      fixedSlots: true,
    });
    assert.equal(centerFaceForColor(pattern, crossColor), "D", `${segment.name} must finish with the cross on D`);
    assert.equal(
      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,
      targetMask,
      `${segment.name} did not restore the complete D-face cross`,
    );
  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");

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

// Freeze the cross-down state of the 45-turn failure so this exercises the
// same Next-2 layout regardless of the frame chosen by the full solver.
const nextTwoScramble = "B' L D' L F' U2 F2 L2 R B' R2 U2 D R2 U2 L2 D' L2 D' F2 U Lw2 D L2 Fw2 B2 L U Fw2 F2 L' U Fw' R F U' Fw' B Lw U B Lw2 Fw2 B Lw'";
const nextTwoSetup = "Uw F Lw Fw Uw2 F Uw2 Rw' U2 Rw Rw B Rw' Fw R' Fw' L' F Dw F' D' F Dw' D R2 D2 Uw2 L' D L Uw2 D Uw' F' Uw F D2 B' Uw' B Uw2 B D2 F D' L Uw2 Uw D' L' D L Uw' D2 R' D' R F";
const nextTwoCross = crossTypeMask("D");
const nextTwoLockedCross = nextTwoCross & (nextTwoCross - 1);
const nextTwoResult = await solveYauLastEight323444(nextTwoScramble, nextTwoSetup, {
  crossTypeMask: nextTwoCross,
  protectedCrossTypeMask: nextTwoLockedCross,
  deadlineTs: Date.now() + 7_000,
});
assert.equal(nextTwoResult.ok, true, `${nextTwoResult.reason}: ${nextTwoResult.detail}`);
assert.deepEqual(nextTwoResult.segments.map((segment) => segment.id), [
  "yau323First3", "yau323Next2", "yau323Last3",
]);
let nextTwoPattern = solved.applyAlg(nextTwoScramble).applyAlg(nextTwoSetup);
const expectedPairedCounts = [7, 9, 12];
for (const [index, segment] of nextTwoResult.segments.entries()) {
  nextTwoPattern = verifyYauPairingSegment(
    nextTwoPattern, segment, segment.solution.split(/\s+/).filter(Boolean), nextTwoCross,
    { crossColor: "D", lockedMask: nextTwoLockedCross },
  );
  assert.ok(allCentersSolved(nextTwoPattern));
  assert.equal(solvedTypeMask(nextTwoPattern) & nextTwoCross, nextTwoCross);
  assert.ok(bitCount(pairedTypeMask(nextTwoPattern)) >= expectedPairedCounts[index]);
}

await verifyCase("Rw U2 F' Lw D B2", "D", { expectNatural: true });
await verifyCase("Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2", "F", { expectNatural: true });
await verifyCase(
  "Rw U' F R2 F Bw' Fw' Dw Bw Dw Uw R Bw Fw2 B2 Fw2 B Uw2 Lw Bw2 R' Lw R' L Bw U2 Bw U' Fw2 D Bw' Uw'",
  "D",
);
await verifyCase("R2 D2 B' U2 F B U2 R' D F2 R2 U' L2 U' R2 B2 R2 D B2 L2 Uw2 Rw2 L' Fw2 B' R' B2 R L' Fw2 F U2 R Uw' F2 Uw' D2 Rw2 Fw U Rw' U2 B' L2 Uw2 B2", "U");
await verifyCase("L D2 L2 D' R F' D F' R2 U F2 B2 U2 L2 F2 U' R2 B2 D F' Uw2 F' Rw2 Uw2 R' Uw2 F Uw2 U2 F' Uw2 F Uw F' L' F2 D Rw2 Fw' Rw' R2 Fw R2 Uw Rw", "L");

const alreadyPaired = await solve444("U", null, { method444: "yau", crossColor: "D", deadlineTs: Date.now() + 60_000 });
assert.equal(alreadyPaired.ok, true, `${alreadyPaired.reason}: ${alreadyPaired.detail}`);
assert.equal(alreadyPaired.stages[0].segments[2].crossEdgeCount, 4);
assert.ok(alreadyPaired.stages[1].segments.every((segment) => segment.alreadyPaired && segment.moveCount === 0));
assert.ok(isSolved(solved.applyAlg("U").applyAlg(alreadyPaired.solution)));

console.log("4x4 Yau three-spoke protection, 3-2-3 slice cycles, L2E, and final verification passed");
