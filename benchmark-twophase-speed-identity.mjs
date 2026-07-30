import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  dropTwophase333Search,
} from "./solver/wasmSolver.js";

const RUNS = Number.parseInt(process.env.TWOPHASE_SPEED_RUNS || "100", 10);
const outputArgIndex = process.argv.indexOf("--out");
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : "";
const FRONTIERS = 2;
const PHASE1_MAX_DEPTH = 13;
const PHASE2_MAX_DEPTH = 20;
const INCUMBENT_LENGTH = 21;

let rngState = 0x6d2b79f5;
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
  while (moves.length < length) {
    const face = faces[Math.floor(randomUnit() * faces.length)];
    if (face === lastFace || axes[face] === lastAxis) continue;
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

async function solveOnce(scramble) {
  let searchId = null;
  const startedAt = performance.now();
  const prepared = await prepareTwophase333(scramble, {
    maxPhase1Solutions: FRONTIERS,
    phase1MaxDepth: PHASE1_MAX_DEPTH,
    phase1NodeLimit: 0,
  });
  const preparedAt = performance.now();
  try {
    if (!prepared?.ok || !Number.isFinite(prepared.searchId)) {
      throw new Error(`PREPARE_FAILED:${prepared?.reason || "unknown"}`);
    }
    searchId = prepared.searchId;
    const result = await searchTwophase333(searchId, {
      incumbentLength: INCUMBENT_LENGTH,
      phase2MaxDepth: PHASE2_MAX_DEPTH,
      phase2NodeLimit: 0,
    });
    if (!result?.ok) {
      throw new Error(`SEARCH_FAILED:${result?.reason || "unknown"}`);
    }
    const endedAt = performance.now();
    return {
      scramble,
      solution: String(result.solution || "").trim(),
      moveCount: result.moveCount,
      phase1Depth: result.phase1Depth,
      phase2Depth: result.phase2Depth,
      candidateCount: result.candidateCount,
      phase1Nodes: result.phase1Nodes,
      phase2Nodes: result.phase2Nodes,
      prepareMs: preparedAt - startedAt,
      searchMs: endedAt - preparedAt,
      totalMs: endedAt - startedAt,
    };
  } finally {
    if (Number.isFinite(searchId)) await dropTwophase333Search(searchId);
  }
}

const ready = await ensureTwophase333Ready();
if (!ready) throw new Error("TWOPHASE_UNAVAILABLE");

// Equalize WASM/JIT cold effects before measuring.
await solveOnce("R U R' U' F2 D L2 B2 U2 R2 F' D'");

const rows = [];
for (let index = 0; index < RUNS; index += 1) {
  rows.push(await solveOnce(deterministicScramble()));
}

const summary = {
  runs: RUNS,
  averageMoves: average(rows.map((row) => row.moveCount)),
  averagePrepareMs: average(rows.map((row) => row.prepareMs)),
  averageSearchMs: average(rows.map((row) => row.searchMs)),
  averageTotalMs: average(rows.map((row) => row.totalMs)),
  medianTotalMs: percentile(rows.map((row) => row.totalMs), 0.5),
  p95TotalMs: percentile(rows.map((row) => row.totalMs), 0.95),
  averagePhase1Nodes: average(rows.map((row) => row.phase1Nodes)),
  averagePhase2Nodes: average(rows.map((row) => row.phase2Nodes)),
};

const output = { summary, rows };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output));
console.log(JSON.stringify(summary));
