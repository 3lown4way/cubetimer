import assert from "node:assert/strict";

import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import { verifyFmcSolutionWasm } from "./solver/wasmSolver.js";

function splitMoves(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

function normalizeAlgorithm(sequence) {
  return splitMoves(sequence).join(" ");
}

function invertMove(token) {
  const normalized = String(token || "").trim();
  if (!/^[URFDLB](2|'|2')?$/.test(normalized)) return "";
  if (normalized.endsWith("2") || normalized.endsWith("2'")) return `${normalized[0]}2`;
  if (normalized.endsWith("'")) return normalized.slice(0, -1);
  return `${normalized}'`;
}

function invertAlgorithm(sequence) {
  const moves = splitMoves(sequence);
  const inverse = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const move = invertMove(moves[index]);
    if (!move) return "";
    inverse.push(move);
  }
  return inverse.join(" ");
}

const cases = [
  {
    name: "four-move-proof",
    scramble: "R U R' U'",
    maxElapsedMs: 15_000,
    allowNontrivialMiss: true,
  },
  {
    name: "realistic-wca-proof",
    scramble: "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-01",
    scramble: "R U R' U' R' F R2 U' R' U' R U R' F'",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-02",
    scramble: "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-03",
    scramble: "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-04",
    scramble: "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-05",
    scramble: "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-06",
    scramble: "R2 U2 B2 L2 F2 D' F2 L2 B2 U' R2 F' U L' B' D2 R U' F",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-07",
    scramble: "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-08",
    scramble: "U' L2 B2 R2 D F2 D2 R2 B2 U' F2 L' B U2 R D' F' R2 U",
    maxElapsedMs: 120_000,
  },
  {
    name: "corpus-09",
    scramble: "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'",
    maxElapsedMs: 120_000,
    maxMoves: 18,
  },
  {
    name: "corpus-10",
    scramble: "D B2 R2 F2 U' L2 U B2 L2 D2 F2 R' D' L U2 B' R2 F U'",
    maxElapsedMs: 120_000,
  },
];

const rows = [];
for (const testCase of cases) {
  const startedAt = Date.now();
  const result = await solveMinmoveExactV2(testCase.scramble, null, {
    timeBudgetMs: testCase.maxElapsedMs,
  });
  const elapsedMs = Date.now() - startedAt;
  const literalInverse = invertAlgorithm(testCase.scramble);
  const returnedSolution = normalizeAlgorithm(result?.solution);
  const returnedCandidate = normalizeAlgorithm(result?.candidateSolution);

  const row = {
    name: testCase.name,
    elapsedMs,
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? null,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    literalInverseReturned: returnedSolution === literalInverse,
    literalInverseCandidate: returnedCandidate === literalInverse,
    nodes: result?.nodes ?? null,
    proofSource: result?.proofSource || null,
    interruptedReason: result?.interruptedReason || null,
  };
  rows.push(row);
  console.log(JSON.stringify(row));

  assert.ok(elapsedMs <= testCase.maxElapsedMs + 15_000, `${testCase.name} exceeded the bounded runtime`);
  assert.notEqual(returnedSolution, literalInverse, `${testCase.name} returned the literal inverse scramble`);
  assert.notEqual(returnedCandidate, literalInverse, `${testCase.name} exposed the literal inverse as a candidate`);

  if (testCase.allowNontrivialMiss && result?.ok !== true) {
    assert.equal(
      result?.reason,
      "MINMOVE_NONTRIVIAL_RESULT_NOT_FOUND",
      `${testCase.name} failed for an unexpected reason`,
    );
    continue;
  }

  assert.equal(result?.ok, true, `${testCase.name} did not prove an exact solution: ${result?.reason || "unknown"}`);
  assert.equal(result?.optimalityProven, true, `${testCase.name} returned an unproven solution`);
  assert.equal(result?.fallbackReason, null, `${testCase.name} used a fallback`);
  assert.ok(typeof result?.solution === "string" && result.solution.trim(), `${testCase.name} returned no solution`);

  if (Number.isFinite(testCase.maxMoves)) {
    assert.ok(
      result.moveCount <= testCase.maxMoves,
      `${testCase.name} exceeded ${testCase.maxMoves} HTM`,
    );
  }

  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  assert.equal(verification?.solved, true, `${testCase.name} solution does not solve the cube`);
}

const successfulRows = rows.filter((row) => row.ok);
const sortedTimes = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
const percentile = (p) => sortedTimes[Math.min(sortedTimes.length - 1, Math.ceil(sortedTimes.length * p) - 1)];
const average = sortedTimes.reduce((sum, value) => sum + value, 0) / sortedTimes.length;
console.log(JSON.stringify({
  summary: true,
  cases: rows.length,
  success: successfulRows.length,
  nontrivialMisses: rows.filter((row) => row.reason === "MINMOVE_NONTRIVIAL_RESULT_NOT_FOUND").length,
  literalInverseReturned: rows.filter((row) => row.literalInverseReturned).length,
  literalInverseCandidate: rows.filter((row) => row.literalInverseCandidate).length,
  averageMs: Math.round(average),
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: sortedTimes[sortedTimes.length - 1],
  averageMoves: successfulRows.length
    ? Number((successfulRows.reduce((sum, row) => sum + row.moveCount, 0) / successfulRows.length).toFixed(2))
    : null,
}));
console.log("minmove exact v2 benchmark passed");
