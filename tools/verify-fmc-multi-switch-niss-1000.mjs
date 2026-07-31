import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const RUNS = Math.max(1, Number.parseInt(process.env.FMC_MULTI_NISS_RUNS || "1000", 10));
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

function summarizeMode(name, moveCounts, times, fallbacks, eoFallbacks, candidateCases, candidateCount) {
  return {
    name,
    solved: moveCounts.length,
    averageMoves: average(moveCounts),
    averageMs: average(times),
    maxMs: Math.max(...times),
    fallbacks,
    eoFallbacks,
    candidateCases,
    candidateCount,
  };
}

function comparison(modeMoves, baselineMoves) {
  let improved = 0;
  let equal = 0;
  let regressed = 0;
  let totalMovesSaved = 0;
  const savingsDistribution = {};
  for (let index = 0; index < modeMoves.length; index += 1) {
    const saved = baselineMoves[index] - modeMoves[index];
    if (saved > 0) {
      improved += 1;
      totalMovesSaved += saved;
      savingsDistribution[String(saved)] = (savingsDistribution[String(saved)] || 0) + 1;
    } else if (saved < 0) {
      regressed += 1;
    } else {
      equal += 1;
    }
  }
  return { improved, equal, regressed, totalMovesSaved, savingsDistribution };
}

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const scrambles = Array.from({ length: RUNS }, () => deterministicScramble());
const data = {
  baseline: { moves: [], times: [], fallbacks: 0, eoFallbacks: 0, candidateCases: 0, candidateCount: 0 },
  standard: { moves: [], times: [], fallbacks: 0, eoFallbacks: 0, candidateCases: 0, candidateCount: 0 },
  deep: { moves: [], times: [], fallbacks: 0, eoFallbacks: 0, candidateCases: 0, candidateCount: 0 },
};
const winningSources = { standard: {}, deep: {} };
const notable = [];

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
  const configs = [
    ["baseline", { enableMultiSwitchNiss: false, enableDeepMultiSwitchNiss: false }],
    ["standard", { enableMultiSwitchNiss: true, enableDeepMultiSwitchNiss: false }],
    // Deep alone must imply EO+DR search.
    ["deep", { enableMultiSwitchNiss: false, enableDeepMultiSwitchNiss: true }],
  ];
  const results = {};

  for (const [name, extra] of configs) {
    const startedAt = performance.now();
    const result = await solveFmcWasm(scramble, { ...common, ...extra });
    const elapsed = performance.now() - startedAt;
    if (!result?.ok) throw new Error(`FMC_MULTI_NISS_SOLVE_FAILED:${name}:${index}:${scramble}`);
    results[name] = result;
    data[name].moves.push(Number(result.moveCount));
    data[name].times.push(elapsed);
    if (result.fallbackUsed) data[name].fallbacks += 1;
    if (result.eoFallbackUsed) data[name].eoFallbacks += 1;
    const count = Number(result.multiSwitchNissCandidateCount || 0);
    data[name].candidateCount += count;
    if (count > 0) data[name].candidateCases += 1;

    if (name !== "baseline") {
      const checked = new Set();
      for (const candidate of result.candidates || []) {
        const source = String(candidate.source || "");
        if (!source.includes("MULTI_NISS") && candidate !== result.candidates?.[0]) continue;
        if (checked.has(candidate.solution)) continue;
        checked.add(candidate.solution);
        const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
        if (!verification?.ok || verification.solved !== true) {
          throw new Error(`FMC_MULTI_NISS_INVALID:${name}:${index}:${candidate.solution}`);
        }
      }
    }
  }

  if (results.standard.moveCount > results.baseline.moveCount) {
    throw new Error(`STANDARD_REGRESSION:${index}:${scramble}`);
  }
  if (results.deep.moveCount > results.standard.moveCount) {
    throw new Error(`DEEP_REGRESSION:${index}:${scramble}`);
  }

  for (const name of ["standard", "deep"]) {
    if (results[name].moveCount < results.baseline.moveCount) {
      const source = String(results[name].candidates?.[0]?.source || "UNKNOWN");
      winningSources[name][source] = (winningSources[name][source] || 0) + 1;
    }
  }

  const standardSaved = results.baseline.moveCount - results.standard.moveCount;
  const deepSaved = results.baseline.moveCount - results.deep.moveCount;
  if (standardSaved >= 3 || deepSaved >= 3 || deepSaved > standardSaved) {
    notable.push({
      index,
      scramble,
      baseline: results.baseline.moveCount,
      standard: results.standard.moveCount,
      deep: results.deep.moveCount,
      standardSource: results.standard.candidates?.[0]?.source || "",
      deepSource: results.deep.candidates?.[0]?.source || "",
    });
  }

  if ((index + 1) % 100 === 0) {
    console.log(`progress ${index + 1}/${RUNS}`);
  }
}

const baselineSummary = summarizeMode(
  "baseline",
  data.baseline.moves,
  data.baseline.times,
  data.baseline.fallbacks,
  data.baseline.eoFallbacks,
  data.baseline.candidateCases,
  data.baseline.candidateCount,
);
const standardSummary = summarizeMode(
  "standard-eo-only",
  data.standard.moves,
  data.standard.times,
  data.standard.fallbacks,
  data.standard.eoFallbacks,
  data.standard.candidateCases,
  data.standard.candidateCount,
);
const deepSummary = summarizeMode(
  "deep-eo-dr",
  data.deep.moves,
  data.deep.times,
  data.deep.fallbacks,
  data.deep.eoFallbacks,
  data.deep.candidateCases,
  data.deep.candidateCount,
);
standardSummary.runtimeRatio = standardSummary.averageMs / baselineSummary.averageMs;
deepSummary.runtimeRatio = deepSummary.averageMs / baselineSummary.averageMs;
standardSummary.comparison = comparison(data.standard.moves, data.baseline.moves);
deepSummary.comparison = comparison(data.deep.moves, data.baseline.moves);

const summary = {
  runs: RUNS,
  premoves: PREMOVES,
  baseline: baselineSummary,
  standard: standardSummary,
  deep: deepSummary,
  deepAdditionalWins: data.deep.moves.filter((moves, index) => moves < data.standard.moves[index]).length,
  winningSources,
  notable,
};
console.log(JSON.stringify(summary, null, 2));

if (standardSummary.comparison.regressed !== 0) {
  throw new Error(`STANDARD_MOVE_REGRESSION:${standardSummary.comparison.regressed}`);
}
if (deepSummary.comparison.regressed !== 0) {
  throw new Error(`DEEP_MOVE_REGRESSION:${deepSummary.comparison.regressed}`);
}
if (standardSummary.runtimeRatio > 1.6) {
  throw new Error(`STANDARD_RUNTIME_REGRESSION:${standardSummary.runtimeRatio}`);
}
if (deepSummary.runtimeRatio > 2.2) {
  throw new Error(`DEEP_RUNTIME_REGRESSION:${deepSummary.runtimeRatio}`);
}
if (standardSummary.comparison.improved === 0) throw new Error("STANDARD_NO_IMPROVEMENT");
if (deepSummary.comparison.improved < standardSummary.comparison.improved) {
  throw new Error("DEEP_LOST_STANDARD_IMPROVEMENTS");
}
