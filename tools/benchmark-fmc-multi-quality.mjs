import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_QUALITY_RUNS || "1000", 10));
const PREMOVE_SETS = Math.max(0, Number.parseInt(process.env.FMC_QUALITY_PREMOVE_SETS || "40", 10));
const VARIANT = process.env.FMC_QUALITY_VARIANT || "unknown";
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";

let rngState = 0x4d554c54;
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

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const tableStartedAt = performance.now();
const ready = await buildFmcTablesWasm();
const tableBuildMs = performance.now() - tableStartedAt;
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");

const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const rows = [];

for (let index = 0; index < scrambles.length; index += 1) {
  const scramble = scrambles[index];
  const startedAt = performance.now();
  const result = await solveFmcWasm(scramble, {
    maxPremoveSets: PREMOVE_SETS,
    forceRzp: false,
  });
  const solveMs = performance.now() - startedAt;

  if (!result?.ok || !result.solution || !Array.isArray(result.candidates)) {
    throw new Error(`FMC_SOLVE_FAILED:${index}:${scramble}`);
  }

  const bestVerification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!bestVerification?.ok || bestVerification.solved !== true) {
    throw new Error(`FMC_BEST_INVALID:${index}:${result.solution}`);
  }

  const multiCandidates = result.candidates.filter(
    (candidate) => Number(candidate?.insertionCount || 0) >= 2,
  );
  for (const candidate of multiCandidates) {
    const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`FMC_MULTI_INVALID:${index}:${candidate.solution}`);
    }
  }

  const multiSkeletons = Array.isArray(result.skeletons)
    ? result.skeletons.filter((skeleton) =>
        ["corner4", "edge4", "corner3edge3"].includes(String(skeleton?.kind || "")),
      )
    : [];
  const bestCandidate = result.candidates[0] || {};

  rows.push({
    index,
    scramble,
    solution: String(result.solution),
    moveCount: Number(result.moveCount || 0),
    solveMs,
    candidateCount: result.candidates.length,
    insertionCandidateCount: Number(result.insertionCandidateCount || 0),
    mixedInsertionCandidateCount: Number(result.mixedInsertionCandidateCount || 0),
    multiInsertionCandidateCount: Number(result.multiInsertionCandidateCount || 0),
    multiSkeletonCount: multiSkeletons.length,
    multiCandidateInTop: multiCandidates.length > 0,
    multiCandidateTopCount: multiCandidates.length,
    bestIsMulti: Number(bestCandidate?.insertionCount || 0) >= 2,
    bestSource: String(bestCandidate?.source || ""),
    bestSkeletonKind: String(bestCandidate?.skeletonKind || ""),
  });

  if ((index + 1) % 100 === 0) {
    console.log(`${VARIANT}: ${index + 1}/${RUNS}`);
  }
}

const solveTimes = rows.map((row) => row.solveMs);
const summary = {
  variant: VARIANT,
  runs: RUNS,
  premoveSets: PREMOVE_SETS,
  tableBuildMs,
  averageMoves: average(rows.map((row) => row.moveCount)),
  medianMoves: percentile(rows.map((row) => row.moveCount), 0.5),
  p95Moves: percentile(rows.map((row) => row.moveCount), 0.95),
  averageSolveMs: average(solveTimes),
  medianSolveMs: percentile(solveTimes, 0.5),
  p95SolveMs: percentile(solveTimes, 0.95),
  multiGeneratedCases: rows.filter((row) => row.multiInsertionCandidateCount > 0).length,
  multiSkeletonCases: rows.filter((row) => row.multiSkeletonCount > 0).length,
  multiCandidateTopCases: rows.filter((row) => row.multiCandidateInTop).length,
  bestMultiCases: rows.filter((row) => row.bestIsMulti).length,
  totalMultiCandidates: rows.reduce(
    (sum, row) => sum + row.multiInsertionCandidateCount,
    0,
  ),
};

const output = { summary, rows };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(summary));
