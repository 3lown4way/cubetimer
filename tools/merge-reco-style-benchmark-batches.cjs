#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

function parseCsvList(value, fallback) {
  const parsed = String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback.slice();
}

function parseArgs(argv) {
  const opts = {
    inputs: [],
    output: "",
    mode: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }

    const [flag, inlineValue] = arg.split("=", 2);
    const value = inlineValue !== undefined ? inlineValue : argv[i + 1];
    const consumeNext = inlineValue === undefined;

    if (flag === "--input") {
      opts.inputs = [value || ""];
      if (consumeNext) i += 1;
    } else if (flag === "--inputs") {
      opts.inputs = parseCsvList(value, opts.inputs);
      if (consumeNext) i += 1;
    } else if (flag === "--output") {
      opts.output = value || opts.output;
      if (consumeNext) i += 1;
    } else if (flag === "--mode") {
      opts.mode = String(value || opts.mode || "").trim().toLowerCase();
      if (consumeNext) i += 1;
    }
  }

  return opts;
}

function printHelp() {
  console.log("Usage: node tools/merge-reco-style-benchmark-batches.cjs --inputs <csv> --output <path>");
  console.log("");
  console.log("Options:");
  console.log("  --input <path>       Single batch benchmark JSON");
  console.log("  --inputs <csv>       Multiple batch benchmark JSONs");
  console.log("  --output <path>      Merged benchmark JSON output");
  console.log("  --mode <strict|zb>   Expected benchmark mode");
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input not found: ${filePath}`);
  }
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { filePath, payload };
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function countBy(items) {
  const out = {};
  for (let i = 0; i < items.length; i++) {
    const key = String(items[i] || "").trim() || "UNKNOWN";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizeRuns(styleName, runs) {
  const solvedRuns = runs.filter((run) => run.ok);
  const durations = runs.map((run) => run.durationMs).filter((v) => Number.isFinite(v));
  const solvedMoves = solvedRuns.map((run) => run.moveCount).filter((v) => Number.isFinite(v));
  const solvedNodes = solvedRuns.map((run) => run.nodes).filter((v) => Number.isFinite(v));
  const solvedDistances = solvedRuns.map((run) => run.styleDistanceToTarget).filter((v) => Number.isFinite(v));

  return {
    style: styleName,
    attempted: runs.length,
    solved: solvedRuns.length,
    failed: runs.length - solvedRuns.length,
    successRate: runs.length > 0 ? solvedRuns.length / runs.length : 0,
    avgMoveCountSolved: average(solvedMoves),
    p50MoveCountSolved: percentile(solvedMoves, 0.5),
    p90MoveCountSolved: percentile(solvedMoves, 0.9),
    avgDurationMs: average(durations),
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    avgNodesSolved: average(solvedNodes),
    avgStyleDistanceToTarget: average(solvedDistances),
    p50StyleDistanceToTarget: percentile(solvedDistances, 0.5),
    failureReasonCounts: countBy(runs.filter((run) => !run.ok).map((run) => run.reason)),
    failureStageCounts: countBy(runs.filter((run) => !run.ok).map((run) => run.stage)),
  };
}

function summarizeModeComparisons(mode, summaries) {
  const baseline = summaries.find((entry) => entry.style === "legacy");
  if (!baseline) return [];
  const out = [];
  for (let i = 0; i < summaries.length; i++) {
    const entry = summaries[i];
    if (entry.style === "legacy") continue;
    const deltaP95Duration =
      Number.isFinite(entry.p95DurationMs) && Number.isFinite(baseline.p95DurationMs)
        ? entry.p95DurationMs - baseline.p95DurationMs
        : null;
    const deltaP95DurationRatio =
      Number.isFinite(deltaP95Duration) && Number.isFinite(baseline.p95DurationMs) && baseline.p95DurationMs > 0
        ? deltaP95Duration / baseline.p95DurationMs
        : null;
    const deltaStyleDistance =
      Number.isFinite(entry.avgStyleDistanceToTarget) && Number.isFinite(baseline.avgStyleDistanceToTarget)
        ? entry.avgStyleDistanceToTarget - baseline.avgStyleDistanceToTarget
        : null;
    const deltaStyleDistancePct =
      Number.isFinite(deltaStyleDistance) &&
      Number.isFinite(baseline.avgStyleDistanceToTarget) &&
      baseline.avgStyleDistanceToTarget > 0
        ? deltaStyleDistance / baseline.avgStyleDistanceToTarget
        : null;

    out.push({
      mode,
      style: entry.style,
      deltaSuccessRate: (entry.successRate ?? 0) - (baseline.successRate ?? 0),
      deltaAvgMoveCountSolved:
        Number.isFinite(entry.avgMoveCountSolved) && Number.isFinite(baseline.avgMoveCountSolved)
          ? entry.avgMoveCountSolved - baseline.avgMoveCountSolved
          : null,
      deltaAvgDurationMs:
        Number.isFinite(entry.avgDurationMs) && Number.isFinite(baseline.avgDurationMs)
          ? entry.avgDurationMs - baseline.avgDurationMs
          : null,
      deltaP95DurationMs: deltaP95Duration,
      deltaP95DurationRatio,
      deltaStyleDistanceToTarget: deltaStyleDistance,
      deltaStyleDistancePct,
    });
  }
  return out;
}

function evaluateBalancedGate(comparison) {
  const thresholds = {
    deltaSuccessRateMin: 0.01,
    deltaAvgMoveCountSolvedMax: -0.5,
    deltaP95DurationRatioMax: 0.1,
    deltaStyleDistancePctMax: -0.05,
  };
  const checks = {
    successRate: Number.isFinite(comparison.deltaSuccessRate)
      ? comparison.deltaSuccessRate >= thresholds.deltaSuccessRateMin
      : false,
    avgMoveCountSolved: Number.isFinite(comparison.deltaAvgMoveCountSolved)
      ? comparison.deltaAvgMoveCountSolved <= thresholds.deltaAvgMoveCountSolvedMax
      : false,
    p95DurationRatio: Number.isFinite(comparison.deltaP95DurationRatio)
      ? comparison.deltaP95DurationRatio <= thresholds.deltaP95DurationRatioMax
      : false,
    styleDistancePct: Number.isFinite(comparison.deltaStyleDistancePct)
      ? comparison.deltaStyleDistancePct <= thresholds.deltaStyleDistancePctMax
      : false,
  };
  return {
    mode: comparison.mode,
    style: comparison.style,
    pass: checks.successRate && checks.avgMoveCountSolved && checks.p95DurationRatio && checks.styleDistancePct,
    checks,
    thresholds,
  };
}

function inferMode(payload, explicitMode) {
  if (explicitMode) return explicitMode;
  const modes = Array.isArray(payload?.parameters?.modes) ? payload.parameters.modes : [];
  if (modes.length) return String(modes[0] || "").trim().toLowerCase();
  const keys = payload?.runsByMode && typeof payload.runsByMode === "object" ? Object.keys(payload.runsByMode) : [];
  return String(keys[0] || "").trim().toLowerCase();
}

function mergeBatches(payloads, mode, files) {
  const base = payloads[0];
  const styles = Array.isArray(base?.parameters?.styles) && base.parameters.styles.length
    ? base.parameters.styles.slice()
    : Object.keys(base?.runsByMode?.[mode] || {});
  if (!styles.length) {
    throw new Error("No styles found in batch payloads.");
  }

  const mergedRunsByStyle = {};
  for (let i = 0; i < styles.length; i++) {
    mergedRunsByStyle[styles[i]] = [];
  }

  let sampleCursor = 0;
  const batchInputs = [];
  let maxBatchLimit = 0;
  let totalSampleCount = 0;

  for (let p = 0; p < payloads.length; p++) {
    const payload = payloads[p];
    const batchOffset = Number(payload?.parameters?.offset || 0);
    const batchLimit = Number(payload?.parameters?.limit || payload?.sampleCount || 0);
    const batchSampleCount = Number(payload?.sampleCount || 0) || batchLimit || 0;
    const runsByStyle = payload?.runsByMode?.[mode] || {};
    const inputFile = files[p] || "";
    const batchLabel = path.basename(inputFile || `batch-${p + 1}.json`);

    if (batchLimit > maxBatchLimit) maxBatchLimit = batchLimit;
    totalSampleCount += batchSampleCount;
    batchInputs.push({
      file: inputFile,
      offset: batchOffset,
      limit: batchLimit,
      sampleCount: batchSampleCount,
      label: batchLabel,
    });

    for (let s = 0; s < styles.length; s++) {
      const style = styles[s];
      const runs = Array.isArray(runsByStyle[style]) ? runsByStyle[style] : [];
      const merged = mergedRunsByStyle[style];
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        merged.push({
          ...run,
          sampleIndex: sampleCursor + i + 1,
          batchIndex: p + 1,
          batchOffset,
          batchLimit,
          batchFile: batchLabel,
        });
      }
    }

    sampleCursor += batchSampleCount;
  }

  const runsForCoverage = mergedRunsByStyle[styles[0]] || [];
  const bySolver = new Map();
  const byMethod = new Map();
  for (let i = 0; i < runsForCoverage.length; i++) {
    const run = runsForCoverage[i];
    const solver = String(run?.sourceSolver || "").trim();
    const method = String(run?.sourceMethod || "").trim().toUpperCase() || "UNKNOWN";
    if (solver) {
      bySolver.set(solver, (bySolver.get(solver) || 0) + 1);
    }
    byMethod.set(method, (byMethod.get(method) || 0) + 1);
  }
  const solverRows = Array.from(bySolver.entries())
    .map(([solver, samples]) => ({ solver, samples }))
    .sort((a, b) => b.samples - a.samples || a.solver.localeCompare(b.solver));
  const samplesPerSolver =
    solverRows.length > 0 && solverRows.every((row) => row.samples === solverRows[0].samples)
      ? solverRows[0].samples
      : null;

  const summaries = styles.map((style) => summarizeRuns(style, mergedRunsByStyle[style] || []));
  const comparisons = summarizeModeComparisons(mode, summaries);
  const gateEvaluation = comparisons.map(evaluateBalancedGate);

  const parameters = {
    ...(base.parameters || {}),
    offset: 0,
    limit: totalSampleCount,
    modes: [mode],
    batchSize: maxBatchLimit,
    batchCount: payloads.length,
    batchMode: true,
    batchInputs,
    samplingPolicy: "batched-offset-limit",
  };

  return {
    generatedAt: new Date().toISOString(),
    sourceInput: base.sourceInput || null,
    sourceStyleProfileInput: base.sourceStyleProfileInput || null,
    parameters,
    sampleCount: totalSampleCount,
    samplesPerSolver,
    solverCoverage: {
      count: solverRows.length,
      solvers: solverRows,
    },
    methodCoverage: Object.fromEntries(byMethod.entries()),
    distanceConfig: base.distanceConfig || null,
    gateThresholds: base.gateThresholds || null,
    summariesByMode: {
      [mode]: summaries,
    },
    comparisonVsLegacyByMode: {
      [mode]: comparisons,
    },
    gateEvaluationByMode: {
      [mode]: gateEvaluation,
    },
    runsByMode: {
      [mode]: mergedRunsByStyle,
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!opts.inputs.length) {
    throw new Error("No inputs provided.");
  }
  if (!opts.output) {
    throw new Error("No output provided.");
  }

  const loaded = opts.inputs.map(loadJson);
  const payloads = loaded.map((entry) => entry.payload);
  const files = loaded.map((entry) => entry.filePath);
  const mode = inferMode(payloads[0], opts.mode);
  if (!mode) {
    throw new Error("Unable to infer benchmark mode.");
  }

  for (let i = 0; i < payloads.length; i++) {
    const payloadMode = inferMode(payloads[i], "");
    if (payloadMode !== mode) {
      throw new Error(`Mixed benchmark modes are not supported: expected ${mode}, got ${payloadMode} from ${files[i]}`);
    }
  }

  const sorted = payloads
    .map((payload, index) => ({ payload, filePath: files[index], offset: Number(payload?.parameters?.offset || 0) }))
    .sort((a, b) => a.offset - b.offset || a.filePath.localeCompare(b.filePath));

  const merged = mergeBatches(
    sorted.map((entry) => entry.payload),
    mode,
    sorted.map((entry) => entry.filePath),
  );

  fs.mkdirSync(path.dirname(opts.output), { recursive: true });
  fs.writeFileSync(opts.output, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log(`Wrote ${opts.output}`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
