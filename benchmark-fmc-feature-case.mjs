import { performance } from "node:perf_hooks";
import { buildFmcTablesWasm, solveFmcWasm } from "./solver/wasmSolver.js";

const scramble = process.env.FMC_CASE_SCRAMBLE || "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L";
const options = JSON.parse(process.env.FMC_CASE_OPTIONS || "{}");
const id = process.env.FMC_CASE_ID || "unknown";

const buildStartedAt = performance.now();
const ready = await buildFmcTablesWasm();
const tableBuildMs = performance.now() - buildStartedAt;
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");

const startedAt = performance.now();
const result = await solveFmcWasm(scramble, options);
const elapsedMs = performance.now() - startedAt;
console.log("FMC_CASE_RESULT=" + JSON.stringify({
  id,
  tableBuildMs,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || null,
  moveCount: Number(result?.moveCount || 0),
  candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
  skeletonCount: Number(result?.skeletonCount || 0),
  insertionCandidateCount: Number(result?.insertionCandidateCount || 0),
  multiSwitchNissCandidateCount: Number(result?.multiSwitchNissCandidateCount || 0),
}));
