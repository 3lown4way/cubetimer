import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  optimizeInsertionWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_SPEED_RUNS || "12", 10));
const PREMOVE_SETS = Math.max(0, Number.parseInt(process.env.FMC_SPEED_PREMOVE_SETS || "80", 10));
const INSERTION_RUNS = Math.max(0, Math.min(RUNS, Number.parseInt(process.env.FMC_SPEED_INSERTION_RUNS || "4", 10)));
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";

let rngState = 0x5f3759df;
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

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function normalizedCandidate(candidate) {
  return {
    solution: String(candidate?.solution || ""),
    moveCount: Number(candidate?.moveCount || 0),
    source: String(candidate?.source || ""),
    axisName: String(candidate?.axisName || ""),
    eoLength: Number(candidate?.eoLength || 0),
    drLength: Number(candidate?.drLength || 0),
    p2Length: Number(candidate?.p2Length || 0),
    premoves: String(candidate?.premoves || ""),
    rzpUsed: candidate?.rzpUsed === true,
    eoMoves: Array.isArray(candidate?.eoMoves) ? candidate.eoMoves.map(String) : [],
    drMoves: Array.isArray(candidate?.drMoves) ? candidate.drMoves.map(String) : [],
    finishMoves: Array.isArray(candidate?.finishMoves) ? candidate.finishMoves.map(String) : [],
  };
}

const readyStartedAt = performance.now();
const ready = await buildFmcTablesWasm();
const tableBuildMs = performance.now() - readyStartedAt;
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");

const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const rows = [];
for (let index = 0; index < scrambles.length; index += 1) {
  const scramble = scrambles[index];
  const solveStartedAt = performance.now();
  const result = await solveFmcWasm(scramble, {
    maxPremoveSets: PREMOVE_SETS,
    forceRzp: false,
  });
  const solveMs = performance.now() - solveStartedAt;
  if (!result?.ok || !result.solution || !Array.isArray(result.candidates)) {
    const diagnostics = {
      reason: result?.reason || "UNKNOWN",
      candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : -1,
      invalidCandidateCount: Number(result?.invalidCandidateCount || 0),
      repairedPremoveNissCandidateCount: Number(result?.repairedPremoveNissCandidateCount || 0),
    };
    throw new Error(`FMC_SOLVE_FAILED:${index}:${scramble}:${JSON.stringify(diagnostics)}`);
  }

  for (const candidate of result.candidates) {
    const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`FMC_CANDIDATE_INVALID:${index}:${candidate.solution}`);
    }
  }

  let insertion = null;
  let insertionMs = 0;
  if (index < INSERTION_RUNS) {
    const insertionStartedAt = performance.now();
    const insertionResult = await optimizeInsertionWasm(scramble, result.solution, {
      maxPasses: 3,
      minWindow: 3,
      maxWindow: 7,
      maxDepth: 6,
    });
    insertionMs = performance.now() - insertionStartedAt;
    if (!insertionResult?.ok || !insertionResult.solution) {
      throw new Error(`FMC_INSERTION_FAILED:${index}`);
    }
    const insertionVerification = await verifyFmcSolutionWasm(scramble, insertionResult.solution);
    if (!insertionVerification?.ok || insertionVerification.solved !== true) {
      throw new Error(`FMC_INSERTION_INVALID:${index}`);
    }
    insertion = {
      solution: String(insertionResult.solution),
      moveCount: Number(insertionResult.moveCount || 0),
    };
  }

  rows.push({
    scramble,
    solution: String(result.solution),
    moveCount: Number(result.moveCount || 0),
    candidates: result.candidates.map(normalizedCandidate),
    solveMs,
    insertionMs,
    insertion,
  });
}

const solveTimes = rows.map((row) => row.solveMs);
const insertionTimes = rows.filter((row) => row.insertion).map((row) => row.insertionMs);
const summary = {
  runs: RUNS,
  premoveSets: PREMOVE_SETS,
  insertionRuns: INSERTION_RUNS,
  tableBuildMs,
  averageMoves: average(rows.map((row) => row.moveCount)),
  averageSolveMs: average(solveTimes),
  medianSolveMs: percentile(solveTimes, 0.5),
  p95SolveMs: percentile(solveTimes, 0.95),
  averageInsertionMs: average(insertionTimes),
  medianInsertionMs: percentile(insertionTimes, 0.5),
};

const output = { summary, rows };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(summary));