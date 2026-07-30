import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_SLICE_RUNS || "100", 10));
const PREMOVE_SETS = Math.max(0, Number.parseInt(process.env.FMC_SLICE_PREMOVE_SETS || "40", 10));

let rngState = 0x7a11ce42;
function randomUnit() {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) / 0x100000000;
}

const faces = ["U", "D", "R", "L", "F", "B"];
const suffixes = ["", "'", "2"];
const axes = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
function deterministicScramble(length = 21) {
  const moves = [];
  let lastFace = "";
  let lastAxis = -1;
  for (let index = 0; index < length; index += 1) {
    let face;
    do {
      face = faces[Math.floor(randomUnit() * faces.length)];
    } while (face === lastFace || axes[face] === lastAxis);
    moves.push(face + suffixes[Math.floor(randomUnit() * suffixes.length)]);
    lastFace = face;
    lastAxis = axes[face];
  }
  return moves.join(" ");
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

const readyStartedAt = performance.now();
if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const tableBuildMs = performance.now() - readyStartedAt;

const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const disabledTimes = [];
const enabledTimes = [];
let disabledSolved = 0;
let enabledSolved = 0;
let improved = 0;
let regressed = 0;
let sliceCandidateCases = 0;
let sliceSkeletonCases = 0;
let sliceInsertionCandidateCount = 0;
let sliceSkeletonCount = 0;

for (let index = 0; index < scrambles.length; index += 1) {
  const scramble = scrambles[index];
  const common = {
    maxPremoveSets: PREMOVE_SETS,
    forceRzp: false,
    enableMultiInsertion: false,
    enableHtrSkeletons: false,
    enableCoverageFallback: false,
  };

  let startedAt = performance.now();
  const disabled = await solveFmcWasm(scramble, {
    ...common,
    enableSliceInsertion: false,
  });
  disabledTimes.push(performance.now() - startedAt);

  startedAt = performance.now();
  const enabled = await solveFmcWasm(scramble, {
    ...common,
    enableSliceInsertion: true,
  });
  enabledTimes.push(performance.now() - startedAt);

  if (!disabled?.ok || !enabled?.ok) {
    throw new Error(`FMC_SLICE_SOLVE_FAILED:${index}:${scramble}`);
  }
  disabledSolved += 1;
  enabledSolved += 1;

  for (const candidate of enabled.candidates || []) {
    const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`FMC_SLICE_CANDIDATE_INVALID:${index}:${candidate.solution}`);
    }
  }

  if (enabled.moveCount < disabled.moveCount) improved += 1;
  if (enabled.moveCount > disabled.moveCount) regressed += 1;

  const candidateCount = Number(enabled.sliceInsertionCandidateCount || 0);
  const skeletons = (enabled.skeletons || []).filter((skeleton) => skeleton.kind === "slice");
  if (candidateCount > 0) sliceCandidateCases += 1;
  if (skeletons.length > 0) sliceSkeletonCases += 1;
  sliceInsertionCandidateCount += candidateCount;
  sliceSkeletonCount += skeletons.length;
}

const disabledAverageMs = average(disabledTimes);
const enabledAverageMs = average(enabledTimes);
const runtimeRatio = enabledAverageMs / Math.max(0.001, disabledAverageMs);
const summary = {
  runs: RUNS,
  tableBuildMs,
  disabledSolved,
  enabledSolved,
  sliceCandidateCases,
  sliceSkeletonCases,
  sliceInsertionCandidateCount,
  sliceSkeletonCount,
  improved,
  regressed,
  disabledAverageMs,
  enabledAverageMs,
  runtimeRatio,
};
console.log(JSON.stringify(summary, null, 2));

if (regressed !== 0) throw new Error(`SLICE_MOVE_COUNT_REGRESSION:${regressed}`);
if (sliceSkeletonCount === 0) throw new Error("SLICE_SKELETONS_NOT_GENERATED");
if (sliceInsertionCandidateCount === 0) throw new Error("SLICE_CANDIDATES_NOT_GENERATED");
if (runtimeRatio > 1.6) throw new Error(`SLICE_RUNTIME_REGRESSION:${runtimeRatio}`);
