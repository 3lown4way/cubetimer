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
assert.equal(resolveNxNSolverPuzzle("333mbf"), null);
assert.equal(resolveNxNSolverPuzzle("clock"), null);
assert.equal(isNxNSolverPreviewEvent("555bf"), true);
assert.equal(isNxNSolverPreviewEvent("minx"), false);

const mainSource = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8");
const indexSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const nxnSource = fs.readFileSync(new URL("../solver/nxnTwistyPreview.js", import.meta.url), "utf8");
const solver444UiSource = fs.readFileSync(
  new URL("../solver/solver444UiActivation.js", import.meta.url),
  "utf8",
);

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
assert.match(mainSource, /const solverScramble = currentScramble/);
assert.match(mainSource, /scramble: solverScramble/);
assert.match(mainSource, /showSolverVisualResult\(solverScramble, rawSolutionText, result\.stages, eventId\)/);
assert.doesNotMatch(mainSource, /!isThreeByThreeFamilyEvent\(appState\.settings\.eventId\)/);

// Browser-only activation must not change Node imports or timer behavior.
assert.match(nxnSource, /typeof window !== "undefined" && typeof document !== "undefined"/);
assert.match(nxnSource, /import\("\.\/solver444UiActivation\.js"\)/);
assert.match(nxnSource, /DOMContentLoaded/);

// Standard 4x4 is routed through the existing worker and only verified complete results are exposed.
assert.match(solver444UiSource, /const EVENT_ID = "444"/);
assert.match(solver444UiSource, /const PUZZLE_ID = "4x4x4"/);
assert.match(
  solver444UiSource,
  /new Worker\(new URL\("\.\/solverWorker\.js", import\.meta\.url\), \{ type: "module" \}\)/,
);
assert.match(solver444UiSource, /eventId: EVENT_ID/);
assert.match(
  solver444UiSource,
  /result\?\.ok === true && result\?\.verified === true && String\(result\.solution \|\| ""\)\.trim\(\)/,
);
assert.match(solver444UiSource, /puzzle: PUZZLE_ID/);
assert.match(solver444UiSource, /experimentalSetupAlg = scramble/);
assert.match(solver444UiSource, /threeByThree: "3×3 CFOP"/);
assert.match(solver444UiSource, /solverPlayBtn\.disabled = moves\.length === 0/);
assert.match(solver444UiSource, /solverPlayBtn\.disabled = true/);
assert.match(solver444UiSource, /renderStageItem\(segment, \{ substage: true \}\)/);
assert.match(solver444UiSource, /progress\.cfopStageName/);
assert.match(solver444UiSource, /setThreeByThreeControlsHidden\(true\)/);
assert.match(solver444UiSource, /findSolutionBtn\.addEventListener\("click", solveCurrent444, true\)/);
assert.match(solver444UiSource, /event\.stopImmediatePropagation\(\)/);
assert.match(solver444UiSource, /96-facelet 검증 완료/);
assert.doesNotMatch(solver444UiSource, /444bf|EXTERNAL_CUBING_SEARCH|reverse-scramble/i);

console.log("NxNxN solver preview and verified 4x4 UI activation contract passed");
