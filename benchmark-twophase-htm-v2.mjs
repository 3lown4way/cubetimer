import { performance } from "node:perf_hooks";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  searchTwophaseExact333,
  dropTwophase333Search,
} from "./solver/wasmSolver.js";

const RUNS = 30;
const PHASE1_FRONTIERS = 2;
const PHASE1_MAX_DEPTH = 13;
const PHASE2_MAX_DEPTH = 20;
const PHASE2_NODE_LIMIT = 12_000_000;
const EXACT_PHASE1_NODE_LIMIT = 750_000;
const EXACT_PHASE2_NODE_LIMIT = 1_500_000;

let rngState = 0x7f4a7c15;
function randomUnit() {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) / 0x100000000;
}

const faces = ["U", "D", "R", "L", "F", "B"];
const suffixes = ["", "'", "2"];
const axes = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
function deterministicScramble(length = 21) {
  const moves = [];
  let lastFace = "";
  let lastAxis = -1;
  for (let index = 0; index < length; index += 1) {
    let face;
    do {
      face = faces[Math.floor(randomUnit() * faces.length)];
    } while (face === lastFace || axes[face] === lastAxis);
    moves.push(face + suffixes[Math.floor(randomUnit() * suffixes.length)]);
    lastFace = face;
    lastAxis = axes[face];
  }
  return moves.join(" ");
}

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

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const ready = await ensureTwophase333Ready();
if (!ready) throw new Error("TWOPHASE_UNAVAILABLE");

function validSolution(scramble, solution) {
  try {
    return solved
      .applyAlg(scramble)
      .applyAlg(solution)
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
  } catch {
    return false;
  }
}

async function practicalSolve(scramble, incumbentLength) {
  let searchId = null;
  const startedAt = performance.now();
  try {
    const prepared = await prepareTwophase333(scramble, {
      maxPhase1Solutions: PHASE1_FRONTIERS,
      phase1MaxDepth: PHASE1_MAX_DEPTH,
      phase1NodeLimit: 0,
    });
    if (!prepared?.ok || !Number.isFinite(prepared.searchId)) {
      return { ok: false, elapsedMs: performance.now() - startedAt, reason: prepared?.reason || "PREPARE_FAILED" };
    }
    searchId = prepared.searchId;
    const result = await searchTwophase333(searchId, {
      incumbentLength: Number.isFinite(incumbentLength) ? incumbentLength : undefined,
      phase2MaxDepth: PHASE2_MAX_DEPTH,
      phase2NodeLimit: PHASE2_NODE_LIMIT,
    });
    const solution = String(result?.solution || "").trim();
    return {
      ...result,
      ok: result?.ok === true && validSolution(scramble, solution),
      solution,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    if (Number.isFinite(searchId)) await dropTwophase333Search(searchId);
  }
}

const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const rows = [];
for (const scramble of scrambles) {
  const baseline = await practicalSolve(scramble);
  if (!baseline.ok) throw new Error(`BASELINE_FAILED: ${scramble} ${baseline.reason || ""}`);

  const inverseScramble = invertAlgorithm(scramble);
  const inverseRaw = await practicalSolve(inverseScramble, baseline.moveCount);
  let inverseCandidate = null;
  if (inverseRaw.ok) {
    const converted = invertAlgorithm(inverseRaw.solution);
    if (validSolution(scramble, converted)) {
      inverseCandidate = {
        solution: converted,
        moveCount: splitMoves(converted).length,
      };
    }
  }

  const bidirectional = inverseCandidate && inverseCandidate.moveCount < baseline.moveCount
    ? inverseCandidate
    : { solution: baseline.solution, moveCount: baseline.moveCount };

  const exactStartedAt = performance.now();
  let refined = bidirectional;
  let exactFound = false;
  if (bidirectional.moveCount > 1) {
    const exact = await searchTwophaseExact333(scramble, {
      maxTotalDepth: bidirectional.moveCount - 1,
      phase1NodeLimit: EXACT_PHASE1_NODE_LIMIT,
      phase2NodeLimit: EXACT_PHASE2_NODE_LIMIT,
    });
    const exactSolution = String(exact?.solution || "").trim();
    if (
      exact?.ok === true
      && exact?.found === true
      && exactSolution
      && validSolution(scramble, exactSolution)
      && splitMoves(exactSolution).length < bidirectional.moveCount
    ) {
      refined = {
        solution: exactSolution,
        moveCount: splitMoves(exactSolution).length,
      };
      exactFound = true;
    }
  }
  const exactMs = performance.now() - exactStartedAt;

  rows.push({
    baselineMoves: baseline.moveCount,
    baselineMs: baseline.elapsedMs,
    inverseMoves: inverseCandidate?.moveCount ?? null,
    inverseMs: inverseRaw.elapsedMs,
    bidirectionalMoves: bidirectional.moveCount,
    bidirectionalMs: baseline.elapsedMs + inverseRaw.elapsedMs,
    refinedMoves: refined.moveCount,
    refinedMs: baseline.elapsedMs + inverseRaw.elapsedMs + exactMs,
    inverseWon: Boolean(inverseCandidate && inverseCandidate.moveCount < baseline.moveCount),
    exactFound,
  });
}

function summary(moveKey, timeKey) {
  const moves = rows.map((row) => row[moveKey]);
  const times = rows.map((row) => row[timeKey]);
  return {
    averageMoves: average(moves),
    medianMoves: percentile(moves, 0.5),
    p95Moves: percentile(moves, 0.95),
    averageMs: average(times),
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
  };
}

const output = {
  runs: RUNS,
  baseline: summary("baselineMoves", "baselineMs"),
  bidirectional: summary("bidirectionalMoves", "bidirectionalMs"),
  bidirectionalExact: summary("refinedMoves", "refinedMs"),
  inverseWins: rows.filter((row) => row.inverseWon).length,
  exactImprovements: rows.filter((row) => row.exactFound).length,
  averageBidirectionalGain: average(rows.map((row) => row.baselineMoves - row.bidirectionalMoves)),
  averageExactGainAfterBidirectional: average(rows.map((row) => row.bidirectionalMoves - row.refinedMoves)),
};
console.log(JSON.stringify(output));
