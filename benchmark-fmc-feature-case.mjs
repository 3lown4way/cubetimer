import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

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

if (result?.ok && Array.isArray(result.candidates)) {
  for (const candidate of result.candidates) {
    const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(
        `FMC_CASE_INVALID:${id}:${JSON.stringify({
          solution: candidate.solution,
          moveCount: candidate.moveCount,
          source: candidate.source,
          axisName: candidate.axisName,
          premoves: candidate.premoves,
          verification,
        })}`,
      );
    }
  }
}

const candidates = Array.isArray(result?.candidates)
  ? result.candidates.map((candidate) => ({
      moveCount: Number(candidate?.moveCount || 0),
      source: String(candidate?.source || ""),
      axisName: String(candidate?.axisName || ""),
      premoves: String(candidate?.premoves || ""),
      repairedPremoveNissOrder: candidate?.repairedPremoveNissOrder === true,
    }))
  : [];

console.log("FMC_CASE_RESULT=" + JSON.stringify({
  id,
  tableBuildMs,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || null,
  moveCount: Number(result?.moveCount || 0),
  candidateCount: candidates.length,
  candidates,
  invalidCandidateCount: Number(result?.invalidCandidateCount || 0),
  repairedPremoveNissCandidateCount: Number(result?.repairedPremoveNissCandidateCount || 0),
  skeletonCount: Number(result?.skeletonCount || 0),
  insertionCandidateCount: Number(result?.insertionCandidateCount || 0),
  multiSwitchNissCandidateCount: Number(result?.multiSwitchNissCandidateCount || 0),
}));
