import fs from "node:fs";
import { randomScrambleForEvent } from "../vendor/cubing/scramble/index.js";
import { getDefaultPattern } from "../solver/context.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "../solver/cfop3x3.js";

const N = Math.max(1, Number(process.env.CN_BENCH_N) || 1000);
const COLORS = ["D", "U", "F", "B", "R", "L"];
const LABELS = {
  D: "Yellow",
  U: "White",
  F: "Green",
  B: "Blue",
  R: "Red",
  L: "Orange",
};
const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
const candidateOk = Object.fromEntries(COLORS.map((color) => [color, 0]));
const candidateSeen = Object.fromEntries(COLORS.map((color) => [color, 0]));
const failures = [];
const malformedDiagnostics = [];
const selectedSamples = [];

const solved = await getDefaultPattern("333");
await prewarm3x3StrictCfopLibraries({ includeF2L: true, includeSingleStage: true });

const startedAt = Date.now();
for (let i = 0; i < N; i += 1) {
  const scramble = String(await randomScrambleForEvent("333"));
  const pattern = solved.applyAlg(scramble);
  let result;
  try {
    result = await solve3x3StrictCfopFromPattern(pattern, {
      crossColor: "CN",
      mode: "strict",
      solverVersion: "v2",
      scramble,
      deadlineTs: Date.now() + 20_000,
      enableStyleFallback: false,
      allowRelaxedSearch: false,
    });
  } catch (error) {
    failures.push({ index: i, scramble, reason: String(error?.message || error) });
    continue;
  }

  if (!result?.ok) {
    failures.push({ index: i, scramble, reason: result?.reason || "FAILED" });
    continue;
  }

  const selected = String(result.selectedCrossColor || "");
  if (COLORS.includes(selected)) {
    counts[selected] += 1;
    if (selectedSamples.length < 24) {
      selectedSamples.push({ index: i, selected, label: LABELS[selected], scramble });
    }
  } else {
    malformedDiagnostics.push({ index: i, selected, scramble, reason: "invalid selectedCrossColor" });
  }

  const diagnostics = Array.isArray(result.colorNeutralCandidates)
    ? result.colorNeutralCandidates
    : [];
  const diagnosticColors = diagnostics.map((entry) => String(entry?.color || ""));
  if (diagnosticColors.length !== 6 || COLORS.some((color) => !diagnosticColors.includes(color))) {
    malformedDiagnostics.push({ index: i, selected, diagnosticColors, scramble });
  }
  for (const entry of diagnostics) {
    const color = String(entry?.color || "");
    if (!COLORS.includes(color)) continue;
    candidateSeen[color] += 1;
    if (entry?.ok === true) candidateOk[color] += 1;
  }

  if ((i + 1) % 100 === 0) {
    console.log(`PROGRESS ${i + 1}/${N} counts=${JSON.stringify(counts)} failures=${failures.length}`);
  }
}

const successes = Object.values(counts).reduce((sum, value) => sum + value, 0);
const percentages = Object.fromEntries(
  COLORS.map((color) => [color, successes ? Number((counts[color] * 100 / successes).toFixed(2)) : 0]),
);
const labelCounts = Object.fromEntries(COLORS.map((color) => [LABELS[color], counts[color]]));
const labelPercentages = Object.fromEntries(COLORS.map((color) => [LABELS[color], percentages[color]]));
const oppositePairs = {
  yellowWhite: counts.D + counts.U,
  greenBlue: counts.F + counts.B,
  redOrange: counts.R + counts.L,
};
const representativeSide = counts.D + counts.F + counts.R;
const oppositeSide = counts.U + counts.B + counts.L;
const summary = {
  requested: N,
  successes,
  failureCount: failures.length,
  malformedDiagnosticCount: malformedDiagnostics.length,
  elapsedMs: Date.now() - startedAt,
  counts,
  percentages,
  labelCounts,
  labelPercentages,
  oppositePairs,
  representativeSide,
  oppositeSide,
  representativeSidePct: successes ? Number((representativeSide * 100 / successes).toFixed(2)) : 0,
  oppositeSidePct: successes ? Number((oppositeSide * 100 / successes).toFixed(2)) : 0,
  candidateSeen,
  candidateOk,
  failures: failures.slice(0, 20),
  malformedDiagnostics: malformedDiagnostics.slice(0, 20),
  selectedSamples,
};

fs.writeFileSync("tools/cn-distribution-result-temp.json", `${JSON.stringify(summary, null, 2)}\n`);
console.log("CN_DISTRIBUTION_RESULT " + JSON.stringify(summary, null, 2));

if (successes < Math.floor(N * 0.95)) process.exitCode = 2;
