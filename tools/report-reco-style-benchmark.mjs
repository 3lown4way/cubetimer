#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  MIXED_ACTIVATION_THRESHOLD,
  estimateMixedActivationScore,
  normalizeCaseBiasRecord,
  normalizeMixedCfopSummaryRecord,
  resolvePlayerRecommendedF2LMethod,
} from "../solver/mixed-cfop-activation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const DEFAULT_CURRENT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark.json");
const DEFAULT_BASELINE = path.join(ROOT_DIR, "vendor-data", "reco", "reco-all-3x3-top10-style-benchmark.json");
const DEFAULT_MIXED = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-mixed-cfop-profile.json");
const DEFAULT_JSON_OUTPUT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark-report.json");
const DEFAULT_MD_OUTPUT = path.join(ROOT_DIR, "vendor-data", "reco", "reco-3x3-style-benchmark-report.md");

function parseArgs(argv) {
  const opts = {
    current: DEFAULT_CURRENT,
    baseline: DEFAULT_BASELINE,
    mixed: DEFAULT_MIXED,
    jsonOutput: DEFAULT_JSON_OUTPUT,
    mdOutput: DEFAULT_MD_OUTPUT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }

    const [flag, inline] = arg.split("=", 2);
    const value = inline !== undefined ? inline : argv[i + 1];
    const consumeNext = inline === undefined;

    if (flag === "--current") {
      opts.current = value || opts.current;
      if (consumeNext) i += 1;
    } else if (flag === "--baseline") {
      opts.baseline = value || opts.baseline;
      if (consumeNext) i += 1;
    } else if (flag === "--mixed") {
      opts.mixed = value || opts.mixed;
      if (consumeNext) i += 1;
    } else if (flag === "--json-output") {
      opts.jsonOutput = value || opts.jsonOutput;
      if (consumeNext) i += 1;
    } else if (flag === "--md-output") {
      opts.mdOutput = value || opts.mdOutput;
      if (consumeNext) i += 1;
    }
  }

  return opts;
}

function printHelp() {
  console.log("Usage: node tools/report-reco-style-benchmark.mjs [options]");
  console.log("");
  console.log("Options:");
  console.log("  --current <path>      Current merged benchmark JSON");
  console.log("  --baseline <path>     Baseline benchmark JSON");
  console.log("  --mixed <path>        Mixed CFOP profile JSON");
  console.log("  --json-output <path>  JSON report output");
  console.log("  --md-output <path>    Markdown report output");
}

function loadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

function flattenRunsByMode(doc, mode) {
  const byStyle = doc?.runsByMode?.[mode];
  if (!byStyle || typeof byStyle !== "object") return [];
  const out = [];
  for (const runs of Object.values(byStyle)) {
    if (!Array.isArray(runs)) continue;
    for (const run of runs) out.push(run);
  }
  return out;
}

function summarizeRuns(runs) {
  const attempted = runs.length;
  const solved = runs.filter((run) => run && run.ok);
  const durations = runs.map((run) => Number(run?.durationMs)).filter((value) => Number.isFinite(value));
  const solvedMoves = solved.map((run) => Number(run?.moveCount)).filter((value) => Number.isFinite(value));
  const solvedNodes = solved.map((run) => Number(run?.nodes)).filter((value) => Number.isFinite(value));
  const solvedDistances = solved
    .map((run) => Number(run?.styleDistanceToTarget))
    .filter((value) => Number.isFinite(value));

  return {
    attempted,
    solved: solved.length,
    failed: attempted - solved.length,
    successRate: attempted > 0 ? solved.length / attempted : 0,
    avgMoveCountSolved: average(solvedMoves),
    p50MoveCountSolved: percentile(solvedMoves, 0.5),
    p90MoveCountSolved: percentile(solvedMoves, 0.9),
    avgDurationMs: average(durations),
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    avgNodesSolved: average(solvedNodes),
    avgStyleDistanceToTarget: average(solvedDistances),
    p50StyleDistanceToTarget: percentile(solvedDistances, 0.5),
  };
}

function compareMetric(currentValue, baselineValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue)) return null;
  return currentValue - baselineValue;
}

function compareStyleSummaries(current, baseline) {
  if (!current || !baseline) return null;
  const deltaStyleDistance =
    compareMetric(current.avgStyleDistanceToTarget, baseline.avgStyleDistanceToTarget);
  const deltaP95DurationMs = compareMetric(current.p95DurationMs, baseline.p95DurationMs);
  return {
    deltaSuccessRate: compareMetric(current.successRate, baseline.successRate),
    deltaAvgMoveCountSolved: compareMetric(current.avgMoveCountSolved, baseline.avgMoveCountSolved),
    deltaAvgDurationMs: compareMetric(current.avgDurationMs, baseline.avgDurationMs),
    deltaP95DurationMs,
    deltaP95DurationRatio:
      Number.isFinite(deltaP95DurationMs) && Number.isFinite(baseline.p95DurationMs) && baseline.p95DurationMs > 0
        ? deltaP95DurationMs / baseline.p95DurationMs
        : null,
    deltaStyleDistanceToTarget: deltaStyleDistance,
    deltaStyleDistancePct:
      Number.isFinite(deltaStyleDistance) &&
      Number.isFinite(baseline.avgStyleDistanceToTarget) &&
      baseline.avgStyleDistanceToTarget > 0
        ? deltaStyleDistance / baseline.avgStyleDistanceToTarget
        : null,
  };
}

function compareOverall(current, baseline) {
  if (!current || !baseline) return null;
  return {
    deltaSuccessRate: compareMetric(current.successRate, baseline.successRate),
    deltaAvgMoveCountSolved: compareMetric(current.avgMoveCountSolved, baseline.avgMoveCountSolved),
    deltaAvgDurationMs: compareMetric(current.avgDurationMs, baseline.avgDurationMs),
    deltaP95DurationMs: compareMetric(current.p95DurationMs, baseline.p95DurationMs),
    deltaStyleDistanceToTarget: compareMetric(
      current.avgStyleDistanceToTarget,
      baseline.avgStyleDistanceToTarget,
    ),
  };
}

function buildModeComparison(currentDoc, baselineDoc, mode) {
  const currentRuns = flattenRunsByMode(currentDoc, mode);
  const baselineRuns = flattenRunsByMode(baselineDoc, mode);
  const currentSummaries = Array.isArray(currentDoc?.summariesByMode?.[mode])
    ? currentDoc.summariesByMode[mode]
    : [];
  const baselineSummaries = Array.isArray(baselineDoc?.summariesByMode?.[mode])
    ? baselineDoc.summariesByMode[mode]
    : [];
  const baselineByStyle = new Map(baselineSummaries.map((entry) => [entry.style, entry]));
  const currentOverall = summarizeRuns(currentRuns);
  const baselineOverall = baselineRuns.length ? summarizeRuns(baselineRuns) : null;

  return {
    mode,
    currentOverall,
    baselineOverall,
    overallDelta: baselineOverall ? compareOverall(currentOverall, baselineOverall) : null,
    styles: currentSummaries.map((entry) => {
      const baseline = baselineByStyle.get(entry.style) || null;
      return {
        style: entry.style,
        current: entry,
        baseline,
        delta: baseline ? compareStyleSummaries(entry, baseline) : null,
      };
    }),
  };
}

function buildMixedActivationReport(mixedDoc) {
  const players = Array.isArray(mixedDoc?.playerMixedCfopProfiles)
    ? mixedDoc.playerMixedCfopProfiles
    : Array.isArray(mixedDoc?.players)
      ? mixedDoc.players
      : [];

  const rows = players
    .map((player) => {
      const mixedProfile =
        player?.mixedCfopStyleProfile ||
        player?.mixedStyleProfile ||
        player?.learnedStyleProfile ||
        player?.recommendedStyleProfile ||
        null;
      const mixedSummary = normalizeMixedCfopSummaryRecord(
        player?.mixedCfopSummary || player?.mixedCfopStats || player?.summary,
      );
      const caseBias = normalizeCaseBiasRecord(player?.caseBias);
      const activationScore = estimateMixedActivationScore(player, mixedProfile, mixedSummary, caseBias);
      const mixedEligible = activationScore >= MIXED_ACTIVATION_THRESHOLD;
      const recommendedF2LMethod = resolvePlayerRecommendedF2LMethod({
        ...player,
        mixedEligible,
        mixedCfopStyleProfile: mixedProfile,
        mixedCfopSummary: mixedSummary,
        caseBias,
      });
      return {
        solver: String(player?.solver || "").trim(),
        activationScore,
        mixedEligible,
        recommendedF2LMethod,
        primaryMethodGroup: String(player?.primaryMethodGroup || "").trim() || "CFOP",
        solveCount: Number(player?.solveCount || 0),
        caseBias,
        mixedCfopSummary: mixedSummary,
      };
    })
    .filter((row) => row.solver)
    .sort((a, b) => b.activationScore - a.activationScore || a.solver.localeCompare(b.solver));

  const selectedPlayers = rows.filter((row) => row.recommendedF2LMethod === "mixed");
  return {
    threshold: MIXED_ACTIVATION_THRESHOLD,
    playerCount: rows.length,
    selectedCount: selectedPlayers.length,
    selectedPlayers,
    rows,
  };
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "n/a";
}

function formatDelta(value, digits = 3, suffix = "") {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(digits)}${suffix}`;
}

function markdownTable(headers, rows) {
  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }
  return lines.join("\n");
}

function buildMarkdown(report) {
  const lines = [];
  lines.push("# 3x3 Style Benchmark Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Baseline: \`${report.baselineBenchmark.source}\``);
  lines.push(`Current: \`${report.currentBenchmark.source}\``);
  lines.push("");

  const strict = report.comparisons.strict;
  if (strict?.overallDelta) {
    lines.push("## Strict Overall");
    lines.push("");
    lines.push(
      markdownTable(
        ["Metric", "Current", "Baseline", "Delta"],
        [
          [
            "Success rate",
            formatNumber(strict.currentOverall.successRate, 3),
            formatNumber(strict.baselineOverall.successRate, 3),
            formatDelta(strict.overallDelta.deltaSuccessRate, 3),
          ],
          [
            "P95 duration",
            formatNumber(strict.currentOverall.p95DurationMs, 0),
            formatNumber(strict.baselineOverall.p95DurationMs, 0),
            formatDelta(strict.overallDelta.deltaP95DurationMs, 0, " ms"),
          ],
          [
            "Style distance",
            formatNumber(strict.currentOverall.avgStyleDistanceToTarget, 2),
            formatNumber(strict.baselineOverall.avgStyleDistanceToTarget, 2),
            formatDelta(strict.overallDelta.deltaStyleDistanceToTarget, 2),
          ],
        ],
      ),
    );
    lines.push("");
  }

  const strictStyles = Array.isArray(strict?.styles) ? strict.styles : [];
  if (strictStyles.length) {
    lines.push("## Strict By Style");
    lines.push("");
    lines.push(
      markdownTable(
        ["Style", "Success Δ", "P95 Δ", "Style Dist Δ"],
        strictStyles.map((entry) => [
          entry.style,
          formatDelta(entry.delta?.deltaSuccessRate, 3),
          formatDelta(entry.delta?.deltaP95DurationMs, 0, " ms"),
          formatDelta(entry.delta?.deltaStyleDistanceToTarget, 2),
        ]),
      ),
    );
    lines.push("");
  }

  lines.push("## ZB Overall");
  lines.push("");
  lines.push(
    markdownTable(
      ["Metric", "Current"],
      [
        ["Success rate", formatNumber(report.comparisons.zb.currentOverall.successRate, 3)],
        ["P95 duration", formatNumber(report.comparisons.zb.currentOverall.p95DurationMs, 0)],
        ["Style distance", formatNumber(report.comparisons.zb.currentOverall.avgStyleDistanceToTarget, 2)],
      ],
    ),
  );
  lines.push("");

  lines.push("## Mixed Activation");
  lines.push("");
  lines.push(
    `Threshold: ${report.mixedActivation.threshold}. Selected ${report.mixedActivation.selectedCount}/${report.mixedActivation.playerCount} players.`,
  );
  lines.push("");
  lines.push(
    markdownTable(
      ["Player", "Score", "Recommended", "XC", "XXC", "ZBLL", "ZBLS"],
      report.mixedActivation.selectedPlayers.map((player) => [
        player.solver,
        formatNumber(player.activationScore, 3),
        player.recommendedF2LMethod,
        String(player.caseBias?.xcrossWeight ?? "-"),
        String(player.caseBias?.xxcrossWeight ?? "-"),
        String(player.caseBias?.zbllWeight ?? "-"),
        String(player.caseBias?.zblsWeight ?? "-"),
      ]),
    ),
  );

  return `${lines.join("\n").trim()}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const current = loadJson(path.resolve(ROOT_DIR, opts.current));
  const baseline = loadJson(path.resolve(ROOT_DIR, opts.baseline));
  const mixed = loadJson(path.resolve(ROOT_DIR, opts.mixed));

  const report = {
    generatedAt: new Date().toISOString(),
    currentBenchmark: {
      source: path.resolve(ROOT_DIR, opts.current),
      sampleCount: Number(current.sampleCount || 0),
      parameters: current.parameters || {},
    },
    baselineBenchmark: {
      source: path.resolve(ROOT_DIR, opts.baseline),
      sampleCount: Number(baseline.sampleCount || 0),
      parameters: baseline.parameters || {},
    },
    comparisons: {
      strict: buildModeComparison(current, baseline, "strict"),
      zb: buildModeComparison(current, baseline, "zb"),
    },
    mixedActivation: buildMixedActivationReport(mixed),
  };

  fs.mkdirSync(path.dirname(path.resolve(ROOT_DIR, opts.jsonOutput)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT_DIR, opts.jsonOutput), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(path.resolve(ROOT_DIR, opts.mdOutput)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT_DIR, opts.mdOutput), buildMarkdown(report), "utf8");

  console.log(`Wrote ${opts.jsonOutput}`);
  console.log(`Wrote ${opts.mdOutput}`);
  console.log(
    `Strict overall delta: success ${formatDelta(report.comparisons.strict.overallDelta?.deltaSuccessRate, 3)}, p95 ${formatDelta(report.comparisons.strict.overallDelta?.deltaP95DurationMs, 0, " ms")}, style ${formatDelta(report.comparisons.strict.overallDelta?.deltaStyleDistanceToTarget, 2)}`,
  );
  console.log(
    `Mixed activation: ${report.mixedActivation.selectedCount}/${report.mixedActivation.playerCount} players at threshold ${MIXED_ACTIVATION_THRESHOLD}`,
  );
}

main();
