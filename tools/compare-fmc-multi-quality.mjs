import fs from "node:fs";

const [baselinePath, currentPath, outputPath = ""] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  throw new Error("USAGE: compare-fmc-multi-quality.mjs baseline.json current.json [output.json]");
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const current = JSON.parse(fs.readFileSync(currentPath, "utf8"));
if (!Array.isArray(baseline.rows) || !Array.isArray(current.rows)) {
  throw new Error("BAD_BENCHMARK_OUTPUT");
}
if (baseline.rows.length !== current.rows.length) {
  throw new Error(`RUN_COUNT_MISMATCH:${baseline.rows.length}:${current.rows.length}`);
}

const rows = [];
let improved = 0;
let equal = 0;
let regressed = 0;
let recovered = 0;
let lost = 0;
let bothFailed = 0;
let totalMovesSaved = 0;
let maxMovesSaved = 0;
let commonSolved = 0;

for (let index = 0; index < baseline.rows.length; index += 1) {
  const before = baseline.rows[index];
  const after = current.rows[index];
  if (before.scramble !== after.scramble) {
    throw new Error(`SCRAMBLE_MISMATCH:${index}`);
  }

  let status;
  let saved = null;
  if (before.ok && after.ok) {
    commonSolved += 1;
    saved = Number(before.moveCount) - Number(after.moveCount);
    if (saved > 0) {
      improved += 1;
      status = "improved";
    } else if (saved === 0) {
      equal += 1;
      status = "equal";
    } else {
      regressed += 1;
      status = "regressed";
    }
    totalMovesSaved += saved;
    maxMovesSaved = Math.max(maxMovesSaved, saved);
  } else if (!before.ok && after.ok) {
    recovered += 1;
    status = "recovered";
  } else if (before.ok && !after.ok) {
    lost += 1;
    status = "lost";
  } else {
    bothFailed += 1;
    status = "both-failed";
  }

  rows.push({
    index,
    scramble: before.scramble,
    status,
    baselineOk: before.ok,
    currentOk: after.ok,
    baselineMoves: before.moveCount,
    currentMoves: after.moveCount,
    movesSaved: saved,
    baselineMs: before.solveMs,
    currentMs: after.solveMs,
    multiInsertionCandidateCount: after.multiInsertionCandidateCount,
    multiCandidateInTop: after.multiCandidateInTop,
    bestIsMulti: after.bestIsMulti,
    bestSource: after.bestSource,
  });
}

const baselineAverageMs = Number(baseline.summary.averageSolveMs || 0);
const currentAverageMs = Number(current.summary.averageSolveMs || 0);
const summary = {
  runs: rows.length,
  commonSolved,
  improved,
  equal,
  regressed,
  recovered,
  lost,
  bothFailed,
  improvementRate: improved / Math.max(1, commonSolved),
  totalMovesSaved,
  averageMovesSaved: totalMovesSaved / Math.max(1, commonSolved),
  maxMovesSaved,
  baselineSolvedCases: baseline.summary.solvedCases,
  currentSolvedCases: current.summary.solvedCases,
  baselineSolveRate: baseline.summary.solveRate,
  currentSolveRate: current.summary.solveRate,
  baselineAverageMoves: baseline.summary.averageMoves,
  currentAverageMoves: current.summary.averageMoves,
  baselineAverageMs,
  currentAverageMs,
  runtimeRatio: baselineAverageMs > 0 ? currentAverageMs / baselineAverageMs : 0,
  runtimeDeltaPercent:
    baselineAverageMs > 0 ? ((currentAverageMs - baselineAverageMs) / baselineAverageMs) * 100 : 0,
  multiGeneratedCases: current.summary.multiGeneratedCases,
  multiSkeletonCases: current.summary.multiSkeletonCases,
  multiCandidateTopCases: current.summary.multiCandidateTopCases,
  bestMultiCases: current.summary.bestMultiCases,
  totalMultiCandidates: current.summary.totalMultiCandidates,
};

const output = { summary, rows };
if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

const lines = [
  "## FMC multi-insertion 1000-scramble comparison",
  "",
  "| Metric | Baseline (2C2E) | Multi-insertion |",
  "|---|---:|---:|",
  `| Solved cases | ${summary.baselineSolvedCases}/${summary.runs} | ${summary.currentSolvedCases}/${summary.runs} |`,
  `| Average moves on solved cases | ${Number(summary.baselineAverageMoves).toFixed(4)} | ${Number(summary.currentAverageMoves).toFixed(4)} |`,
  `| Average solve time | ${summary.baselineAverageMs.toFixed(2)} ms | ${summary.currentAverageMs.toFixed(2)} ms |`,
  `| Runtime ratio | 1.000× | ${summary.runtimeRatio.toFixed(3)}× |`,
  "",
  `- Improved among common solved cases: **${improved}**`,
  `- Equal among common solved cases: **${equal}**`,
  `- Move-count regressions: **${regressed}**`,
  `- Newly solved by multi-insertion version: **${recovered}**`,
  `- Lost solutions: **${lost}**`,
  `- Failed in both versions: **${bothFailed}**`,
  `- Total moves saved on common solved cases: **${totalMovesSaved}**`,
  `- Maximum saving on one scramble: **${maxMovesSaved}**`,
  `- Multi-insertion generated: **${summary.multiGeneratedCases}/${summary.runs}** cases`,
  `- Multi-insertion entered returned top candidates: **${summary.multiCandidateTopCases}/${summary.runs}** cases`,
  `- Multi-insertion became the best result: **${summary.bestMultiCases}/${summary.runs}** cases`,
  `- Total valid multi-insertion candidates: **${summary.totalMultiCandidates}**`,
  "",
  "```json",
  JSON.stringify(summary, null, 2),
  "```",
];
const markdown = lines.join("\n");
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

if (regressed > 0 || lost > 0) {
  throw new Error(`FMC_REGRESSION:move=${regressed}:lost=${lost}`);
}
