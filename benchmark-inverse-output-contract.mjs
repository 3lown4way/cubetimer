import assert from "node:assert/strict";
import fs from "node:fs";

import {
  invertOuterAlgorithm,
  isLiteralInverseSolution,
  normalizeOuterAlgorithm,
  shouldRejectLiteralInverseSolution,
} from "./solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import {
  solveTwophaseAdaptive333,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const SCRAMBLE = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const REPORTED_INVERSE = "B' R U2 F' U L U' F B D2 F' L2 B U2 R2 L2 B2 U2 D' F2";
const MINMOVE_CONTRACT_BUDGET_MS = Math.max(
  5_000,
  Math.floor(Number(process.env.MINMOVE_INVERSE_CONTRACT_BUDGET_MS) || 10_000),
);
const inverse = invertOuterAlgorithm(SCRAMBLE);
assert.equal(inverse, REPORTED_INVERSE, "regression fixture must be the literal inverse");
assert.equal(isLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);
assert.equal(shouldRejectLiteralInverseSolution(SCRAMBLE, REPORTED_INVERSE), true);

const shortScramble = "R U R' U'";
const shortInverse = invertOuterAlgorithm(shortScramble);
assert.equal(isLiteralInverseSolution(shortScramble, shortInverse), true);
assert.equal(shouldRejectLiteralInverseSolution(shortScramble, shortInverse), false);

// Regression: a phase-boundary split such as R R2 is still R'.
const REDUCIBLE_INVERSE_SCRAMBLE = "U' F2 D' B2 U' F2 U F2 U' R B D L' R D' L' D";
const REDUCIBLE_INVERSE_CANONICAL = "D' L D R' L D' B' R' U F2 U' F2 U B2 D F2 U";
const REDUCIBLE_INVERSE_REPORTED = "D' L D R' L D' B' R R2 U F2 U' F2 U B2 D F2 U";
assert.equal(invertOuterAlgorithm(REDUCIBLE_INVERSE_SCRAMBLE), REDUCIBLE_INVERSE_CANONICAL);
assert.equal(normalizeOuterAlgorithm(REDUCIBLE_INVERSE_REPORTED), REDUCIBLE_INVERSE_CANONICAL);
assert.equal(isLiteralInverseSolution(REDUCIBLE_INVERSE_SCRAMBLE, REDUCIBLE_INVERSE_REPORTED), true);
assert.equal(shouldRejectLiteralInverseSolution(REDUCIBLE_INVERSE_SCRAMBLE, REDUCIBLE_INVERSE_REPORTED), true);

const workerSource = fs.readFileSync(new URL("./solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /excludedSolution:\s*countAlgorithmMoves\(scramble\)\s*>\s*4\s*\?\s*inverseSolution\s*:\s*undefined/);
assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*searched\.solution\)/);
assert.match(workerSource, /shouldRejectLiteralInverseSolution\(scramble,\s*solution\)/);

// MinMove is intentionally best-effort now: exact proof is optional, but a
// successful result must be valid and must not be the literal inverse.
const minmoveSource = fs.readFileSync(new URL("./solver/minmoveExactV2.js", import.meta.url), "utf8");
assert.match(minmoveSource, /DEFAULT_APPROX_SLACK\s*=\s*4/);
assert.match(minmoveSource, /MINMOVE_333_BEST_EFFORT/);
assert.match(minmoveSource, /approximate:\s*meta\.optimalityProven\s*!==\s*true/);
assert.match(minmoveSource, /MINMOVE_LITERAL_INVERSE_REJECTED/);
assert.doesNotMatch(minmoveSource, /MINMOVE_NOT_PROVEN/);

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
  timeBudgetMs: MINMOVE_CONTRACT_BUDGET_MS,
});

const inverseMoveCount = inverse.split(/\s+/).filter(Boolean).length;
if (minmove?.ok) {
  assert.equal(isLiteralInverseSolution(SCRAMBLE, minmove.solution), false, "MinMove returned literal inverse");
  assert.ok(Number(minmove.moveCount) <= inverseMoveCount + 8, "MinMove best-effort result exceeded relaxed ceiling");
  assert.equal(typeof minmove.optimalityProven, "boolean", "MinMove proof metadata missing");
  if (!minmove.optimalityProven) {
    assert.equal(minmove.approximate, true, "unproven best-effort result was not marked approximate");
  }
  const minmoveVerification = await verifyFmcSolutionWasm(SCRAMBLE, minmove.solution);
  assert.equal(minmoveVerification?.solved, true, "MinMove regression solution is invalid");
} else {
  assert.ok(
    ["MINMOVE_NO_NONINVERSE_SOLUTION", "MINMOVE_TWOPHASE_UNAVAILABLE"].includes(minmove?.reason),
    `unexpected MinMove failure: ${minmove?.reason || "unknown"}`,
  );
  assert.equal(minmove?.solution, "", "failed MinMove leaked a public solution");
}

console.log(JSON.stringify({
  scramble: SCRAMBLE,
  inverse,
  twophase: {
    solution: twophase.solution,
    moveCount: twophase.moveCount,
    frontierLimit: twophase.frontierLimit,
  },
  minmove: {
    ok: minmove.ok,
    reason: minmove.reason || null,
    solution: minmove.solution || "",
    moveCount: minmove.moveCount || 0,
    approximate: minmove.approximate === true,
    optimalityProven: minmove.optimalityProven === true,
    proofSource: minmove.proofSource || null,
    proofAttempts: minmove.proofAttempts || 0,
    timeBudgetMs: MINMOVE_CONTRACT_BUDGET_MS,
    elapsedMs: minmove.elapsedMs || 0,
  },
}));
console.log("inverse output contract passed");
