import { performance } from "node:perf_hooks";
import { buildFmcTablesWasm, solveFmcWasm } from "./solver/wasmSolver.js";

const scramble = "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L";
const options = {
  maxPremoveSets: 24,
  searchLevel: 3,
  searchVariant: 0,
  incumbentMoveCount: 40,
  enableHtrSkeletons: true,
  enableMultiInsertion: true,
  enableSliceInsertion: true,
  enableMultiSwitchNiss: true,
  enableDeepMultiSwitchNiss: true,
};

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const rows = [];
for (let run = 0; run < 3; run += 1) {
  const startedAt = performance.now();
  const result = await solveFmcWasm(scramble, { ...options, searchVariant: run });
  rows.push({
    run,
    elapsedMs: performance.now() - startedAt,
    ok: result?.ok === true,
    moveCount: Number(result?.moveCount || 0),
    candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
    reason: result?.reason || null,
  });
  console.log(JSON.stringify(rows.at(-1)));
}
console.log("FMC_DEEP_WARM=" + JSON.stringify(rows));
