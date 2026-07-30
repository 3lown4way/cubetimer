import { performance } from "node:perf_hooks";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  dropTwophase333Search,
} from "./solver/wasmSolver.js";

const RUNS = 50;
const PHASE1_MAX_DEPTH = 13;
const PHASE2_MAX_DEPTH = 20;
const PHASE2_NODE_LIMIT = 12_000_000;

let rngState = 0x13c6ef35;
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

async function solveDirection(scramble, frontiers, incumbentLength) {
  const startedAt = performance.now();
  let searchId = null;
  try {
    const prepared = await prepareTwophase333(scramble, {
      maxPhase1Solutions: frontiers,
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

function convertedInverse(scramble, inverseResult) {
  if (!inverseResult?.ok) return null;
  const solution = invertAlgorithm(inverseResult.solution);
  if (!validSolution(scramble, solution)) return null;
  return { solution, moveCount: splitMoves(solution).length };
}

function chooseShorter(first, second) {
  return second && second.moveCount < first.moveCount ? second : first;
}

const rows = [];
for (const scramble of Array.from({ length: RUNS }, () => deterministicScramble())) {
  const direct2 = await solveDirection(scramble, 2);
  if (!direct2.ok) throw new Error(`DIRECT2_FAILED: ${scramble}`);

  const direct4 = await solveDirection(scramble, 4);
  if (!direct4.ok) throw new Error(`DIRECT4_FAILED: ${scramble}`);

  const inverseScramble = invertAlgorithm(scramble);
  const inverse1Raw = await solveDirection(inverseScramble, 1, direct2.moveCount);
  const inverse2Raw = await solveDirection(inverseScramble, 2, direct2.moveCount);
  const inverse1 = convertedInverse(scramble, inverse1Raw);
  const inverse2 = convertedInverse(scramble, inverse2Raw);

  const directCandidate = { solution: direct2.solution, moveCount: direct2.moveCount };
  const bi21 = chooseShorter(directCandidate, inverse1);
  const bi22 = chooseShorter(directCandidate, inverse2);

  rows.push({
    direct2Moves: direct2.moveCount,
    direct2Ms: direct2.elapsedMs,
    direct4Moves: direct4.moveCount,
    direct4Ms: direct4.elapsedMs,
    bi21Moves: bi21.moveCount,
    bi21Ms: direct2.elapsedMs + inverse1Raw.elapsedMs,
    bi22Moves: bi22.moveCount,
    bi22Ms: direct2.elapsedMs + inverse2Raw.elapsedMs,
    inverse1Won: Boolean(inverse1 && inverse1.moveCount < direct2.moveCount),
    inverse2Won: Boolean(inverse2 && inverse2.moveCount < direct2.moveCount),
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

console.log(JSON.stringify({
  runs: RUNS,
  direct2: summary("direct2Moves", "direct2Ms"),
  direct4: summary("direct4Moves", "direct4Ms"),
  bidirectional2x1: summary("bi21Moves", "bi21Ms"),
  bidirectional2x2: summary("bi22Moves", "bi22Ms"),
  inverse1Wins: rows.filter((row) => row.inverse1Won).length,
  inverse2Wins: rows.filter((row) => row.inverse2Won).length,
  direct4Gain: average(rows.map((row) => row.direct2Moves - row.direct4Moves)),
  bidirectional2x1Gain: average(rows.map((row) => row.direct2Moves - row.bi21Moves)),
  bidirectional2x2Gain: average(rows.map((row) => row.direct2Moves - row.bi22Moves)),
}));
