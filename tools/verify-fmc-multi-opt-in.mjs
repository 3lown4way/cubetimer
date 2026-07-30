import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(20, Number.parseInt(process.env.FMC_OPT_IN_RUNS || "200", 10));
const PREMOVE_SETS = Math.max(0, Number.parseInt(process.env.FMC_OPT_IN_PREMOVE_SETS || "40", 10));

let rngState = 0x4f505449;
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

async function runVariant(enableMultiInsertion) {
  const rows = [];
  for (let index = 0; index < scrambles.length; index += 1) {
    const scramble = scrambles[index];
    const startedAt = performance.now();
    const result = await solveFmcWasm(scramble, {
      maxPremoveSets: PREMOVE_SETS,
      forceRzp: false,
      enableMultiInsertion,
    });
    const elapsedMs = performance.now() - startedAt;
    const ok = result?.ok === true && Boolean(result.solution) && Array.isArray(result.candidates);
    if (!ok) {
      rows.push({ index, scramble, ok: false, moveCount: null, elapsedMs, result });
      continue;
    }

    const bestVerification = await verifyFmcSolutionWasm(scramble, result.solution);
    if (!bestVerification?.ok || bestVerification.solved !== true) {
      throw new Error(`INVALID_BEST:${enableMultiInsertion}:${index}`);
    }

    const multiCandidates = result.candidates.filter(
      (candidate) => Number(candidate?.insertionCount || 0) >= 2,
    );
    for (const candidate of multiCandidates) {
      const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
      if (!verification?.ok || verification.solved !== true) {
        throw new Error(`INVALID_MULTI:${index}:${candidate.solution}`);
      }
    }

    const multiSkeletons = (result.skeletons || []).filter((skeleton) =>
      ["corner4", "edge4", "corner3edge3"].includes(String(skeleton?.kind || "")),
    );
    rows.push({
      index,
      scramble,
      ok: true,
      moveCount: Number(result.moveCount || 0),
      elapsedMs,
      multiInsertionCandidateCount: Number(result.multiInsertionCandidateCount || 0),
      multiCandidateTopCount: multiCandidates.length,
      multiSkeletonCount: multiSkeletons.length,
    });
  }
  return rows;
}

const defaults = await runVariant(false);
const optIn = await runVariant(true);

let regressions = 0;
let lost = 0;
let improved = 0;
let equal = 0;
let recovered = 0;
for (let index = 0; index < RUNS; index += 1) {
  const before = defaults[index];
  const after = optIn[index];
  if (before.scramble !== after.scramble) throw new Error(`SCRAMBLE_MISMATCH:${index}`);
  if (before.ok && after.ok) {
    if (after.moveCount < before.moveCount) improved += 1;
    else if (after.moveCount === before.moveCount) equal += 1;
    else regressions += 1;
  } else if (before.ok && !after.ok) {
    lost += 1;
  } else if (!before.ok && after.ok) {
    recovered += 1;
  }
}

const defaultMultiLeaks = defaults.filter(
  (row) =>
    Number(row.multiInsertionCandidateCount || 0) > 0 ||
    Number(row.multiCandidateTopCount || 0) > 0 ||
    Number(row.multiSkeletonCount || 0) > 0,
).length;
const optInGeneratedCases = optIn.filter(
  (row) => Number(row.multiInsertionCandidateCount || 0) > 0,
).length;
const defaultAverageMs = average(defaults.map((row) => row.elapsedMs));
const optInAverageMs = average(optIn.map((row) => row.elapsedMs));
const runtimeRatio = optInAverageMs / Math.max(0.001, defaultAverageMs);

const summary = {
  runs: RUNS,
  premoveSets: PREMOVE_SETS,
  defaultSolved: defaults.filter((row) => row.ok).length,
  optInSolved: optIn.filter((row) => row.ok).length,
  improved,
  equal,
  regressions,
  recovered,
  lost,
  defaultMultiLeaks,
  optInGeneratedCases,
  defaultAverageMs,
  optInAverageMs,
  runtimeRatio,
};
console.log(JSON.stringify(summary));

if (defaultMultiLeaks > 0) throw new Error(`DEFAULT_MULTI_LEAK:${defaultMultiLeaks}`);
if (optInGeneratedCases === 0) throw new Error("OPT_IN_MULTI_NOT_EXERCISED");
if (regressions > 0 || lost > 0) {
  throw new Error(`OPT_IN_QUALITY_REGRESSION:${regressions}:${lost}`);
}
if (runtimeRatio < 1.3) {
  throw new Error(`DEFAULT_PATH_NOT_FAST_ENOUGH:${runtimeRatio.toFixed(3)}`);
}
