import assert from "node:assert/strict";

import { shouldRejectLiteralInverseSolution } from "../solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "../solver/minmoveExactV2.js";
import {
  ensureTwophase333Ready,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const SCRAMBLE = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const budgets = String(process.env.MINMOVE_BENCHMARK_BUDGETS_MS || "30000,60000,90000")
  .split(",")
  .map((value) => Math.max(1_000, Math.floor(Number(value) || 0)))
  .filter((value) => value > 0);

assert.ok(budgets.length > 0, "at least one benchmark budget is required");
const ready = await ensureTwophase333Ready();
assert.ok(ready, "Two-Phase WASM must be ready");

const rows = [];
for (const timeBudgetMs of budgets) {
  const startedAt = Date.now();
  const result = await solveMinmoveExactV2(SCRAMBLE, null, { timeBudgetMs });
  const wallElapsedMs = Date.now() - startedAt;

  assert.equal(result?.fallbackReason ?? null, null, "Minmove must not expose a fallback");
  if (result?.ok) {
    assert.equal(result.optimalityProven, true);
    assert.equal(shouldRejectLiteralInverseSolution(SCRAMBLE, result.solution), false);
    const verification = await verifyFmcSolutionWasm(SCRAMBLE, result.solution);
    assert.equal(verification?.solved, true, "proven solution is invalid");
  } else {
    assert.equal(result?.reason, "MINMOVE_NOT_PROVEN");
    assert.equal(result?.solution, "");
    assert.equal(result?.moveCount, 0);
    assert.equal(result?.budgetExhausted, true);
  }

  rows.push({
    timeBudgetMs,
    wallElapsedMs,
    proven: result?.optimalityProven === true,
    moveCount: result?.moveCount ?? 0,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    reason: result?.reason || null,
    interruptedReason: result?.interruptedReason || null,
    proofAttempts: result?.proofAttempts ?? 0,
    nodes: result?.nodes ?? 0,
    elapsedMs: result?.elapsedMs ?? null,
  });
}

console.log(JSON.stringify({
  scramble: SCRAMBLE,
  proofRate: rows.filter((row) => row.proven).length / rows.length,
  rows,
}, null, 2));
