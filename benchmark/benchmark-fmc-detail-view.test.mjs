import assert from "node:assert/strict";
import {
  buildFmcInsertionNarrative,
  reconstructFmcRawMoves,
  traceAdjacentCancellation,
} from "./benchmark-fmc-cancellation-view.js";

const parts = [
  { name: "Premove", solution: "R2 L'", moveCount: 2, notes: "" },
  { name: "정방향 탐색", solution: "", moveCount: 0, notes: "normal side, RL축" },
  { name: "EO", solution: "D L2 D F", moveCount: 4, notes: "RL축, normal side" },
  { name: "DR", solution: "D2 U2 L D' R' B2 D'", moveCount: 7, notes: "normal side" },
  { name: "P2 / Skeleton 진행", solution: "F2 U2 L'", moveCount: 3, notes: "normal side" },
  {
    name: "Skeleton",
    solution: "R2 L' D L2 D F D2 U2 L D' R' B2 D' U2 L2 U2 F2 U2 L",
    moveCount: 19,
    notes: "3-edge cycle",
  },
  { name: "Leave", solution: "", moveCount: 0, notes: "3-edge cycle" },
  {
    name: "Insertion 1",
    solution: "U2 F2 U2 L2 U2 F2 U2 L2",
    moveCount: 8,
    notes: "edge3, 위치 14",
  },
  { name: "Cancellation", solution: "", moveCount: 0, notes: "27 → 16 (-11)" },
  {
    name: "Final",
    solution: "R2 L' D L2 D F D2 U2 L D' R' B2 D' F2 U2 L'",
    moveCount: 16,
    notes: "RL축, FMC_INSERTION_EDGE3_FMC_PREMOVE_RL",
  },
];
const finalSolution = "R2 L' D L2 D F D2 U2 L D' R' B2 D' F2 U2 L'";
const raw = reconstructFmcRawMoves(parts);
assert.equal(raw.length, 27);
const trace = traceAdjacentCancellation(raw);
assert.equal(trace.moves.join(" "), finalSolution);
assert.deepEqual(trace.steps, [
  "U2 U2 → ∅",
  "L2 L2 → ∅",
  "U2 U2 → ∅",
  "F2 F2 → ∅",
  "U2 U2 → ∅",
  "L2 L → L'",
]);

const narrative = buildFmcInsertionNarrative(parts, finalSolution);
assert.ok(narrative);
assert.equal(narrative.sharedPrefixLength, 13);
assert.equal(narrative.skeletonTail.join(" "), "U2 L2 U2 F2 U2 L");
assert.equal(narrative.finalTail.join(" "), "F2 U2 L'");
assert.equal(narrative.rawMoveCount, 27);
assert.equal(narrative.finalMoveCount, 16);
assert.equal(narrative.cancellationCount, 11);
assert.equal(narrative.changedWindow.start, 14);
assert.equal(narrative.traceMatchesFinal, true);
assert.equal(narrative.insertions[0].position, 14);
assert.equal(narrative.insertions[0].kind, "edge3");

console.log("FMC insertion detail narrative verified");
