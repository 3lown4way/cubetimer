import fs from "node:fs";

const mainPath = "main.js";
let source = fs.readFileSync(mainPath, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  `  const runId = ++solverProgressRunId;\n  const eventId = appState.settings.eventId;`,
  `  const runId = ++solverProgressRunId;\n  const eventId = appState.settings.eventId;\n  const solverScramble = currentScramble;`,
  "capture solver scramble",
);

replaceOnce(
  `        scramble: currentScramble,\n        eventId,`,
  `        scramble: solverScramble,\n        eventId,`,
  "route captured scramble to worker",
);

replaceOnce(
  `      showSolverVisualResult(currentScramble, rawSolutionText, result.stages);`,
  `      showSolverVisualResult(solverScramble, rawSolutionText, result.stages, eventId);`,
  "route captured preview context",
);

fs.writeFileSync(mainPath, source);

const testPath = "tools/verify-nxn-solver-preview.mjs";
let testSource = fs.readFileSync(testPath, "utf8");
const marker = `assert.match(mainSource, /const puzzleId = resolveNxNSolverPuzzle\\(eventId\\)/);`;
const addition = `${marker}\nassert.match(mainSource, /const solverScramble = currentScramble/);\nassert.match(mainSource, /scramble: solverScramble/);\nassert.match(mainSource, /showSolverVisualResult\\(solverScramble, rawSolutionText, result\\.stages, eventId\\)/);`;
if (!testSource.includes(addition)) {
  if (!testSource.includes(marker)) throw new Error("test insertion point not found");
  testSource = testSource.replace(marker, addition);
  fs.writeFileSync(testPath, testSource);
}

console.log("Captured solver preview event and scramble context");
