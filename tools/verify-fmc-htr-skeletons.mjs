import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Number(process.env.FMC_HTR_RUNS || 100);
const PREMOVES = Number(process.env.FMC_HTR_PREMOVE_SETS || 40);
const MOVES = ["U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "D2", "L", "L'", "L2", "B", "B'", "B2"];

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function makeScrambles(count) {
  const random = rng(0x48545231);
  const result = [];
  for (let n = 0; n < count; n += 1) {
    const scramble = [];
    let lastFace = -1;
    for (let i = 0; i < 21; i += 1) {
      let moveIndex;
      do {
        moveIndex = Math.floor(random() * MOVES.length);
      } while (Math.floor(moveIndex / 3) === lastFace);
      scramble.push(MOVES[moveIndex]);
      lastFace = Math.floor(moveIndex / 3);
    }
    result.push(scramble.join(" "));
  }
  return result;
}

async function solved(scramble, solution) {
  const result = await verifyFmcSolutionWasm(scramble, solution);
  return result?.ok === true && result?.solved === true;
}

const buildStarted = performance.now();
if (!(await buildFmcTablesWasm())) throw new Error("FMC tables unavailable");
const normalTableMs = performance.now() - buildStarted;
const scrambles = makeScrambles(RUNS);
const summary = {
  runs: RUNS,
  normalTableMs,
  disabledSolved: 0,
  enabledSolved: 0,
  htrCandidateCases: 0,
  htrSkeletonCases: 0,
  htrCandidateCount: 0,
  htrSkeletonCount: 0,
  improved: 0,
  regressed: 0,
  disabledMs: [],
  enabledMs: [],
};

for (let i = 0; i < scrambles.length; i += 1) {
  const scramble = scrambles[i];
  const offStart = performance.now();
  const off = await solveFmcWasm(scramble, {
    maxPremoveSets: PREMOVES,
    enableCoverageFallback: false,
    enableMultiInsertion: false,
    enableHtrSkeletons: false,
  });
  summary.disabledMs.push(performance.now() - offStart);

  const onStart = performance.now();
  const on = await solveFmcWasm(scramble, {
    maxPremoveSets: PREMOVES,
    enableCoverageFallback: false,
    enableMultiInsertion: false,
    enableHtrSkeletons: true,
  });
  summary.enabledMs.push(performance.now() - onStart);

  const offValid = off?.ok === true && await solved(scramble, off.solution);
  const onValid = on?.ok === true && await solved(scramble, on.solution);
  if (offValid) summary.disabledSolved += 1;
  if (onValid) summary.enabledSolved += 1;
  if (offValid && !onValid) throw new Error(`HTR lost solved case ${i}: ${scramble}`);

  const htrCandidates = Number(on?.htrCandidateCount || 0);
  const htrSkeletons = Number(on?.htrSkeletonCount || 0);
  summary.htrCandidateCount += htrCandidates;
  summary.htrSkeletonCount += htrSkeletons;
  if (htrCandidates > 0) summary.htrCandidateCases += 1;
  if (htrSkeletons > 0) summary.htrSkeletonCases += 1;

  if (offValid && onValid) {
    if (on.moveCount < off.moveCount) summary.improved += 1;
    if (on.moveCount > off.moveCount) {
      summary.regressed += 1;
      throw new Error(`HTR move regression ${i}: ${off.moveCount} -> ${on.moveCount}`);
    }
  }
  if ((i + 1) % 20 === 0) console.log(`HTR validation: ${i + 1}/${RUNS}`);
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
summary.disabledAverageMs = average(summary.disabledMs);
summary.enabledAverageMs = average(summary.enabledMs);
summary.runtimeRatio = summary.enabledAverageMs / Math.max(0.001, summary.disabledAverageMs);
delete summary.disabledMs;
delete summary.enabledMs;
console.log(JSON.stringify(summary, null, 2));

if (summary.enabledSolved < summary.disabledSolved) throw new Error("HTR reduced solve coverage");
if (summary.htrCandidateCount === 0 && summary.htrSkeletonCount === 0) {
  throw new Error("HTR path generated no candidates or skeletons");
}
