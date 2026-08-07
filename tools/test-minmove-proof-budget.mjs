import assert from "node:assert/strict";

import { shouldRejectLiteralInverseSolution } from "../solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "../solver/minmoveExactV2.js";
import { ensureTwophase333Ready, verifyFmcSolutionWasm } from "../solver/wasmSolver.js";

const SCRAMBLE = "R' U2 F L' U2 B2 D U2 B R2 F U2 L2 B D2 L2 B' U B'";
const timeBudgetMs = Math.max(
  15_000,
  Number(process.env.MINMOVE_REPORTED_CASE_BUDGET_MS) || 60_000,
);

const ready = await ensureTwophase333Ready();
assert.ok(ready, "Two-Phase WASM must be ready");

const progress = [];
const startedAt = Date.now();
const result = await solveMinmoveExactV2(
  SCRAMBLE,
  (event) => progress.push(event),
  { timeBudgetMs },
);
const elapsedMs = Date.now() - startedAt;
const diagnostic = {
  ok: result?.ok === true,
  reason: result?.reason || null,
  moveCount: result?.moveCount ?? 0,
  candidateMoveCount: result?.candidateMoveCount ?? null,
  bound: result?.bound ?? null,
  nodes: result?.nodes ?? 0,
  proofAttempts: result?.proofAttempts ?? 0,
  interruptedReason: result?.interruptedReason || null,
  budgetExhausted: result?.budgetExhausted === true,
  proofSource: result?.proofSource || null,
  elapsedMs,
  boundUpdates: progress.filter((event) => event?.type === "bound_update").map((event) => ({
    bound: event.bound,
    upperBoundLength: event.upperBoundLength,
    nodes: event.nodes,
  })),
  profileResults: progress.filter((event) => event?.type === "proof_profile_done").map((event) => ({
    bound: event.bound,
    profileIndex: event.profileIndex,
    status: event.status,
    reason: event.reason || null,
    nodes: event.nodes ?? 0,
    moveCount: event.moveCount ?? null,
  })),
};
console.log(`::notice file=tools/test-minmove-proof-budget.mjs::MINMOVE_DIAGNOSTIC ${JSON.stringify(diagnostic)}`);
if (!result?.ok) {
  console.log(`::error file=tools/test-minmove-proof-budget.mjs::MINMOVE_REPORTED_CASE_FAILED ${JSON.stringify(diagnostic)}`);
}

assert.equal(
  result?.ok,
  true,
  `reported MINMOVE_NOT_PROVEN regression still failed: ${JSON.stringify(diagnostic)}`,
);
assert.equal(result?.optimalityProven, true, "reported regression must return a proven optimum");
assert.ok(result?.solution, "reported regression returned no proven solution");
assert.equal(
  shouldRejectLiteralInverseSolution(SCRAMBLE, result.solution),
  false,
  "reported regression returned the rejected literal inverse",
);
const verification = await verifyFmcSolutionWasm(SCRAMBLE, result.solution);
assert.equal(verification?.solved, true, "reported regression solution is invalid");

console.log(JSON.stringify({ ok: true, diagnostic }, null, 2));
