import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_MULTI_NISS_RUNS || "100", 10));
const PREMOVES = Math.max(0, Number.parseInt(process.env.FMC_MULTI_NISS_PREMOVES || "40", 10));

let rngState = 0x4e495353;
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

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const baselineTimes = [];
const enabledTimes = [];
let solved = 0;
let improved = 0;
let equal = 0;
let regressed = 0;
let baselineFallbacks = 0;
let enabledFallbacks = 0;
let candidateCases = 0;
let candidateCount = 0;
let winningCases = 0;
const improvements = [];
const sourceCounts = new Map();

for (let index = 0; index < scrambles.length; index += 1) {
  const scramble = scrambles[index];
  const common = {
    maxPremoveSets: PREMOVES,
    forceRzp: false,
    enableMultiInsertion: false,
    enableHtrSkeletons: false,
    enableSliceInsertion: false,
    enableCoverageFallback: true,
  };

  let startedAt = performance.now();
  const baseline = await solveFmcWasm(scramble, {
    ...common,
    enableMultiSwitchNiss: false,
  });
  baselineTimes.push(performance.now() - startedAt);

  startedAt = performance.now();
  const enabled = await solveFmcWasm(scramble, {
    ...common,
    enableMultiSwitchNiss: true,
  });
  enabledTimes.push(performance.now() - startedAt);

  if (!baseline?.ok || !enabled?.ok) {
    throw new Error(`FMC_MULTI_NISS_SOLVE_FAILED:${index}:${scramble}`);
  }
  solved += 1;
  if (baseline.fallbackUsed) baselineFallbacks += 1;
  if (enabled.fallbackUsed) enabledFallbacks += 1;

  for (const candidate of enabled.candidates || []) {
    const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`FMC_MULTI_NISS_INVALID:${index}:${candidate.solution}`);
    }
    if (String(candidate.source || "").includes("MULTI_NISS")) {
      sourceCounts.set(candidate.source, (sourceCounts.get(candidate.source) || 0) + 1);
    }
  }

  const count = Number(enabled.multiSwitchNissCandidateCount || 0);
  if (count > 0) candidateCases += 1;
  candidateCount += count;

  if (enabled.moveCount < baseline.moveCount) {
    improved += 1;
    const winningSource = enabled.candidates?.[0]?.source || "";
    if (String(winningSource).includes("MULTI_NISS")) winningCases += 1;
    improvements.push({
      index,
      scramble,
      baseline: baseline.moveCount,
      enabled: enabled.moveCount,
      source: winningSource,
      solution: enabled.solution,
    });
  } else if (enabled.moveCount > baseline.moveCount) {
    regressed += 1;
  } else {
    equal += 1;
  }
}

const baselineAverageMs = average(baselineTimes);
const enabledAverageMs = average(enabledTimes);
const summary = {
  runs: RUNS,
  premoves: PREMOVES,
  solved,
  improved,
  equal,
  regressed,
  baselineFallbacks,
  enabledFallbacks,
  candidateCases,
  candidateCount,
  winningCases,
  baselineAverageMs,
  enabledAverageMs,
  runtimeRatio: enabledAverageMs / Math.max(0.001, baselineAverageMs),
  sourceCounts: Object.fromEntries([...sourceCounts.entries()].sort()),
  improvements,
};
console.log(JSON.stringify(summary, null, 2));

if (regressed !== 0) throw new Error(`MULTI_NISS_MOVE_REGRESSION:${regressed}`);
if (summary.runtimeRatio > 2.5) {
  throw new Error(`MULTI_NISS_RUNTIME_REGRESSION:${summary.runtimeRatio}`);
}
