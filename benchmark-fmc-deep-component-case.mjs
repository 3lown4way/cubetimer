import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
  warmFmcDeepTablesWasm,
} from "./solver/wasmSolver.js";

const scramble = "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L";
const id = String(process.env.FMC_DEEP_CASE_ID || "unknown");
const deepComponentMask = Math.max(
  0,
  Math.min(15, Number.parseInt(process.env.FMC_DEEP_COMPONENT_MASK || "15", 10)),
);

const tableStartedAt = performance.now();
if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const tableBuildMs = performance.now() - tableStartedAt;
const warmStartedAt = performance.now();
const warmResult = await warmFmcDeepTablesWasm();
const warmMs = performance.now() - warmStartedAt;
if (!warmResult?.ok) throw new Error("FMC_DEEP_WARM_FAILED");

const options = {
  maxPremoveSets: 0,
  searchLevel: 3,
  searchVariant: 0,
  incumbentMoveCount: 40,
  enableHtrSkeletons: true,
  enableMultiSwitchNiss: false,
  enableDeepMultiSwitchNiss: true,
  deepComponentMask,
};
const startedAt = performance.now();
const result = await solveFmcWasm(scramble, options);
const elapsedMs = performance.now() - startedAt;

const solved = result?.ok === true && result.solution && Array.isArray(result.candidates);
if (solved) {
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`FMC_DEEP_COMPONENT_INVALID:${id}`);
  }
}

const sources = solved
  ? result.candidates.map((candidate) => String(candidate?.source || ""))
  : [];
const row = {
  id,
  deepComponentMask,
  tableBuildMs,
  warmMs,
  elapsedMs,
  ok: solved === true,
  reason: solved ? null : String(result?.reason || "FMC_NO_SOLUTION"),
  moveCount: solved ? Number(result.moveCount || 0) : 0,
  candidateCount: solved ? result.candidates.length : 0,
  invalidCandidateCount: Number(result?.invalidCandidateCount || 0),
  sources,
  complementaryMitmCandidates: sources.filter((source) => source.includes("COMPLEMENTARY_MITM")).length,
  complementaryNormalCandidates: sources.filter((source) => source.includes("COMPLEMENTARY_NORMAL")).length,
  preEoCandidates: sources.filter((source) => source.includes("PRE_EO_NISS")).length,
  multiSwitchCandidates: Number(result?.multiSwitchNissCandidateCount || 0),
};
console.log("FMC_DEEP_COMPONENT_RESULT=" + JSON.stringify(row));
