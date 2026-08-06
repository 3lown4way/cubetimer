import assert from "node:assert/strict";

import { shouldRejectLiteralInverseSolution } from "./solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import { verifyFmcSolutionWasm } from "./solver/wasmSolver.js";

const realisticBudgetMs = Math.max(
  3_000,
  Math.floor(Number(process.env.MINMOVE_EXACT_CASE_BUDGET_MS) || 6_000),
);

const cases = [
  {
    name: "four-move-proof",
    scramble: "R U R' U'",
    maxElapsedMs: 15_000,
    requireProof: true,
  },
  {
    name: "realistic-wca-proof",
    scramble: "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-01",
    scramble: "R U R' U' R' F R2 U' R' U' R U R' F'",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-02",
    scramble: "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-03",
    scramble: "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-04",
    scramble: "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-05",
    scramble: "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-06",
    scramble: "R2 U2 B2 L2 F2 D' F2 L2 B2 U' R2 F' U L' B' D2 R U' F",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-07",
    scramble: "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-08",
    scramble: "U' L2 B2 R2 D F2 D2 R2 B2 U' F2 L' B U2 R D' F' R2 U",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-09",
    scramble: "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'",
    maxElapsedMs: realisticBudgetMs,
  },
  {
    name: "corpus-10",
    scramble: "D B2 R2 F2 U' L2 U B2 L2 D2 F2 R' D' L U2 B' R2 F U'",
    maxElapsedMs: realisticBudgetMs,
  },
];

async function verifyCandidate(testCase, solution, label) {
  assert.ok(typeof solution === "string" && solution.trim(), `${testCase.name} returned no ${label}`);
  assert.equal(
    shouldRejectLiteralInverseSolution(testCase.scramble, solution),
    false,
    `${testCase.name} returned the rejected literal inverse as ${label}`,
  );
  const verification = await verifyFmcSolutionWasm(testCase.scramble, solution);
  assert.equal(verification?.solved, true, `${testCase.name} ${label} does not solve the cube`);
}

const rows = [];
for (const testCase of cases) {
  const startedAt = Date.now();
  const result = await solveMinmoveExactV2(testCase.scramble, null, {
    timeBudgetMs: testCase.maxElapsedMs,
  });
  const elapsedMs = Date.now() - startedAt;
  const row = {
    name: testCase.name,
    elapsedMs,
    timeBudgetMs: testCase.maxElapsedMs,
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? 0,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    nodes: result?.nodes ?? 0,
    proofSource: result?.proofSource || null,
    interruptedReason: result?.interruptedReason || null,
    proofAttempts: result?.proofAttempts ?? 0,
    budgetExhausted: result?.budgetExhausted === true,
  };
  rows.push(row);
  console.log(JSON.stringify(row));

  assert.ok(elapsedMs <= testCase.maxElapsedMs + 15_000, `${testCase.name} exceeded the bounded runtime`);
  assert.equal(result?.fallbackReason ?? null, null, `${testCase.name} used a fallback`);

  if (result?.ok) {
    assert.equal(result?.optimalityProven, true, `${testCase.name} returned an unproven solution`);
    await verifyCandidate(testCase, result.solution, "proven solution");
    continue;
  }

  assert.equal(testCase.requireProof, undefined, `${testCase.name} did not prove an exact solution`);
  assert.equal(result?.reason, "MINMOVE_NOT_PROVEN", `${testCase.name} returned an unexpected failure`);
  assert.equal(result?.solution, "", `${testCase.name} exposed an unproven public solution`);
  assert.equal(result?.moveCount, 0, `${testCase.name} exposed an unproven public move count`);
  assert.equal(result?.optimalityProven, false, `${testCase.name} falsely marked optimality proven`);
  assert.equal(result?.budgetExhausted, true, `${testCase.name} returned before using its proof budget`);
  assert.ok(
    ["TWOPHASE_DEADLINE_REACHED", "MINMOVE_EXACT_TIMEOUT"].includes(result?.interruptedReason),
    `${testCase.name} returned an unexpected interruption reason: ${result?.interruptedReason}`,
  );
  assert.ok(
    Number(result?.elapsedMs) >= testCase.maxElapsedMs - 1_000,
    `${testCase.name} returned too early: ${result?.elapsedMs}ms for ${testCase.maxElapsedMs}ms budget`,
  );
  await verifyCandidate(testCase, result?.candidateSolution, "diagnostic candidate");
}

const sortedTimes = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
const percentile = (p) => sortedTimes[Math.min(sortedTimes.length - 1, Math.ceil(sortedTimes.length * p) - 1)];
const average = sortedTimes.reduce((sum, value) => sum + value, 0) / sortedTimes.length;
const provenRows = rows.filter((row) => row.ok);
const averageMoves = provenRows.length
  ? provenRows.reduce((sum, row) => sum + row.moveCount, 0) / provenRows.length
  : 0;
console.log(JSON.stringify({
  summary: true,
  cases: rows.length,
  proven: provenRows.length,
  honestlyUnproven: rows.filter((row) => !row.ok && row.reason === "MINMOVE_NOT_PROVEN").length,
  proofRate: provenRows.length / rows.length,
  averageMs: Math.round(average),
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: sortedTimes[sortedTimes.length - 1],
  averageProvenMoves: Number(averageMoves.toFixed(2)),
}));
console.log("minmove exact v2 benchmark passed");
