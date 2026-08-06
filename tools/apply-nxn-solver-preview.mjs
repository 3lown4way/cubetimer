import fs from "node:fs";

const path = "main.js";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected one target, found ${count}`);
  }
  source = source.replace(before, after);
}

function replaceRegexOnce(pattern, replacement, label) {
  if (pattern.global) throw new Error(`${label}: global regex is not supported`);
  const matches = source.match(pattern);
  if (!matches) throw new Error(`${label}: target not found`);
  source = source.replace(pattern, replacement);
}

replaceOnce(
  `import { TwistyPlayer } from "cubing/twisty";`,
  `import { TwistyPlayer } from "cubing/twisty";\nimport { resolveNxNSolverPuzzle } from "./solver/nxnTwistyPreview.js";`,
  "NxNxN preview import",
);

replaceOnce(
  `let solverTwistyPlayer = null;\nlet solverPlaybackScramble = "";`,
  `let solverTwistyPlayer = null;\nlet solverTwistyPuzzleId = "";\nlet solverPlaybackEventId = "333";\nlet solverPlaybackScramble = "";`,
  "solver preview state",
);

replaceRegexOnce(
  /function ensureSolverTwistyPlayer\(\) \{[\s\S]*?\n\}\n\nfunction updateSolverPlaybackControls\(\)/,
  `function ensureSolverTwistyPlayer(puzzleId = resolveNxNSolverPuzzle(solverPlaybackEventId)) {
  if (!puzzleId || !solverTwistyHost) return null;
  if (solverTwistyPlayer && solverTwistyPuzzleId === puzzleId) return solverTwistyPlayer;
  if (solverTwistyPlayer) solverTwistyPlayer.pause();
  solverTwistyPlayer = null;
  solverTwistyPuzzleId = "";
  solverTwistyHost.textContent = "";
  solverTwistyPlayer = new TwistyPlayer({
    puzzle: puzzleId,
    visualization: "3D",
    background: "none",
    controlPanel: "none",
    hintFacelets: "none",
    experimentalSetupAnchor: "start",
  });
  solverTwistyPuzzleId = puzzleId;
  solverTwistyPlayer.tempoScale = 0.75;
  solverTwistyHost.appendChild(solverTwistyPlayer);
  return solverTwistyPlayer;
}

function updateSolverPlaybackControls()`,
  "dynamic solver TwistyPlayer",
);

replaceRegexOnce(
  /function showSolverVisualResult\(scramble, solution, stages\) \{\n  if \(!solverVisualPanel\) return;\n  if \(!scramble \|\| !solution \|\| !isThreeByThreeFamilyEvent\(appState\.settings\.eventId\)\) \{\n    clearSolverVisualResult\(\);\n    return;\n  \}\n  stopSolverPlayback\(\);\n  solverPlaybackScramble = scramble;/,
  `function showSolverVisualResult(scramble, solution, stages, eventId = appState.settings.eventId) {
  if (!solverVisualPanel) return;
  const puzzleId = resolveNxNSolverPuzzle(eventId);
  if (!scramble || !solution || !puzzleId) {
    clearSolverVisualResult();
    return;
  }
  stopSolverPlayback();
  solverPlaybackEventId = String(eventId || "");
  ensureSolverTwistyPlayer(puzzleId);
  solverPlaybackScramble = scramble;`,
  "solver preview event routing",
);

if (!source.includes(`scramblePreview.setAttribute("visualization", "2D");`)) {
  throw new Error("Timer scramble-display must remain 2D");
}
if (source.includes("scramblePreview3DHost") || source.includes("data-preview-mode")) {
  throw new Error("Timer preview must not receive 3D UI");
}

fs.writeFileSync(path, source);
console.log("Patched solver-only NxNxN 3D preview");
