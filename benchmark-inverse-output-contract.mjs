import assert from "node:assert/strict";
import fs from "node:fs";

import {
  invertOuterAlgorithm,
  isLiteralInverseSolution,
  shouldRejectLiteralInverseSolution,
} from "./solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import {
  solveTwophaseAdaptive333,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const SCRAMBLE = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const REPORTED_INVERSE = "B' R U2 F' U L U' F B D2 F' L2 B U2 R2 L2 B2 U2 D' F2";
const inverse = invertOuterAlgorithm(SCRAMBLE);
assert.equal(inverse, REPORTED_INVERSE, "regression fixture must be the literal inverse");
assert.equal(isLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);
assert.equal(shouldRejectLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);
const shortScramble = "R U R' U'";
const shortInverse = invertOuterAlgorithm(shortScramble);
assert.equal(isLiteralInverseSolution(shortScramble, shortInverse), true);
assert.equal(shouldRejectLiteralInverseSolution(shortScramble, shortInverse), false);

const workerSource = fs.readFileSync(new URL("./solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /excludedSolution:\s*countAlgorithmMoves\(scramble\)\s*>\s*4\s*\?\s*inverseSolution\s*:\s*undefined/);
assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*searched\.solution\)/);
assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*solution\)/);
assert.doesNotMatch(workerSource, /excludedSolution:\s*noFallback\s*\?/);

const twophase = await solveTwophaseAdaptive333(SCRAMBLE, {
  frontierLimits: [2, 12, 48, 192, 768],
  prepareOptions: {
    phase1MaxDepth: 13,
    phase1NodeLimit: 0,
  },
  searchOptions: {
    incumbentLength: inverse.split(/\s+/).length,
    excludedSolution: inverse,
    strictIncumbent: false,
    phase2MaxDepth: 20,
    phase2NodeLimit: 0,
  },
});
assert.equal(twophase?.ok, true, `two-phase failed: ${twophase?.reason || "unknown"}`);
assert.equal(isLiteralInverseSolution(SCRAMBLE, twophase.solution), false, "two-phase returned literal inverse");
const twophaseVerification = await verifyFmcSolutionWasm(SCRAMBLE, twophase.solution);
assert.equal(twophaseVerification?.solved, true, "two-phase regression solution is invalid");

const minmove = await solveMinmoveExactV2(SCRAMBLE, null, {
  timeBudgetMs: 120_000,
});
assert.equal(minmove?.ok, true, `minmove failed: ${minmove?.reason || "unknown"}`);
assert.equal(minmove?.optimalityProven, true, "minmove result is not proven");
assert.equal(isLiteralInverseSolution(SCRAMBLE, minmove.solution), false, "minmove returned literal inverse");
const minmoveVerification = await verifyFmcSolutionWasm(SCRAMBLE, minmove.solution);
assert.equal(minmoveVerification?.solved, true, "minmove regression solution is invalid");

console.log(JSON.stringify({
  scramble: SCRAMBLE,
  inverse,
  twophase: {
    solution: twophase.solution,
    moveCount: twophase.moveCount,
    frontierLimit: twophase.frontierLimit,
  },
  minmove: {
    solution: minmove.solution,
    moveCount: minmove.moveCount,
    proofSource: minmove.proofSource,
    elapsedMs: minmove.elapsedMs,
  },
}));
console.log("inverse output contract passed");
