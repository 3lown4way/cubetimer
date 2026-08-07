import assert from "node:assert/strict";
import { puzzles } from "../vendor/cubing/puzzles/index.js";

const EDGE_SLOT_PAIRS = [
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
];
const D_CROSS_TYPES = new Set([4, 5, 6, 7]);
const ALL_MOVES = [..."URFDLB"].flatMap((face) => [face, `${face}'`, `${face}2`, `${face}w`, `${face}w'`, `${face}w2`]);

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();

function centersOnFacesSolved(pattern, faces) {
  const centers = pattern.patternData.CENTERS;
  const solvedCenters = solved.patternData.CENTERS;
  for (const face of faces) {
    for (let i = face * 4; i < face * 4 + 4; i++) {
      if (centers.pieces[i] !== solvedCenters.pieces[i] || centers.orientation[i] !== solvedCenters.orientation[i]) return false;
    }
  }
  return true;
}

function pairedTypes(pattern) {
  const edges = pattern.patternData.EDGES;
  const output = new Set();
  for (let type = 0; type < EDGE_SLOT_PAIRS.length; type++) {
    const [a, b] = EDGE_SLOT_PAIRS[type];
    const pa = edges.pieces[a];
    const pb = edges.pieces[b];
    const ta = EDGE_SLOT_PAIRS.findIndex((pair) => pair.includes(pa));
    const tb = EDGE_SLOT_PAIRS.findIndex((pair) => pair.includes(pb));
    if (ta === type && tb === type && edges.orientation[a] === edges.orientation[b]) output.add(type);
  }
  return output;
}

const phase3 = [];
const phase4 = [];
for (const move of ALL_MOVES) {
  const next = solved.applyAlg(move);
  if (centersOnFacesSolved(next, [0, 3])) phase3.push(move);
  if (centersOnFacesSolved(next, [0, 3]) && centersOnFacesSolved(next, [1, 4])) phase4.push(move);
}

for (const [name, moves] of [["phase3", phase3], ["phase4", phase4]]) {
  for (const move of moves) {
    const next = solved.applyAlg(move);
    const paired = pairedTypes(next);
    for (const type of D_CROSS_TYPES) {
      assert.ok(paired.has(type), `${name} move ${move} breaks D-cross dedge ${type}`);
    }
  }
}

console.log(JSON.stringify({ phase3, phase4 }, null, 2));
console.log("Yau remaining-center moves preserve D-cross dedges");
