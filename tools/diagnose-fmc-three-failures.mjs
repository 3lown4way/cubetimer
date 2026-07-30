import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const CASES = [
  {
    index: 653,
    scramble: "F' D F L U' L F R2 D' R2 U' L D L2 D' B D' B' D' B U'",
  },
  {
    index: 843,
    scramble: "U B L F U B2 D2 R2 D R' F' D' R2 U2 L U' F2 L' D L D",
  },
  {
    index: 934,
    scramble: "L2 B' R2 D B' U B2 D' F' R' D2 B' U L U' R D R' D2 F' R'",
  },
];

const SETTINGS = [
  { maxPremoveSets: 0, forceRzp: false },
  { maxPremoveSets: 40, forceRzp: false },
  { maxPremoveSets: 80, forceRzp: false },
  { maxPremoveSets: 120, forceRzp: false },
  { maxPremoveSets: 240, forceRzp: false },
  { maxPremoveSets: 40, forceRzp: true },
  { maxPremoveSets: 120, forceRzp: true },
  { maxPremoveSets: 240, forceRzp: true },
];

if (!(await buildFmcTablesWasm())) {
  throw new Error("FMC_TABLE_BUILD_FAILED");
}

const rows = [];
for (const testCase of CASES) {
  for (const options of SETTINGS) {
    const startedAt = performance.now();
    const result = await solveFmcWasm(testCase.scramble, options);
    const elapsedMs = performance.now() - startedAt;
    let solved = false;
    if (result?.ok && result.solution) {
      const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
      solved = verification?.ok === true && verification.solved === true;
      if (!solved) {
        throw new Error(`INVALID_SOLUTION:${testCase.index}:${JSON.stringify(options)}`);
      }
    }
    rows.push({
      index: testCase.index,
      scramble: testCase.scramble,
      ...options,
      ok: result?.ok === true,
      solved,
      reason: String(result?.reason || ""),
      moveCount: result?.ok ? Number(result.moveCount || 0) : null,
      candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
      skeletonCount: Number(result?.skeletonCount || 0),
      insertionCandidateCount: Number(result?.insertionCandidateCount || 0),
      elapsedMs,
      source: String(result?.candidates?.[0]?.source || ""),
    });
  }
}

for (const testCase of CASES) {
  console.log(`\nCASE ${testCase.index}: ${testCase.scramble}`);
  for (const row of rows.filter((item) => item.index === testCase.index)) {
    console.log(JSON.stringify(row));
  }
}

console.log("\nSUMMARY");
console.log(JSON.stringify({ rows }, null, 2));
