import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const SCRAMBLES = [
  "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L",
  "R2 U' F2 D L2 B' U2 R F' D2 L U' B2 R2 D F U2 L' B' R",
  "F U2 R' D2 B L2 U F2 R2 D' L B' U2 R F' D L2 B2 U' R'",
  "L2 B U' R2 F D2 L' U2 B2 R D' F2 U L B' R2 D F' U2 L'",
];

const PROFILES = [
  {
    id: "direct",
    options: {
      maxPremoveSets: 0,
      searchLevel: 0,
      searchVariant: 0,
      incumbentMoveCount: 40,
    },
  },
  {
    id: "sweet",
    options: {
      maxPremoveSets: 40,
      searchLevel: 0,
      searchVariant: 0,
      incumbentMoveCount: 40,
    },
  },
  {
    id: "extreme-core",
    options: {
      maxPremoveSets: 96,
      searchLevel: 3,
      searchVariant: 0,
      incumbentMoveCount: 40,
      enableHtrSkeletons: true,
      enableMultiSwitchNiss: true,
      enableDeepMultiSwitchNiss: true,
    },
  },
  {
    id: "extreme-full",
    options: {
      maxPremoveSets: 96,
      searchLevel: 3,
      searchVariant: 0,
      incumbentMoveCount: 40,
      enableHtrSkeletons: true,
      enableMultiInsertion: true,
      enableSliceInsertion: true,
      enableMultiSwitchNiss: true,
      enableDeepMultiSwitchNiss: true,
    },
  },
];

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

const tableStart = performance.now();
if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const tableBuildMs = performance.now() - tableStart;

const output = { tableBuildMs, profiles: [] };
for (const profile of PROFILES) {
  const rows = [];
  for (let index = 0; index < SCRAMBLES.length; index += 1) {
    const scramble = SCRAMBLES[index];
    const startedAt = performance.now();
    const result = await solveFmcWasm(scramble, profile.options);
    const elapsedMs = performance.now() - startedAt;
    let valid = false;
    if (result?.ok && result.solution) {
      const verification = await verifyFmcSolutionWasm(scramble, result.solution);
      valid = verification?.ok === true && verification.solved === true;
    }
    rows.push({
      index,
      ok: result?.ok === true,
      valid,
      elapsedMs,
      moveCount: Number(result?.moveCount || 0),
      candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
      skeletonCount: Number(result?.skeletonCount || 0),
      insertionCandidateCount: Number(result?.insertionCandidateCount || 0),
      multiSwitchNissCandidateCount: Number(result?.multiSwitchNissCandidateCount || 0),
      reason: result?.reason || null,
    });
    console.log(JSON.stringify({ profile: profile.id, ...rows.at(-1) }));
  }
  output.profiles.push({
    id: profile.id,
    success: rows.filter((row) => row.ok && row.valid).length,
    averageMs: average(rows.map((row) => row.elapsedMs)),
    averageMoves: average(rows.filter((row) => row.ok).map((row) => row.moveCount)),
    rows,
  });
}

console.log("FMC_PROFILE_SUMMARY=" + JSON.stringify(output));
