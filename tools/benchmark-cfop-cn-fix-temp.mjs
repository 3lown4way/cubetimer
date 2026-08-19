import fs from "node:fs";
import { randomScrambleForEvent } from "../vendor/cubing/scramble/index.js";
import { getDefaultPattern } from "../solver/context.js";
import { prewarm3x3StrictCfopLibraries, solve3x3StrictCfopFromPattern } from "../solver/cfop3x3.js";

const N = 1000;
const COLORS = ["D", "U", "F", "B", "R", "L"];
const LABELS = { D: "Yellow", U: "White", F: "Green", B: "Blue", R: "Red", L: "Orange" };
const counts = Object.fromEntries(COLORS.map((c) => [c, 0]));
const failures = [];
const candidateSeen = Object.fromEntries(COLORS.map((c) => [c, 0]));
const candidateOk = Object.fromEntries(COLORS.map((c) => [c, 0]));
let firstCandidates = null;

const solved = await getDefaultPattern("333");
await prewarm3x3StrictCfopLibraries({ includeF2L: true, includeSingleStage: true });

for (let i = 0; i < N; i += 1) {
  const scramble = String(await randomScrambleForEvent("333"));
  const pattern = solved.applyAlg(scramble);
  try {
    const result = await solve3x3StrictCfopFromPattern(pattern, {
      crossColor: "CN",
      mode: "strict",
      solverVersion: "v2",
      scramble,
      deadlineTs: Date.now() + 20000,
      enableStyleFallback: false,
      allowRelaxedSearch: false,
    });
    if (!result?.ok) {
      failures.push({ index: i, reason: result?.reason || "FAILED", scramble });
      continue;
    }
    const selected = String(result.selectedCrossColor || "");
    if (COLORS.includes(selected)) counts[selected] += 1;
    else failures.push({ index: i, reason: `INVALID_COLOR:${selected}`, scramble });
    const diagnostics = Array.isArray(result.colorNeutralCandidates) ? result.colorNeutralCandidates : [];
    if (!firstCandidates) firstCandidates = diagnostics;
    for (const entry of diagnostics) {
      const color = String(entry?.color || "");
      if (!COLORS.includes(color)) continue;
      candidateSeen[color] += 1;
      if (entry?.ok === true) candidateOk[color] += 1;
    }
  } catch (error) {
    failures.push({ index: i, reason: String(error?.message || error), scramble });
  }
}

const successes = Object.values(counts).reduce((a, b) => a + b, 0);
const result = {
  requested: N,
  successes,
  failureCount: failures.length,
  counts,
  labelCounts: Object.fromEntries(COLORS.map((c) => [LABELS[c], counts[c]])),
  percentages: Object.fromEntries(COLORS.map((c) => [LABELS[c], successes ? Number((100 * counts[c] / successes).toFixed(2)) : 0])),
  candidateSeen,
  candidateOk,
  firstCandidates,
  failures: failures.slice(0, 20),
};
fs.writeFileSync("tools/cn-fix-result-temp.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (successes !== N) process.exitCode = 2;
if (COLORS.some((c) => counts[c] === 0)) process.exitCode = 3;
