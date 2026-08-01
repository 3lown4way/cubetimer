import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const testCase = {
  id: "random-example-2",
  scramble: "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2",
};
const searchVariant = 155;
const profile = {
  maxPremoveSets: 24,
  searchLevel: 3,
  searchVariant,
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
const started = performance.now();
const result = await solveFmcWasm(testCase.scramble, profile);
const elapsedMs = Math.round(performance.now() - started);
if (!result?.ok || !result.solution) throw new Error("SOLVE_FAILED");
const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
if (!verification?.ok || verification.solved !== true) throw new Error("VERIFY_FAILED");
console.log(`FMC_SHARED_RETRY ${JSON.stringify({
  id: testCase.id,
  searchVariant,
  moveCount: Number(result.moveCount),
  elapsedMs,
  source: String(result.source || ""),
  solution: result.solution,
})}`);
