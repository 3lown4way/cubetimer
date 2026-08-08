import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const FACES = ["U", "R", "F", "D", "L", "B"];
const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();
const positionsByFace = {};
const faceByPiece = new Map();
for (const face of FACES) {
  const perm = kpuzzle.moveToTransformation(face).transformationData.CENTERS.permutation;
  const positions = perm.flatMap((source, position) => Number(source) !== position ? [position] : []);
  positionsByFace[face] = positions;
  for (const position of positions) faceByPiece.set(Number(solved.patternData.CENTERS.pieces[position]), face);
}
function centerFaceForColor(pattern, color) {
  return FACES.find((face) => positionsByFace[face].every(
    (position) => faceByPiece.get(Number(pattern.patternData.CENTERS.pieces[position])) === color,
  )) || null;
}
const scramble = "Rw U2 F' Lw D B2";
const result = await solve444(scramble, null, { deadlineTs: Date.now() + 60_000, crossColor: "D", method444: "yau" });
console.log("ok", result.ok, result.reason);
const setup = result.stages.find((s) => s.id === "centers");
let pattern = solved.applyAlg(scramble);
for (let i = 0; i < setup.segments.length; i += 1) {
  const seg = setup.segments[i];
  if (seg.solution) pattern = pattern.applyAlg(seg.solution);
  console.log(i, seg.name, "crossFace=", centerFaceForColor(pattern, "D"), "rot=", seg.viewpointRotations, "sol=", seg.solution);
}
