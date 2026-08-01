import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const testCase = {
  id: "random-example-1",
  scramble: "L2 D2 F R' F' U2 R B D2 L F U' F2 R2 U' B R B' U' B' L' U' B R' B",
};
const variants = [155, 192, 229, 266];
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
for (const searchVariant of variants) {
  const started = performance.now();
  const result = await solveFmcWasm(testCase.scramble, { ...baseProfile, searchVariant });
  const elapsedMs = Math.round(performance.now() - started);
  if (!result?.ok || !result.solution) throw new Error(`SOLVE_FAILED:${searchVariant}`);
  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) throw new Error(`VERIFY_FAILED:${searchVariant}`);
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
rows.sort((a, b) => a.moveCount - b.moveCount || a.elapsedMs - b.elapsedMs || a.searchVariant - b.searchVariant);
console.log(`FMC_VARIANT_SUMMARY ${JSON.stringify({ id: testCase.id, best: rows[0], rows })}`);
