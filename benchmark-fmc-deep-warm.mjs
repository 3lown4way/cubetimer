import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
  warmFmcDeepTablesWasm,
} from "./solver/wasmSolver.js";

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
const warmStartedAt = performance.now();
const warmResult = await warmFmcDeepTablesWasm();
const warmElapsedMs = performance.now() - warmStartedAt;
if (!warmResult?.ok) throw new Error("FMC_DEEP_WARM_FAILED");
console.log("FMC_DEEP_TABLES=" + JSON.stringify({ warmElapsedMs, ...warmResult }));

const rows = [];
for (let run = 0; run < 3; run += 1) {
  const startedAt = performance.now();
  // Repeat the same viable frontier. Changing searchVariant here measures
  // diversification quality, not cold-vs-warm execution cost.
  const result = await solveFmcWasm(scramble, options);
  const elapsedMs = performance.now() - startedAt;
  if (!result?.ok || !result.solution || !Array.isArray(result.candidates)) {
    throw new Error(`FMC_DEEP_REPEAT_FAILED:${run}:${result?.reason || "UNKNOWN"}`);
  }
  const candidateChecks = [];
  for (const candidate of result.candidates) {
    const check = await verifyFmcSolutionWasm(scramble, candidate.solution);
    candidateChecks.push({
      solution: String(candidate.solution || ""),
      moveCount: Number(candidate.moveCount || 0),
      source: String(candidate.source || ""),
      axisName: String(candidate.axisName || ""),
      solved: check?.ok === true && check.solved === true,
      verification: check || null,
    });
  }
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(
      `FMC_DEEP_REPEAT_INVALID:${run}:${JSON.stringify({
        solution: result.solution,
        moveCount: result.moveCount,
        verification,
        candidateChecks,
      })}`,
    );
  }
  rows.push({
    run,
    elapsedMs,
    ok: true,
    moveCount: Number(result.moveCount || 0),
    candidateCount: result.candidates.length,
    reason: null,
  });
  console.log(JSON.stringify(rows.at(-1)));
}

const moveCounts = new Set(rows.map((row) => row.moveCount));
if (moveCounts.size !== 1) throw new Error("FMC_DEEP_REPEAT_NONDETERMINISTIC");
console.log("FMC_DEEP_WARM=" + JSON.stringify({ warmElapsedMs, warmResult, rows }));
