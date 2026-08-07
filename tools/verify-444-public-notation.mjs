import assert from "node:assert/strict";

import { puzzles } from "../vendor/cubing/puzzles/index.js";
import {
  solve444,
  translate444MoveConvention,
} from "../solver/solver444.js";

const representativeScrambles = [
  "Rw U2 F' Lw D B2",
  // Medium WCA-style public-notation coverage. The deliberately difficult
  // long edge state lives in verify-444-edge-323.mjs so we do not solve that
  // same expensive regression twice in one workflow.
  "Rw U2 F2 Lw' D R2 Fw U' B2 L2 Uw F' Rw2 D2 Bw' U L2 Fw2 R' D",
  // Regression for an OLL where the CFOP database chooses an M-slice algorithm.
  // Keep this case in the GitHub contract so slice-move compilation cannot regress.
  "L' U' F' D' L U2 F B R B2 D' R2 D' R2 L2 U B2 U F2 D2 Fw2 Uw2 F' L' Fw2 U2 F R' B F2 R2 F Uw Rw2 L' Uw B U2 F' U2 Rw Uw' L D' R",
];

assert.equal(
  translate444MoveConvention("U U' U2 Rw Rw' Rw2 F F' Fw Fw' r r'"),
  "U' U U2 Rw' Rw Rw2 F F' Fw Fw' Rw' Rw",
);
for (const scramble of representativeScrambles) {
  assert.equal(
    translate444MoveConvention(translate444MoveConvention(scramble)),
    scramble,
    "the public/internal 4x4 notation conversion must be involutive",
  );
}

const puzzle444 = await puzzles["4x4x4"].kpuzzle();
const solved444 = puzzle444.defaultPattern();
const centerOrbitNames = Object.keys(solved444.patternData).filter((name) => /center/i.test(name));
assert.ok(centerOrbitNames.length > 0, "4x4 center orbit was not found");

function patternIsSolved(pattern) {
  if (typeof pattern.experimentalIsSolved === "function") {
    return pattern.experimentalIsSolved({ ignorePuzzleOrientation: false });
  }
  return JSON.stringify(pattern.patternData) === JSON.stringify(solved444.patternData);
}

for (const scramble of representativeScrambles) {
  const result = await solve444(scramble, null, { deadlineTs: Date.now() + 60_000 });
  assert.equal(result.ok, true, `solver failed for ${scramble}: ${result.reason}`);
  assert.equal(result.verified, true, `unverified result for ${scramble}`);
  assert.equal(result.stages.length, 4);

  const centerStage = result.stages.find((stage) => stage.id === "centers");
  assert.ok(centerStage?.verified, "verified Centers stage is missing");
  const afterCenters = solved444.applyAlg(scramble).applyAlg(centerStage.solution);
  for (const orbitName of centerOrbitNames) {
    assert.deepEqual(
      afterCenters.patternData[orbitName],
      solved444.patternData[orbitName],
      `public Centers stage did not solve ${orbitName} for ${scramble}`,
    );
  }

  const edgeStage = result.stages.find((stage) => stage.id === "edges");
  assert.ok(edgeStage?.verified, "verified Edge Pairing stage is missing");
  assert.ok(Array.isArray(edgeStage.segments) && edgeStage.segments.length >= 2);
  assert.equal(edgeStage.segments.at(-1).pairEnd, 12);
  assert.equal(
    edgeStage.segments.map((segment) => segment.solution).filter(Boolean).join(" "),
    edgeStage.solution,
    "edge pairing sub-stages must rebuild the verified edge solution",
  );

  const cfopStage = result.stages.find((stage) => stage.id === "threeByThree");
  assert.equal(cfopStage?.name, "3x3 CFOP");
  assert.deepEqual(
    cfopStage.segments.map((stage) => stage.name),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
  );
  assert.equal(result.meta.cfopMethod, "CFOP");
  for (const segment of cfopStage.segments) {
    for (const move of String(segment.solution || "").trim().split(/\s+/).filter(Boolean)) {
      assert.match(move, /^[URFDLB](?:2|')?$/, `4x4 CFOP emitted unsupported move ${move}`);
    }
  }

  let stagePattern = solved444.applyAlg(scramble);
  for (const stage of result.stages) {
    stagePattern = stage.solution ? stagePattern.applyAlg(stage.solution) : stagePattern;
  }
  assert.equal(patternIsSolved(stagePattern), true, `public stage sequence did not solve ${scramble}`);

  const afterFullSolution = solved444.applyAlg(scramble).applyAlg(result.solution);
  assert.equal(
    patternIsSolved(afterFullSolution),
    true,
    `public WCA-notation solution did not solve ${scramble}`,
  );
}

console.log("4x4 public WCA notation, edge pairing detail, CFOP, and Centers regression passed");
