import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const scramble = "L2 D2 F R' F' U2 R B D2 L F U' F2 R2 U' B R B' U' B' L' U' B R' B";
const variants = [44, 81, 118, 192, 229, 266];
const profileBase = {
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
  const result = await solveFmcWasm(scramble, { ...profileBase, searchVariant });
  const elapsedMs = Math.round(performance.now() - started);
  if (!result?.ok || !result.solution) throw new Error(`SOLVE_FAILED:${searchVariant}`);
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) throw new Error(`VERIFY_FAILED:${searchVariant}`);
  const row = { searchVariant, moveCount: Number(result.moveCount), elapsedMs, solution: result.solution };
  rows.push(row);
  console.log(`FMC_SUB20_ROW ${JSON.stringify(row)}`);
  if (row.moveCount <= 19) break;
}
console.log(`FMC_SUB20_SUMMARY ${JSON.stringify(rows)}`);
