import assert from "node:assert/strict";

import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import { verifyFmcSolutionWasm } from "./solver/wasmSolver.js";

const cases = [
  {
    name: "four-move-proof",
    scramble: "R U R' U'",
    maxElapsedMs: 15_000,
  },
  {
    name: "realistic-wca-proof",
    scramble: "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'",
    maxElapsedMs: 120_000,
  },
];

for (const testCase of cases) {
  const startedAt = Date.now();
  const result = await solveMinmoveExactV2(testCase.scramble, null, {
    timeBudgetMs: testCase.maxElapsedMs,
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(JSON.stringify({
    name: testCase.name,
    elapsedMs,
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? null,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    nodes: result?.nodes ?? null,
    proofSource: result?.proofSource || null,
    interruptedReason: result?.interruptedReason || null,
  }));

  assert.ok(elapsedMs <= testCase.maxElapsedMs + 15_000, `${testCase.name} exceeded the bounded runtime`);
  assert.equal(result?.ok, true, `${testCase.name} did not prove an exact solution: ${result?.reason || "unknown"}`);
  assert.equal(result?.optimalityProven, true, `${testCase.name} returned an unproven solution`);
  assert.equal(result?.fallbackReason, null, `${testCase.name} used a fallback`);
  assert.ok(typeof result?.solution === "string" && result.solution.trim(), `${testCase.name} returned no solution`);

  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  assert.equal(verification?.solved, true, `${testCase.name} solution does not solve the cube`);
}

console.log("minmove exact v2 benchmark passed");
