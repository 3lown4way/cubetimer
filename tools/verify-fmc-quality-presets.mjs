import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "../solver/fmcSolver.js";
import { buildFmcTablesWasm, verifyFmcSolutionWasm } from "../solver/wasmSolver.js";

const RUNS = Math.max(4, Number.parseInt(process.env.FMC_QUALITY_RUNS || "24", 10));
let rngState = 0x51554c54;
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

const data = {
  sweetSpot: { moves: [], times: [], targetHits: 0, stages: {}, solved: 0 },
  extreme: { moves: [], times: [], targetHits: 0, stages: {}, solved: 0 },
};
const notable = [];

for (let index = 0; index < RUNS; index += 1) {
  const scramble = deterministicScramble();
  const results = {};

  for (const qualityMode of ["sweetSpot", "extreme"]) {
    const startedAt = performance.now();
    const result = await solveWithFMCSearch(scramble, null, {
      qualityMode,
      enableInsertions: false,
      timeBudgetMs: qualityMode === "extreme" ? 120000 : 12000,
    });
    const elapsed = performance.now() - startedAt;
    if (!result?.ok) throw new Error(`FMC_QUALITY_SOLVE_FAILED:${qualityMode}:${index}:${result?.reason}`);
    const verification = await verifyFmcSolutionWasm(scramble, result.solution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`FMC_QUALITY_INVALID:${qualityMode}:${index}:${result.solution}`);
    }
    if (result.qualityMode !== qualityMode) {
      throw new Error(`FMC_QUALITY_MODE_METADATA:${qualityMode}:${result.qualityMode}`);
    }
    const diagnostics = result.performanceDiagnostics || {};
    if (diagnostics.qualityMode !== qualityMode || !Array.isArray(diagnostics.wasmStages)) {
      throw new Error(`FMC_QUALITY_DIAGNOSTICS:${qualityMode}:${index}`);
    }
    if (!diagnostics.wasmStages.length) throw new Error(`FMC_QUALITY_NO_STAGES:${qualityMode}:${index}`);

    results[qualityMode] = result;
    data[qualityMode].solved += 1;
    data[qualityMode].moves.push(result.moveCount);
    data[qualityMode].times.push(elapsed);
    if (result.qualityTargetReached) data[qualityMode].targetHits += 1;
    for (const stage of diagnostics.wasmStages) {
      data[qualityMode].stages[stage.name] = (data[qualityMode].stages[stage.name] || 0) + 1;
    }
  }

  if (results.extreme.moveCount > results.sweetSpot.moveCount) {
    throw new Error(
      `FMC_EXTREME_REGRESSION:${index}:${results.sweetSpot.moveCount}:${results.extreme.moveCount}:${scramble}`,
    );
  }
  if (results.extreme.moveCount < results.sweetSpot.moveCount || results.sweetSpot.moveCount > 24) {
    notable.push({
      index,
      scramble,
      sweetSpot: results.sweetSpot.moveCount,
      extreme: results.extreme.moveCount,
      sweetStages: results.sweetSpot.performanceDiagnostics.wasmStages.map((stage) => stage.name),
      extremeStages: results.extreme.performanceDiagnostics.wasmStages.map((stage) => stage.name),
    });
  }
  console.log(`progress ${index + 1}/${RUNS}`);
}

const summary = {
  runs: RUNS,
  sweetSpot: {
    solved: data.sweetSpot.solved,
    averageMoves: average(data.sweetSpot.moves),
    averageMs: average(data.sweetSpot.times),
    targetHits: data.sweetSpot.targetHits,
    stageRuns: data.sweetSpot.stages,
  },
  extreme: {
    solved: data.extreme.solved,
    averageMoves: average(data.extreme.moves),
    averageMs: average(data.extreme.times),
    targetHits: data.extreme.targetHits,
    stageRuns: data.extreme.stages,
  },
  extremeImprovements: data.extreme.moves.filter((moves, index) => moves < data.sweetSpot.moves[index]).length,
  notable,
};
console.log(JSON.stringify(summary, null, 2));

if (summary.sweetSpot.solved !== RUNS || summary.extreme.solved !== RUNS) {
  throw new Error("FMC_QUALITY_COVERAGE_REGRESSION");
}
if (summary.extreme.averageMoves > summary.sweetSpot.averageMoves) {
  throw new Error("FMC_QUALITY_AVERAGE_REGRESSION");
}
if (!summary.sweetSpot.stageRuns.baseline || !summary.extreme.stageRuns.baseline) {
  throw new Error("FMC_QUALITY_BASELINE_STAGE_MISSING");
}
