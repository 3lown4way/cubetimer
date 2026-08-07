import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solve444 } from "../solver/solver444.js";

const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
const scramble = "Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2";
const F_PHYSICAL_TO_LOGICAL = { U: "F", R: "R", F: "D", D: "B", L: "L", B: "U" };
function remapFaceSequence(sequence, map) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean).map((token) => {
    const match = /^([URFDLB])(w)?(2|')?$/.exec(token);
    if (!match) throw new Error(`unsupported diagnostic token ${token}`);
    return `${map[match[1]]}${match[2] || ""}${match[3] || ""}`;
  }).join(" ");
}
const logicalScramble = remapFaceSequence(scramble, F_PHYSICAL_TO_LOGICAL);
console.log("logicalScramble", logicalScramble);

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();
const CENTER_FACE_BY_PIECE = (() => {
  const map = new Map();
  const pieces = solved.patternData.CENTERS.pieces;
  for (let position = 0; position < pieces.length; position += 1) {
    map.set(Number(pieces[position]), Math.floor(position / 4));
  }
  return map;
})();
function faceSolvedExact(p, face) {
  const index = FACE_INDEX[face];
  const a = p.patternData.CENTERS;
  const b = solved.patternData.CENTERS;
  for (let i = index * 4; i < index * 4 + 4; i++) {
    if (a.pieces[i] !== b.pieces[i] || a.orientation[i] !== b.orientation[i]) return false;
  }
  return true;
}
function faceSolvedByColor(p, face) {
  const index = FACE_INDEX[face];
  const centers = p.patternData.CENTERS;
  for (let position = index * 4; position < index * 4 + 4; position += 1) {
    if (CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) !== index) return false;
  }
  return true;
}
function solvedFacesExact(p) {
  return Object.keys(FACE_INDEX).filter((face) => faceSolvedExact(p, face));
}
function solvedFacesByColor(p) {
  return Object.keys(FACE_INDEX).filter((face) => faceSolvedByColor(p, face));
}
function centerColorsAtFaces(p) {
  const centers = p.patternData.CENTERS;
  const names = Object.keys(FACE_INDEX);
  return Object.fromEntries(names.map((face) => {
    const index = FACE_INDEX[face];
    const colors = [];
    for (let position = index * 4; position < index * 4 + 4; position += 1) {
      colors.push(CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])));
    }
    return [face, colors];
  }));
}

const logicalResult = await solve444(logicalScramble, null, {
  deadlineTs: Date.now() + 60_000,
  crossColor: "D",
  method444: "yau",
});
console.log("logicalResult", JSON.stringify({ ok: logicalResult.ok, reason: logicalResult.reason, detail: logicalResult.detail }, null, 2));
if (!logicalResult.ok) process.exit(1);
let logicalPattern = solved.applyAlg(logicalScramble);
for (const segment of logicalResult.stages[0]?.segments || []) {
  if (segment.solution) logicalPattern = logicalPattern.applyAlg(segment.solution);
  console.log("logical", segment.name, JSON.stringify({
    solution: segment.solution,
    solvedFacesExact: solvedFacesExact(logicalPattern),
    solvedFacesByColor: solvedFacesByColor(logicalPattern),
    centerColors: centerColorsAtFaces(logicalPattern),
  }));
}

const result = await solve444(scramble, null, {
  deadlineTs: Date.now() + 60_000,
  crossColor: "F",
  method444: "yau",
});
console.log("result", JSON.stringify({ ok: result.ok, reason: result.reason, detail: result.detail, meta: result.meta }, null, 2));
if (!result.ok) process.exit(1);

let pattern = solved.applyAlg(scramble);
const setup = result.stages[0];
console.log("setup", setup.name, setup.method, setup.solution);
for (const segment of setup.segments || []) {
  if (segment.solution) pattern = pattern.applyAlg(segment.solution);
  console.log("physical", segment.name, JSON.stringify({
    solution: segment.solution,
    solvedFacesExact: solvedFacesExact(pattern),
    solvedFacesByColor: solvedFacesByColor(pattern),
    centerColors: centerColorsAtFaces(pattern),
  }));
}
