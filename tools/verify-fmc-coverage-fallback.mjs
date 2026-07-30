import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const FAILED_CASES = [
  "F' D F L U' L F R2 D' R2 U' L D L2 D' B D' B' D' B U'",
  "U B L F U B2 D2 R2 D R' F' D' R2 U2 L U' F2 L' D L D",
  "L2 B' R2 D B' U B2 D' F' R' D2 B' U L U' R D R' D2 F' R'",
];

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

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");

const targeted = [];
for (let index = 0; index < FAILED_CASES.length; index += 1) {
  const scramble = FAILED_CASES[index];
  const disabled = await solveFmcWasm(scramble, {
    maxPremoveSets: 40,
    enableCoverageFallback: false,
  });
  if (disabled?.ok) throw new Error(`TARGET_UNEXPECTED_FAST_SUCCESS:${index}`);

  const startedAt = performance.now();
  const result = await solveFmcWasm(scramble, {
    maxPremoveSets: 40,
    enableCoverageFallback: true,
  });
  const elapsedMs = performance.now() - startedAt;
  if (!result?.ok || !result.solution || result.fallbackUsed !== true) {
    throw new Error(`TARGET_FALLBACK_FAILED:${index}:${result?.reason || "UNKNOWN"}`);
  }
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`TARGET_FALLBACK_INVALID:${index}`);
  }
  if (result.candidates?.[0]?.source !== "FMC_TWOPHASE_FALLBACK") {
    throw new Error(`TARGET_FALLBACK_SOURCE:${index}`);
  }
  targeted.push({
    index,
    moveCount: result.moveCount,
    fallbackAttempt: result.fallbackAttempt,
    elapsedMs,
    solution: result.solution,
  });
}

const RUNS = 1000;
const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
let solved = 0;
let fallbackCount = 0;
let totalMs = 0;
let maxMs = 0;
const fallbackRows = [];
for (let index = 0; index < scrambles.length; index += 1) {
  const scramble = scrambles[index];
  const startedAt = performance.now();
  const result = await solveFmcWasm(scramble, {
    maxPremoveSets: 40,
    enableCoverageFallback: true,
  });
  const elapsedMs = performance.now() - startedAt;
  totalMs += elapsedMs;
  maxMs = Math.max(maxMs, elapsedMs);
  if (!result?.ok || !result.solution) {
    throw new Error(`FMC_UNSOLVED:${index}:${scramble}:${result?.reason || "UNKNOWN"}`);
  }
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`FMC_INVALID:${index}:${scramble}`);
  }
  solved += 1;
  if (result.fallbackUsed === true) {
    fallbackCount += 1;
    fallbackRows.push({
      index,
      scramble,
      moveCount: result.moveCount,
      fallbackAttempt: result.fallbackAttempt,
      elapsedMs,
    });
  }
  if ((index + 1) % 100 === 0) console.log(`coverage: ${index + 1}/${RUNS}`);
}

if (solved !== RUNS) throw new Error(`COVERAGE_INCOMPLETE:${solved}/${RUNS}`);
if (fallbackCount !== 3) throw new Error(`FALLBACK_COUNT_CHANGED:${fallbackCount}`);

console.log(JSON.stringify({
  targeted,
  summary: {
    runs: RUNS,
    solved,
    fallbackCount,
    averageMs: totalMs / RUNS,
    maxMs,
  },
  fallbackRows,
}, null, 2));
