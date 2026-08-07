// 3-2-3 edge pairing is the preferred human-style fast path; the independently
// verified exact reduction remains a valid fallback when a natural 3-2-3 plan
// is not found inside the bounded search budget.
import assert from "node:assert/strict";

import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const EDGE_SLOT_PAIRS_444 = Object.freeze([
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
]);
const EDGE_TYPE_BY_WING_444 = (() => {
  const edgeTypes = new Array(24).fill(-1);
  EDGE_SLOT_PAIRS_444.forEach((pair, edgeType) => {
    for (const wing of pair) edgeTypes[wing] = edgeType;
  });
  return edgeTypes;
})();

const cases = [
  {
    scramble: "Rw U2 F' Lw D B2",
    require323: true,
  },
  {
    scramble: "Rw U2 F2 Rw' D2 Lw2 B2 U' Fw R2 Uw' B' Rw2 D F2 Lw' U2 B2 Dw R' Fw2 U L2 Bw' D2 Rw U' F2 Dw2 Lw B U2 R2 Fw' D' L2 Uw2 B2 Rw'",
    require323: false,
  },
];

const puzzle444 = await puzzles["4x4x4"].kpuzzle();
const solved444 = puzzle444.defaultPattern();

function pairedEdgeCount(pattern) {
  const edges = pattern.patternData.EDGES;
  let count = 0;
  for (const [first, second] of EDGE_SLOT_PAIRS_444) {
    const firstType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[first])];
    const secondType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[second])];
    if (
      firstType >= 0 &&
      firstType === secondType &&
      Number(edges.orientation[first]) === Number(edges.orientation[second])
    ) {
      count += 1;
    }
  }
  return count;
}

for (const { scramble, require323 } of cases) {
  const result = await solve444(scramble, null, { deadlineTs: Date.now() + 90_000 });
  assert.equal(result.ok, true, `4x4 solve failed: ${result.reason}`);
  assert.equal(result.verified, true, "4x4 result must remain independently verified");

  const centerStage = result.stages.find((stage) => stage.id === "centers");
  const edgeStage = result.stages.find((stage) => stage.id === "edges");
  assert.ok(centerStage?.verified, "verified center stage missing");
  assert.ok(edgeStage?.verified, "verified edge stage missing");

  if (require323) {
    assert.equal(
    edgeStage.method,
    "3-2-3",
    `expected human 3-2-3 edge method for ${scramble}; fallback=${result.meta?.edge323FallbackReason || "none"}`,
  );
  }

  if (edgeStage.method === "3-2-3") {
    assert.ok(edgeStage.moveCount <= 80, `3-2-3 edge stage regressed to ${edgeStage.moveCount} moves`);
    assert.ok(Array.isArray(edgeStage.segments) && edgeStage.segments.length >= 4);
    assert.ok(edgeStage.segments.some((stage) => stage.name === "3-2-3 · First 3"));
    assert.ok(edgeStage.segments.some((stage) => stage.name === "3-2-3 · Next 2"));
    assert.equal(edgeStage.segments.at(-1)?.name, "3-2-3 · L2E");
    assert.equal(
      edgeStage.segments.map((stage) => stage.solution).filter(Boolean).join(" "),
      edgeStage.solution,
      "3-2-3 sub-stages must rebuild the verified edge solution",
    );
  } else {
    assert.ok(Array.isArray(edgeStage.segments) && edgeStage.segments.length > 0,
      "exact edge fallback must retain numbered pairing milestones");
  }

  assert.equal(edgeStage.segments.at(-1)?.pairEnd, 12,
    "edge stage must finish with all twelve dedges paired");

  const afterEdges = solved444
    .applyAlg(scramble)
    .applyAlg(centerStage.solution)
    .applyAlg(edgeStage.solution);
  assert.deepEqual(
    afterEdges.patternData.CENTERS.pieces,
    solved444.patternData.CENTERS.pieces,
    "edge pairing must preserve solved centers",
  );
  assert.equal(pairedEdgeCount(afterEdges), 12, "edge pairing must produce twelve dedges");
}

console.log("4x4 preferred 3-2-3 plus verified exact fallback regression passed");
