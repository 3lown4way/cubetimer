import { performance } from "node:perf_hooks";
import { getDefaultPattern } from "../solver/context.js";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_SLICE_RUNS || "100", 10));
const PREMOVE_SETS = Math.max(0, Number.parseInt(process.env.FMC_SLICE_PREMOVE_SETS || "120", 10));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertOrbitEqual(actual, expected, orbitName, label) {
  const a = actual.patternData?.[orbitName];
  const e = expected.patternData?.[orbitName];
  assert(a && e, `${label}:MISSING_${orbitName}`);
  assert(JSON.stringify(a.pieces) === JSON.stringify(e.pieces), `${label}:${orbitName}_PIECES`);
  assert(JSON.stringify(a.orientation) === JSON.stringify(e.orientation), `${label}:${orbitName}_ORIENTATION`);
}

// Independent semantic validation against the vendored cubing kpuzzle.
// Repository edge order is UF, UR, UB, UL, DF, DR, DB, DL, FR, FL, BR, BL.
const solvedPattern = await getDefaultPattern("333");
const sliceCases = [
  { slice: "E2", outer: "U2 D2", rotation: "y2", swaps: [[8, 11], [9, 10]] },
  { slice: "M2", outer: "R2 L2", rotation: "x2", swaps: [[0, 6], [2, 4]] },
  { slice: "S2", outer: "F2 B2", rotation: "z2", swaps: [[1, 7], [3, 5]] },
];
for (const testCase of sliceCases) {
  const sliced = solvedPattern.applyAlg(testCase.slice);
  assertOrbitEqual(sliced, solvedPattern, "CORNERS", `${testCase.slice}:CORNERS`);
  const expectedEdges = Array.from({ length: 12 }, (_, index) => index);
  for (const [left, right] of testCase.swaps) {
    [expectedEdges[left], expectedEdges[right]] = [expectedEdges[right], expectedEdges[left]];
  }
  assert(
    JSON.stringify(sliced.patternData.EDGES.pieces) === JSON.stringify(expectedEdges),
    `${testCase.slice}:EDGE_SWAP_MISMATCH:${JSON.stringify(sliced.patternData.EDGES.pieces)}`,
  );
  assert(
    sliced.patternData.EDGES.orientation.every((value) => value === 0),
    `${testCase.slice}:EDGE_ORIENTATION`,
  );
  const completed = sliced.applyAlg(testCase.outer);
  const rotation = solvedPattern.applyAlg(testCase.rotation);
  assert(completed.isIdentical(rotation), `${testCase.slice}:ROTATION_EQUIVALENCE`);
}

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
let comparedHumanCases = 0;
let fallbackCases = 0;
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
    enableCoverageFallback: true,
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

  if (disabled.fallbackUsed || enabled.fallbackUsed) {
    fallbackCases += 1;
  } else {
    comparedHumanCases += 1;
    if (enabled.moveCount < disabled.moveCount) improved += 1;
    if (enabled.moveCount > disabled.moveCount) regressed += 1;
  }

  if (!enabled.fallbackUsed) {
    const candidateCount = Number(enabled.sliceInsertionCandidateCount || 0);
    const skeletons = (enabled.skeletons || []).filter((skeleton) => skeleton.kind === "slice");
    if (candidateCount > 0) sliceCandidateCases += 1;
    if (skeletons.length > 0) sliceSkeletonCases += 1;
    sliceInsertionCandidateCount += candidateCount;
    sliceSkeletonCount += skeletons.length;
  }
}

const disabledAverageMs = average(disabledTimes);
const enabledAverageMs = average(enabledTimes);
const runtimeRatio = enabledAverageMs / Math.max(0.001, disabledAverageMs);
const summary = {
  semanticSliceCases: sliceCases.length,
  runs: RUNS,
  tableBuildMs,
  disabledSolved,
  enabledSolved,
  comparedHumanCases,
  fallbackCases,
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
