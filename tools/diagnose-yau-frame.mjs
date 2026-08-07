import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const scramble = "Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2";
const result = await solve444(scramble, null, {
  deadlineTs: Date.now() + 60_000,
  crossColor: "F",
  method444: "yau",
});
console.log("result", JSON.stringify({ ok: result.ok, reason: result.reason, detail: result.detail, meta: result.meta }, null, 2));
if (!result.ok) process.exit(1);

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();
let pattern = solved.applyAlg(scramble);
function faceSolved(p, face) {
  const index = FACE_INDEX[face];
  const a = p.patternData.CENTERS;
  const b = solved.patternData.CENTERS;
  for (let i = index * 4; i < index * 4 + 4; i++) {
    if (a.pieces[i] !== b.pieces[i] || a.orientation[i] !== b.orientation[i]) return false;
  }
  return true;
}
function solvedFaces(p) {
  return Object.keys(FACE_INDEX).filter((face) => faceSolved(p, face));
}

const setup = result.stages[0];
console.log("setup", setup.name, setup.method, setup.solution);
for (const segment of setup.segments || []) {
  if (segment.solution) pattern = pattern.applyAlg(segment.solution);
  console.log(segment.name, JSON.stringify({ solution: segment.solution, solvedFaces: solvedFaces(pattern) }));
}
