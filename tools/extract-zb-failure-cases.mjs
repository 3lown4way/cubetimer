import fs from "node:fs";

const inputPath = "benchmark-results/zb-pipeline-reliability-250.json";
const outputPath = "benchmark-results/zb-failure-cases-compact.json";
const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const failures = Array.isArray(report.failureDetails) ? report.failureDetails : [];
const compact = failures.map((failure) => {
  const capture = failure.failureCapture || {};
  const diagnostics = Array.isArray(capture.stageDiagnostics) ? capture.stageDiagnostics : [];
  const zbll = diagnostics.find((stage) => stage.stageName === "ZBLL") || null;
  return {
    index: failure.index,
    scramble: failure.scramble,
    reason: failure.reason,
    elapsedMs: failure.elapsedMs,
    partialSolution: capture.partialSolution || "",
    stages: Array.isArray(capture.stages)
      ? capture.stages.map((stage) => ({ name: stage.name, solution: stage.solution, moveCount: stage.moveCount }))
      : [],
    failureState: capture.failureState || null,
    zbllMetrics: zbll?.metrics || null,
  };
});
fs.writeFileSync(outputPath, `${JSON.stringify(compact, null, 2)}\n`);
console.log(JSON.stringify(compact, null, 2));
