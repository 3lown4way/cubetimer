import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const FACES = ["U", "R", "F", "D", "L", "B"];
const crossColor = FACES.includes(String(process.env.CROSS || "D")) ? String(process.env.CROSS || "D") : "D";
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
const scramble = process.env.SCRAMBLE || "Rw U2 F' Lw D B2";
const result = await solve444(scramble, null, { deadlineTs: Date.now() + 60_000, crossColor, method444: "yau" });
console.log("crossColor", crossColor, "ok", result.ok, result.reason);
if (!result.ok) process.exit(2);
const setup = result.stages.find((s) => s.id === "centers");
let pattern = solved.applyAlg(scramble);
for (let i = 0; i < setup.segments.length; i += 1) {
  const seg = setup.segments[i];
  if (seg.solution) pattern = pattern.applyAlg(seg.solution);
  console.log(i, seg.name, "crossFace=", centerFaceForColor(pattern, crossColor), "rot=", seg.viewpointRotations, "sol=", seg.solution);
}
