#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { getDefaultPattern } from "../solver/context.js";
import { solve3x3StrictCfopFromPattern } from "../solver/cfop3x3.js";
import { solveWithFMCSearch } from "../solver/fmcSolver.js";

const DEFAULT_SCRAMBLES = [
  "R U R' U' R' F R2 U' R' U' R U R' F'",
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
];

function parseArgs(argv) {
  const options = {
    solver: "both",
    repeat: 2,
    output: "",
    scrambles: [],
    fmcBudgetMs: 8000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--solver" && value) {
      options.solver = String(value).toLowerCase();
      i += 1;
    } else if (arg === "--repeat" && value) {
      options.repeat = Math.max(1, Number.parseInt(value, 10) || options.repeat);
      i += 1;
    } else if (arg === "--output" && value) {
      options.output = value;
      i += 1;
    } else if (arg === "--scramble" && value) {
      options.scrambles.push(value);
      i += 1;
    } else if (arg === "--fmc-budget-ms" && value) {
      options.fmcBudgetMs = Math.max(1000, Number.parseInt(value, 10) || options.fmcBudgetMs);
      i += 1;
    }
  }

  if (!options.scrambles.length) {
    options.scrambles = DEFAULT_SCRAMBLES.slice();
  }

  return options;
}

function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function percentile(values, rate) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rate) - 1));
  return sorted[index];
}

function summarizeCfopRuns(runs) {
  const durations = runs
    .map((run) => run.performanceDiagnostics?.totalElapsedMs)
    .filter((value) => Number.isFinite(value));
  const candidateScans = runs
    .map((run) => run.performanceDiagnostics?.f2l?.candidateScanCount)
    .filter((value) => Number.isFinite(value));
  const coldRuns = runs.filter((run) => run.performanceDiagnostics?.coldStart?.any === true).length;
  const compactFallbackRuns = runs.filter(
    (run) => run.performanceDiagnostics?.f2l?.compactFallbackUsed === true,
  ).length;
  return {
    runs: runs.length,
    okRuns: runs.filter((run) => run.ok).length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : null,
    avgCandidateScans: average(candidateScans),
    coldRuns,
    warmRuns: runs.length - coldRuns,
    compactFallbackRuns,
  };
}

function summarizeFmcRuns(runs) {
  const durations = runs
    .map((run) => run.performanceDiagnostics?.totalElapsedMs)
    .filter((value) => Number.isFinite(value));
  return {
    runs: runs.length,
    okRuns: runs.filter((run) => run.ok).length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : null,
  };
}

async function runCfop(scramble, solvedPattern) {
  const pattern = solvedPattern.applyAlg(scramble);
  const result = await solve3x3StrictCfopFromPattern(pattern, {
    mode: "strict",
    crossColor: "D",
  });
  return {
    solver: "cfop",
    scramble,
    ok: !!result?.ok,
    reason: result?.reason || null,
    moveCount: Number.isFinite(result?.moveCount) ? result.moveCount : null,
    performanceDiagnostics: result?.performanceDiagnostics || null,
    stageDiagnostics: result?.stageDiagnostics || [],
  };
}

async function runFmc(scramble, fmcBudgetMs) {
  const result = await solveWithFMCSearch(scramble, null, {
    timeBudgetMs: fmcBudgetMs,
    maxPremoveSets: 8,
    verifyLimit: 16,
  });
  return {
    solver: "fmc",
    scramble,
    ok: !!result?.ok,
    reason: result?.reason || null,
    moveCount: Number.isFinite(result?.moveCount) ? result.moveCount : null,
    performanceDiagnostics: result?.performanceDiagnostics || null,
    stages: result?.stages || [],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const solvedPattern = await getDefaultPattern("333");
  const report = {
    createdAt: new Date().toISOString(),
    options,
    runs: {
      cfop: [],
      fmc: [],
    },
    summary: {},
  };

  for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex += 1) {
    for (let i = 0; i < options.scrambles.length; i += 1) {
      const scramble = options.scrambles[i];
      if (options.solver === "cfop" || options.solver === "both") {
        report.runs.cfop.push({
          repeatIndex,
          ...(await runCfop(scramble, solvedPattern)),
        });
      }
      if (options.solver === "fmc" || options.solver === "both") {
        report.runs.fmc.push({
          repeatIndex,
          ...(await runFmc(scramble, options.fmcBudgetMs)),
        });
      }
    }
  }

  if (report.runs.cfop.length) {
    report.summary.cfop = summarizeCfopRuns(report.runs.cfop);
  }
  if (report.runs.fmc.length) {
    report.summary.fmc = summarizeFmcRuns(report.runs.fmc);
  }

  const outputText = JSON.stringify(report, null, 2);
  if (options.output) {
    const outputPath = path.resolve(options.output);
    await fs.writeFile(outputPath, outputText, "utf8");
    console.log(outputPath);
    return;
  }

  console.log(outputText);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
