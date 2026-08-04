import assert from "node:assert/strict";

import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import {
  dropMinmove333Search,
  ensureMinmove333Ready,
  prepareMinmove333,
  searchMinmove333Bound,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const baseCases = [
  { name: "four-move-proof", scramble: "R U R' U'", maxElapsedMs: 15_000 },
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
  },
  {
    name: "corpus-10",
    scramble: "D B2 R2 F2 U' L2 U B2 L2 D2 F2 R' D' L U2 B' R2 F U'",
    maxElapsedMs: 120_000,
  },
];

const FACE_AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const FACES = Object.keys(FACE_AXIS);
const SUFFIXES = ["", "2", "'"];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function generateScramble(seed, length = 20) {
  const random = seededRandom(seed);
  const moves = [];
  let previousFace = "";
  let previousAxis = -1;
  for (let index = 0; index < length; index += 1) {
    const candidates = FACES.filter((face) => face !== previousFace && FACE_AXIS[face] !== previousAxis);
    const face = candidates[Math.floor(random() * candidates.length)];
    const suffix = SUFFIXES[Math.floor(random() * SUFFIXES.length)];
    moves.push(`${face}${suffix}`);
    previousFace = face;
    previousAxis = FACE_AXIS[face];
  }
  return moves.join(" ");
}

const generatedCases = Array.from({ length: 24 }, (_, index) => ({
  name: `generated-${String(index + 1).padStart(2, "0")}`,
  scramble: generateScramble(0x51f15e + index * 7919),
  maxElapsedMs: 120_000,
}));

const cases = [...baseCases, ...generatedCases];

function splitMoves(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

function invertMove(move) {
  if (move.endsWith("2") || move.endsWith("2'")) return `${move[0]}2`;
  if (move.endsWith("'")) return move.slice(0, -1);
  return `${move}'`;
}

function invertAlgorithm(sequence) {
  return splitMoves(sequence).reverse().map(invertMove).join(" ");
}

async function findLegacyShorterSolution(scramble, maxBound) {
  const ready = await ensureMinmove333Ready();
  assert.ok(ready, "legacy minmove WASM tables must load");
  const prepared = await prepareMinmove333(scramble);
  assert.equal(prepared?.ok, true, prepared?.reason || "legacy prepare failed");
  assert.ok(Number.isFinite(prepared?.searchId), "legacy search id missing");

  let totalNodes = 0;
  try {
    for (let bound = prepared.lowerBound; bound <= maxBound; bound += 1) {
      for (;;) {
        const searched = await searchMinmove333Bound(prepared.searchId, bound, 8_000_000);
        assert.equal(searched?.ok, true, searched?.reason || `legacy bound ${bound} failed`);
        totalNodes += Number.isFinite(searched?.nodes) ? searched.nodes : 0;
        if (searched.status === "found") {
          return {
            found: true,
            solution: String(searched.solution || "").trim(),
            moveCount: searched.moveCount,
            bound,
            nodes: totalNodes,
          };
        }
        if (searched.status === "exhausted") break;
        assert.equal(searched.status, "interrupted", `unexpected legacy status at bound ${bound}`);
      }
    }
    return { found: false, solution: "", moveCount: 0, bound: maxBound, nodes: totalNodes };
  } finally {
    await dropMinmove333Search(prepared.searchId);
  }
}

const rows = [];
let oracleChecks = 0;
const MAX_ORACLE_CHECKS = 4;
for (const testCase of cases) {
  const startedAt = Date.now();
  const result = await solveMinmoveExactV2(testCase.scramble, null, {
    timeBudgetMs: testCase.maxElapsedMs,
  });
  const elapsedMs = Date.now() - startedAt;
  const inverse = invertAlgorithm(testCase.scramble);
  const literalInverse = String(result?.solution || "").trim() === inverse;
  let legacyOracle = null;
  if (literalInverse && result?.ok === true && result.moveCount > 0 && oracleChecks < MAX_ORACLE_CHECKS) {
    oracleChecks += 1;
    legacyOracle = await findLegacyShorterSolution(testCase.scramble, result.moveCount - 1);
  }

  const row = {
    name: testCase.name,
    scramble: testCase.scramble,
    elapsedMs,
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? null,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    nodes: result?.nodes ?? null,
    proofSource: result?.proofSource || null,
    interruptedReason: result?.interruptedReason || null,
    literalInverse,
    seedSource: result?.seedSource || null,
    oracleChecked: legacyOracle !== null,
    oracleFoundShorter: legacyOracle?.found === true,
    oracleMoveCount: legacyOracle?.moveCount ?? null,
    oracleNodes: legacyOracle?.nodes ?? null,
  };
  rows.push(row);
  console.log(JSON.stringify(row));

  assert.ok(elapsedMs <= testCase.maxElapsedMs + 15_000, `${testCase.name} exceeded the bounded runtime`);
  assert.equal(result?.ok, true, `${testCase.name} did not prove an exact solution: ${result?.reason || "unknown"}`);
  assert.equal(result?.optimalityProven, true, `${testCase.name} returned an unproven solution`);
  assert.equal(result?.fallbackReason, null, `${testCase.name} used a fallback`);
  assert.ok(typeof result?.solution === "string" && result.solution.trim(), `${testCase.name} returned no solution`);

  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  assert.equal(verification?.solved, true, `${testCase.name} solution does not solve the cube`);
  assert.equal(
    legacyOracle?.found === true,
    false,
    `${testCase.name} v2 claimed ${result.moveCount} HTM but legacy exact found ${legacyOracle?.moveCount} HTM`,
  );
}

const sortedTimes = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
const percentile = (p) => sortedTimes[Math.min(sortedTimes.length - 1, Math.ceil(sortedTimes.length * p) - 1)];
const average = sortedTimes.reduce((sum, value) => sum + value, 0) / sortedTimes.length;
console.log(JSON.stringify({
  summary: true,
  cases: rows.length,
  success: rows.filter((row) => row.ok).length,
  literalInverseCount: rows.filter((row) => row.literalInverse).length,
  oracleChecks,
  averageMs: Math.round(average),
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: sortedTimes[sortedTimes.length - 1],
  averageMoves: Number((rows.reduce((sum, row) => sum + row.moveCount, 0) / rows.length).toFixed(2)),
}));
console.log("minmove exact v2 benchmark passed");
