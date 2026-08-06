import assert from "node:assert/strict";

import { puzzles } from "../vendor/cubing/puzzles/index.js";
import {
  solve444,
  translate444NotationConvention,
} from "../solver/solver444.js";

for (const face of ["U", "R", "F", "D", "L", "B"]) {
  for (const wide of ["", "w"]) {
    for (const suffix of ["", "2", "'"]) {
      const token = `${face}${wide}${suffix}`;
      assert.equal(
        translate444NotationConvention(translate444NotationConvention(token)),
        token,
        `notation conversion is not an involution for ${token}`,
      );
    }
  }
}
assert.equal(
  translate444NotationConvention("U Rw F D' Lw2 B'"),
  "U' Rw' F D Lw2 B'",
);

const scramble = "Rw U2 F' Lw D B2";
const result = await solve444(scramble, null, {
  deadlineTs: Date.now() + 60_000,
});

assert.equal(result.ok, true);
assert.equal(result.verified, true);
assert.equal(result.meta?.fullVerificationSolved, true);
assert.equal(result.meta?.notationConvention, "WCA");
assert.equal(result.stages?.length, 4);
assert.ok(result.solution);

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
const solved = kpuzzle.defaultPattern();
const scrambled = solved.applyAlg(scramble);
const centerStage = result.stages.find((stage) => stage.id === "centers");
assert.ok(centerStage?.verified);
const centersAfterStage = scrambled.applyAlg(centerStage.solution);
const centerOrbitName = Object.keys(solved.patternData).find((name) =>
  name.toUpperCase().includes("CENTER"),
);
assert.ok(centerOrbitName, "4x4 center orbit not found");
const solvedCenterPieces = solved.patternData[centerOrbitName].pieces;
const actualCenterPieces = centersAfterStage.patternData[centerOrbitName].pieces;
const positionsPerFace = solvedCenterPieces.length / 6;
assert.equal(Number.isInteger(positionsPerFace), true);
const colorGroupByPiece = new Map(
  solvedCenterPieces.map((piece, position) => [piece, Math.floor(position / positionsPerFace)]),
);
for (let position = 0; position < actualCenterPieces.length; position += 1) {
  assert.equal(
    colorGroupByPiece.get(actualCenterPieces[position]),
    Math.floor(position / positionsPerFace),
    `Centers stage leaves center position ${position} on the wrong face`,
  );
}

const afterSolution = scrambled.applyAlg(result.solution);
const externallySolved = typeof afterSolution.experimentalIsSolved === "function"
  ? await afterSolution.experimentalIsSolved({ ignorePuzzleOrientation: false })
  : JSON.stringify(afterSolution.patternData) === JSON.stringify(solved.patternData);
assert.equal(externallySolved, true, "public WCA solution does not solve cubing.js 4x4");

console.log("4x4 WCA notation, Centers stage, and final cubing.js verification passed");
