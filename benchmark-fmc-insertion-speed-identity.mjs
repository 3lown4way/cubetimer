import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  optimizeInsertionWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const CASES = [
  ["R B2 U' L2 D L2 F2 U' B2 F2 L2 F D F2 L B U' B' D' R2", "U L' F' L2 B' R' U' F2 U' B2 L2 F2 U2 L F2 L F2 L2 D2 R' U2 R' D2"],
  ["F' R L D B U2 R F2 U2 F2 U R2 U' R2 U' B2 U' R2 F L'", "F B R' F U R U B2 D2 R L2 U B2 R2 B2 U' F2 U2 D F2 D R2"],
  ["D B2 R2 F D' R F2 L U2 L2 D2 B' R' F U2 B2 L2 B D'", "L B L' F B2 D L U' L2 D2 B2 L U' R' D2 L2 F2 L' B2 R' B2 U2"],
  ["L U' F' R D B R2 F' L2 D' F2 R' D' B2 U' F2 R2 U L'", "L B2 U2 R' U2 R D2 L2 B2 F2 D2 L' U R B2 D' F2 R F' R L' D' F"],
  ["R' F D' L2 B R D F2 L' B2 D2 R' U' F' D B2 L2 F U2", "U2 F2 L B2 L D2 R U2 R2 U' L2 R' D' F2 R' B2 L2 B' R L' U F'"],
  ["B D R' F' L' D' R2 B2 U F L D' B' R F2 D R' B2 L2", "D2 R2 U2 F2 D2 R2 F' L2 F2 R2 F2 R B R2 L' B R' U2 R B' U' B' F' D'"],
  ["F' L' B R' D' L' F D' B' L2 D B2 U R' B D2 F' R' U2", "F2 R L' B2 D2 U2 L2 D2 L' U R U B2 R' U' L2 D' L2 B' D2 F2 R"],
  ["R B' L' F' R D B2 L U' R' D2 B R2 F L D B' F' U2 L'", "D F U2 B U L' D U2 R2 F2 D2 R2 L' U' R B2 L' U2 F2 L' B2 L' U2"],
  ["U F2 R L' B D' L' F R' D2 L' F' D2 R2 B2 L2 D' F' U R'", "L B' L D' U2 F2 D' L U2 F2 D' B2 L' B2 U2 L' F2 D2 L2 F2 L' F2"],
  ["L2 D' B2 F' R' D2 B' L' F' D2 F2 R' U L B D R2 B' L2", "U2 F R2 F2 R2 D2 B U2 L2 B' D2 L2 R D2 L' F' D L' B F2 U"],
];

const REPEATS = Math.max(1, Number.parseInt(process.env.FMC_INSERTION_REPEATS || "4", 10));
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");

const rows = [];
for (let repeat = 0; repeat < REPEATS; repeat += 1) {
  for (let index = 0; index < CASES.length; index += 1) {
    const [scramble, inputSolution] = CASES[index];
    const startedAt = performance.now();
    const result = await optimizeInsertionWasm(scramble, inputSolution, {
      maxPasses: 3,
      minWindow: 3,
      maxWindow: 7,
      maxDepth: 6,
    });
    const elapsedMs = performance.now() - startedAt;
    if (!result?.ok || !result.solution) throw new Error(`INSERTION_FAILED:${repeat}:${index}`);
    const verification = await verifyFmcSolutionWasm(scramble, result.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`INSERTION_INVALID:${repeat}:${index}`);
    }
    rows.push({
      repeat,
      index,
      scramble,
      inputSolution,
      solution: String(result.solution),
      moveCount: Number(result.moveCount || 0),
      elapsedMs,
    });
  }
}

const times = rows.map((row) => row.elapsedMs);
const summary = {
  cases: CASES.length,
  repeats: REPEATS,
  runs: rows.length,
  averageMs: average(times),
  medianMs: percentile(times, 0.5),
  p95Ms: percentile(times, 0.95),
};
const output = { summary, rows };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(summary));
