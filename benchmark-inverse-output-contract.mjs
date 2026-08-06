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
const MINMOVE_CONTRACT_BUDGET_MS = Math.max(
  3_000,
  Math.floor(Number(process.env.MINMOVE_INVERSE_CONTRACT_BUDGET_MS) || 6_000),
);
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
  timeBudgetMs: MINMOVE_CONTRACT_BUDGET_MS,
});

let minmoveContractSolution = "";
if (minmove?.ok) {
  assert.equal(minmove.optimalityProven, true, "successful Minmove result is not proven");
  assert.equal(isLiteralInverseSolution(SCRAMBLE, minmove.solution), false, "Minmove returned literal inverse");
  const minmoveVerification = await verifyFmcSolutionWasm(SCRAMBLE, minmove.solution);
  assert.equal(minmoveVerification?.solved, true, "Minmove regression solution is invalid");
  minmoveContractSolution = minmove.solution;
} else {
  // A node/deadline interruption is not proof of exhaustion. The exact solver
  // must preserve its intentional no-fallback contract instead of promoting
  // the incumbent candidate to a successful solution.
  assert.equal(minmove?.reason, "MINMOVE_NOT_PROVEN", `unexpected Minmove failure: ${minmove?.reason || "unknown"}`);
  assert.equal(minmove?.optimalityProven, false, "unproven result marked as proven");
  assert.equal(minmove?.solution, "", "unproven candidate leaked into the public solution field");
  assert.equal(minmove?.moveCount, 0, "unproven candidate leaked into the public move count");
  assert.equal(minmove?.fallbackReason, null, "Minmove unexpectedly used fallback");
  assert.equal(minmove?.budgetExhausted, true, "Minmove returned before using its proof budget");
  assert.ok(
    ["TWOPHASE_DEADLINE_REACHED", "MINMOVE_EXACT_TIMEOUT"].includes(minmove?.interruptedReason),
    `unexpected Minmove interruption: ${minmove?.interruptedReason}`,
  );
  assert.ok(
    Number(minmove?.elapsedMs) >= MINMOVE_CONTRACT_BUDGET_MS - 1_000,
    `Minmove returned too early: ${minmove?.elapsedMs}ms for ${MINMOVE_CONTRACT_BUDGET_MS}ms budget`,
  );
  assert.equal(typeof minmove?.candidateSolution, "string", "unproven result lost candidate metadata");
  assert.ok(minmove.candidateSolution.trim(), "unproven result has an empty candidate");
  assert.equal(
    isLiteralInverseSolution(SCRAMBLE, minmove.candidateSolution),
    false,
    "Minmove candidate is the rejected literal inverse",
  );
  const candidateVerification = await verifyFmcSolutionWasm(SCRAMBLE, minmove.candidateSolution);
  assert.equal(candidateVerification?.solved, true, "Minmove candidate metadata is invalid");
  minmoveContractSolution = minmove.candidateSolution;
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
    solution: minmoveContractSolution,
    moveCount: minmove.ok ? minmove.moveCount : minmove.candidateMoveCount,
    optimalityProven: minmove.optimalityProven,
    interruptedReason: minmove.interruptedReason || null,
    proofSource: minmove.proofSource,
    proofAttempts: minmove.proofAttempts || 0,
    budgetExhausted: minmove.budgetExhausted === true,
    timeBudgetMs: MINMOVE_CONTRACT_BUDGET_MS,
    elapsedMs: minmove.elapsedMs,
  },
}));
console.log("inverse output contract passed");
