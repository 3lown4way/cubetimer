import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  optimizeInsertionWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_INSERTION_RUNS || "6", 10));
const CANDIDATES = Math.max(1, Number.parseInt(process.env.FMC_INSERTION_CANDIDATES || "3", 10));
const PREMOVES = Math.max(0, Number.parseInt(process.env.FMC_INSERTION_PREMOVES || "80", 10));
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";

let rngState = 0xa14c35e7;
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
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");

const rows = [];
for (let index = 0; index < RUNS; index += 1) {
  const scramble = deterministicScramble();
  const fmc = await solveFmcWasm(scramble, { maxPremoveSets: PREMOVES, forceRzp: false });
  if (!fmc?.ok || !Array.isArray(fmc.candidates) || !fmc.candidates.length) {
    throw new Error(`FMC_SEED_FAILED_AT_${index}`);
  }
  const selected = fmc.candidates.slice(0, CANDIDATES);
  for (let candidateIndex = 0; candidateIndex < selected.length; candidateIndex += 1) {
    const candidate = selected[candidateIndex];
    const startedAt = performance.now();
    const result = await optimizeInsertionWasm(scramble, candidate.solution, {
      maxPasses: 3,
      minWindow: 3,
      maxWindow: 7,
      maxDepth: 6,
    });
    const elapsedMs = performance.now() - startedAt;
    if (!result?.ok || !result.solution) {
      throw new Error(`INSERTION_FAILED_AT_${index}_${candidateIndex}`);
    }
    const verification = await verifyFmcSolutionWasm(scramble, result.solution);
    if (!verification?.ok || !verification.solved) {
      throw new Error(`INSERTION_INVALID_AT_${index}_${candidateIndex}`);
    }
    rows.push({
      scramble,
      candidateIndex,
      baseSolution: candidate.solution,
      baseMoveCount: candidate.moveCount,
      solution: result.solution,
      moveCount: result.moveCount,
      elapsedMs,
    });
  }
}

const times = rows.map((row) => row.elapsedMs);
const report = {
  runs: rows.length,
  scrambles: RUNS,
  candidatesPerScramble: CANDIDATES,
  summary: {
    averageMs: average(times),
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    maxMs: Math.max(...times),
    averageBaseMoves: average(rows.map((row) => row.baseMoveCount)),
    averageMoves: average(rows.map((row) => row.moveCount)),
    improved: rows.filter((row) => row.moveCount < row.baseMoveCount).length,
  },
  rows,
};

const text = JSON.stringify(report, null, 2);
if (outputPath) fs.writeFileSync(outputPath, text);
console.log(JSON.stringify(report.summary));
