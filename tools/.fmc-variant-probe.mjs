import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const cases = [
  {
    id: "random-example-1",
    scramble: "L2 D2 F R' F' U2 R B D2 L F U' F2 R2 U' B R B' U' B' L' U' B R' B",
  },
  {
    id: "random-example-2",
    scramble: "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2",
  },
];
const variants = [7, 44, 81, 118];
const baseProfile = {
  maxPremoveSets: 24,
  searchLevel: 3,
  incumbentMoveCount: 34,
  forceRzp: false,
  enableCoverageFallback: true,
  enableMultiSwitchNiss: true,
  enableDeepMultiSwitchNiss: true,
  enableHtrSkeletons: true,
  enableSliceInsertion: true,
  enableMultiInsertion: true,
};

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const rows = [];
for (const testCase of cases) {
  for (const searchVariant of variants) {
    const started = performance.now();
    const result = await solveFmcWasm(testCase.scramble, { ...baseProfile, searchVariant });
    const elapsedMs = Math.round(performance.now() - started);
    if (!result?.ok || !result.solution) throw new Error(`SOLVE_FAILED:${testCase.id}:${searchVariant}`);
    const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`VERIFY_FAILED:${testCase.id}:${searchVariant}`);
    }
    const row = {
      id: testCase.id,
      searchVariant,
      moveCount: Number(result.moveCount),
      elapsedMs,
      source: String(result.source || ""),
      solution: result.solution,
    };
    rows.push(row);
    console.log(`FMC_VARIANT_ROW ${JSON.stringify(row)}`);
  }
}
const summary = cases.map((testCase) => {
  const matches = rows.filter((row) => row.id === testCase.id);
  matches.sort((a, b) => a.moveCount - b.moveCount || a.elapsedMs - b.elapsedMs || a.searchVariant - b.searchVariant);
  return { id: testCase.id, best: matches[0], rows: matches };
});
console.log(`FMC_VARIANT_SUMMARY ${JSON.stringify(summary)}`);
