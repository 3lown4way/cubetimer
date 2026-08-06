import assert from "node:assert/strict";
import fs from "node:fs";

import {
  NXN_SOLVER_EVENT_TO_PUZZLE,
  isNxNSolverPreviewEvent,
  resolveNxNSolverPuzzle,
} from "../solver/nxnTwistyPreview.js";

assert.deepEqual({ ...NXN_SOLVER_EVENT_TO_PUZZLE }, {
  "222": "2x2x2",
  "333": "3x3x3",
  "333oh": "3x3x3",
  "333bf": "3x3x3",
  "333fm": "3x3x3",
  "333mbf": "3x3x3",
  "444": "4x4x4",
  "444bf": "4x4x4",
  "555": "5x5x5",
  "555bf": "5x5x5",
  "666": "6x6x6",
  "777": "7x7x7",
});
assert.equal(resolveNxNSolverPuzzle("222"), "2x2x2");
assert.equal(resolveNxNSolverPuzzle("444"), "4x4x4");
assert.equal(resolveNxNSolverPuzzle("777"), "7x7x7");
assert.equal(resolveNxNSolverPuzzle("clock"), null);
assert.equal(isNxNSolverPreviewEvent("555bf"), true);
assert.equal(isNxNSolverPreviewEvent("minx"), false);

const mainSource = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

// The timer/dashboard scramble preview must remain the existing 2D component.
assert.match(mainSource, /scramblePreview\.setAttribute\("visualization", "2D"\)/);
assert.match(indexSource, /<scramble-display[\s\S]*?id="scramblePreview"[\s\S]*?visualization="2D"/);
assert.doesNotMatch(indexSource, /scramblePreview3DHost|data-preview-mode=/);

// Only the solver TwistyPlayer becomes puzzle-size aware.
assert.match(mainSource, /import \{ resolveNxNSolverPuzzle \} from "\.\/solver\/nxnTwistyPreview\.js";/);
assert.match(mainSource, /function ensureSolverTwistyPlayer\(puzzleId = resolveNxNSolverPuzzle\(solverPlaybackEventId\)\)/);
assert.match(mainSource, /puzzle: puzzleId/);
assert.match(mainSource, /solverTwistyPuzzleId === puzzleId/);
assert.match(mainSource, /function showSolverVisualResult\(scramble, solution, stages, eventId = appState\.settings\.eventId\)/);
assert.match(mainSource, /const puzzleId = resolveNxNSolverPuzzle\(eventId\)/);
assert.doesNotMatch(mainSource, /!isThreeByThreeFamilyEvent\(appState\.settings\.eventId\)/);

console.log("NxNxN solver-only 3D preview contract passed");
