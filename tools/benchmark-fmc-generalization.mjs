import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.join(__dirname, "fmc-generalization-corpus.json");
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8"));

const outputArg = process.argv.indexOf("--out");
const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : "";
const baselineArg = process.argv.indexOf("--baseline");
const baselinePath = baselineArg >= 0 ? process.argv[baselineArg + 1] : "";
const debugRows = process.argv.includes("--debug-rows");
const smoke = process.argv.includes("--smoke");

const fixedCountOverride = Number.parseInt(process.env.FMC_GENERALIZATION_FIXED_COUNT || "", 10);
const compressionCountOverride = Number.parseInt(
  process.env.FMC_GENERALIZATION_COMPRESSION_COUNT || "",
  10,
);

const profiles = Object.freeze({
  scout: Object.freeze({
    maxPremoveSets: 90,
    searchLevel: 1,
    searchVariant: 0,
    incumbentMoveCount: 28,
    forceRzp: false,
    enableCoverageFallback: true,
    enableMultiSwitchNiss: true,
    enableDeepMultiSwitchNiss: false,
    enableHtrSkeletons: false,
    enableSliceInsertion: false,
    enableMultiInsertion: false,
  }),
  compression: Object.freeze({
    maxPremoveSets: 24,
    searchLevel: 3,
    searchVariant: 7,
    incumbentMoveCount: 34,
    forceRzp: false,
    enableCoverageFallback: true,
    enableMultiSwitchNiss: true,
    enableDeepMultiSwitchNiss: true,
    enableHtrSkeletons: true,
    enableSliceInsertion: true,
    enableMultiInsertion: true,
  }),
});

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

const faces = ["U", "D", "R", "L", "F", "B"];
const suffixes = ["", "'", "2"];
const axes = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

function generateDeterministicScrambles(spec, countOverride) {
  const count = Number.isFinite(countOverride) && countOverride > 0
    ? countOverride
    : Number(spec.count || 0);
  const length = Number(spec.scrambleLength || 21);
  const randomUnit = createRng(Number(spec.seed || 1));
  const scrambles = [];

  for (let run = 0; run < count; run += 1) {
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
    scrambles.push(moves.join(" "));
  }
  return scrambles;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function distribution(values) {
  const output = {};
  for (const value of values) {
    const key = String(value);
    output[key] = (output[key] || 0) + 1;
  }
  return output;
}

async function verifyKnownDevelopmentCases() {
  const rows = [];
  for (const testCase of corpus.developmentCases || []) {
    const verification = await verifyFmcSolutionWasm(testCase.scramble, testCase.knownSolution);
    if (!verification?.ok || verification.solved !== true) {
      throw new Error(`KNOWN_SOLUTION_INVALID:${testCase.id}`);
    }
    rows.push({
      id: testCase.id,
      knownMoveCount: testCase.knownMoveCount,
      diagnosticTags: testCase.diagnosticTags || [],
      verified: true,
    });
  }
  return rows;
}

async function runOne(scramble, profileName) {
  const profile = profiles[profileName];
  const startedAt = performance.now();
  const result = await solveFmcWasm(scramble, profile);
  const elapsedMs = performance.now() - startedAt;
  if (!result?.ok || !result.solution || !Number.isFinite(result.moveCount)) {
    return {
      ok: false,
      moveCount: null,
      elapsedMs,
      source: result?.source || "",
      reason: result?.reason || "SOLVE_FAILED",
    };
  }
  const verification = await verifyFmcSolutionWasm(scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`GENERATED_SOLUTION_INVALID:${profileName}:${scramble}`);
  }
  return {
    ok: true,
    moveCount: Number(result.moveCount),
    elapsedMs,
    source: String(result.source || ""),
    reason: null,
  };
}

async function runSet(scrambles, profileName) {
  const rows = [];
  for (let index = 0; index < scrambles.length; index += 1) {
    const row = await runOne(scrambles[index], profileName);
    rows.push({ index, ...row, ...(debugRows ? { scramble: scrambles[index] } : {}) });
  }
  const solved = rows.filter((row) => row.ok);
  const moveCounts = solved.map((row) => row.moveCount);
  const times = rows.map((row) => row.elapsedMs);
  return {
    profile: profileName,
    count: rows.length,
    solved: solved.length,
    solvedRate: rows.length ? solved.length / rows.length : 0,
    averageMoves: average(moveCounts),
    medianMoves: percentile(moveCounts, 0.5),
    p90Moves: percentile(moveCounts, 0.9),
    bestMoves: moveCounts.length ? Math.min(...moveCounts) : null,
    worstMoves: moveCounts.length ? Math.max(...moveCounts) : null,
    moveDistribution: distribution(moveCounts),
    averageMs: average(times),
    medianMs: percentile(times, 0.5),
    p90Ms: percentile(times, 0.9),
    ...(debugRows ? { rows } : {}),
  };
}

function compareMetric(current, baseline, key) {
  const a = Number(current?.[key]);
  const b = Number(baseline?.[key]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

function buildComparison(current, baseline) {
  if (!baseline) return null;
  const fixedBaseline = baseline.fixedHoldout;
  const compressionBaseline = baseline.compressionHoldout;
  return {
    fixedHoldout: {
      averageMovesDelta: compareMetric(current.fixedHoldout, fixedBaseline, "averageMoves"),
      p90MovesDelta: compareMetric(current.fixedHoldout, fixedBaseline, "p90Moves"),
      averageMsRatio:
        Number.isFinite(current.fixedHoldout?.averageMs) && Number.isFinite(fixedBaseline?.averageMs)
          ? current.fixedHoldout.averageMs / Math.max(1, fixedBaseline.averageMs)
          : null,
      solvedRateDelta: compareMetric(current.fixedHoldout, fixedBaseline, "solvedRate"),
    },
    compressionHoldout: {
      averageMovesDelta: compareMetric(
        current.compressionHoldout,
        compressionBaseline,
        "averageMoves",
      ),
      p90MovesDelta: compareMetric(current.compressionHoldout, compressionBaseline, "p90Moves"),
      averageMsRatio:
        Number.isFinite(current.compressionHoldout?.averageMs) &&
        Number.isFinite(compressionBaseline?.averageMs)
          ? current.compressionHoldout.averageMs / Math.max(1, compressionBaseline.averageMs)
          : null,
      solvedRateDelta: compareMetric(
        current.compressionHoldout,
        compressionBaseline,
        "solvedRate",
      ),
    },
  };
}

function evaluateGate(result, comparison) {
  const structural =
    result.fixedHoldout.solvedRate === 1 && result.compressionHoldout.solvedRate === 1;
  if (!comparison) {
    return {
      passed: structural,
      reason: structural ? "BASELINE_CAPTURE" : "SOLVE_REGRESSION",
    };
  }

  const fixed = comparison.fixedHoldout;
  const compression = comparison.compressionHoldout;
  const qualityNonRegression =
    (fixed.averageMovesDelta ?? Infinity) <= 0.15 &&
    (compression.averageMovesDelta ?? Infinity) <= 0.25 &&
    (fixed.p90MovesDelta ?? Infinity) <= 1 &&
    (compression.p90MovesDelta ?? Infinity) <= 1;
  const runtimeBounded =
    (fixed.averageMsRatio ?? Infinity) <= 1.35 &&
    (compression.averageMsRatio ?? Infinity) <= 1.5;
  const solvedNonRegression =
    (fixed.solvedRateDelta ?? -Infinity) >= 0 &&
    (compression.solvedRateDelta ?? -Infinity) >= 0;

  return {
    passed: structural && qualityNonRegression && runtimeBounded && solvedNonRegression,
    structural,
    qualityNonRegression,
    runtimeBounded,
    solvedNonRegression,
  };
}

const readyStartedAt = performance.now();
const ready = await buildFmcTablesWasm();
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");
const tableBuildMs = performance.now() - readyStartedAt;

const developmentVerification = await verifyKnownDevelopmentCases();
const fixedScrambles = generateDeterministicScrambles(
  corpus.fixedHoldout,
  smoke ? 3 : fixedCountOverride,
);
const compressionScrambles = generateDeterministicScrambles(
  corpus.compressionHoldout,
  smoke ? 1 : compressionCountOverride,
);

const fixedHoldout = await runSet(fixedScrambles, "scout");
const compressionHoldout = await runSet(compressionScrambles, "compression");
const result = {
  schemaVersion: 1,
  corpusSchemaVersion: corpus.schemaVersion,
  tableBuildMs,
  policy: corpus.policy,
  developmentVerification,
  fixedHoldout,
  compressionHoldout,
};

const baseline = baselinePath ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
result.comparison = buildComparison(result, baseline);
result.gate = evaluateGate(result, result.comparison);

if (outputPath) {
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

console.log(
  JSON.stringify({
    tableBuildMs: Math.round(tableBuildMs),
    developmentCasesVerified: developmentVerification.length,
    fixedHoldout: {
      count: fixedHoldout.count,
      solvedRate: fixedHoldout.solvedRate,
      averageMoves: fixedHoldout.averageMoves,
      p90Moves: fixedHoldout.p90Moves,
      averageMs: Math.round(fixedHoldout.averageMs),
    },
    compressionHoldout: {
      count: compressionHoldout.count,
      solvedRate: compressionHoldout.solvedRate,
      averageMoves: compressionHoldout.averageMoves,
      p90Moves: compressionHoldout.p90Moves,
      averageMs: Math.round(compressionHoldout.averageMs),
    },
    comparison: result.comparison,
    gate: result.gate,
  }),
);

if (!result.gate.passed) process.exitCode = 1;
