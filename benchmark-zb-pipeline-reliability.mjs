import fs from "node:fs";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3StrictCfopFromPattern } from "./solver/cfop3x3.js";

const RUNS = Math.max(1, Number.parseInt(process.env.ZB_PIPELINE_RUNS || "250", 10) || 250);
const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
let rngState = 0x7a6b5c4d;

function randomUnit() {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) / 0x100000000;
}

const faces = ["U", "D", "R", "L", "F", "B"];
const suffixes = ["", "'", "2"];
const axes = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

function scramble(length = 21) {
  const moves = [];
  let lastFace = "";
  let lastAxis = -1;
  for (let index = 0; index < length; index += 1) {
    let face;
    do face = faces[Math.floor(randomUnit() * faces.length)];
    while (face === lastFace || axes[face] === lastAxis);
    moves.push(face + suffixes[Math.floor(randomUnit() * suffixes.length)]);
    lastFace = face;
    lastAxis = axes[face];
  }
  return moves.join(" ");
}

const rows = [];
const reasonCounts = new Map();
let xcrossSelected = 0;
let xcrossRejected = 0;
let beamSuccesses = 0;
let compactFallbacks = 0;
let zblsRescans = 0;
let zbllRescans = 0;
let invalidSolutions = 0;

for (let index = 0; index < RUNS; index += 1) {
  const scrambleText = scramble();
  const pattern = solved.applyAlg(scrambleText);
  const startedAt = Date.now();
  let result;
  try {
    result = await solve3x3StrictCfopFromPattern(pattern, {
      mode: "zb",
      solverVersion: "v2",
      crossColor: "D",
      scramble: scrambleText,
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + 10000,
    });
  } catch (error) {
    result = { ok: false, reason: String(error?.message || error || "ERROR") };
  }

  let valid = false;
  if (result?.ok && result.solution) {
    try {
      valid = pattern.applyAlg(result.solution).experimentalIsSolved({ ignorePuzzleOrientation: false });
    } catch {
      valid = false;
    }
  }
  if (result?.ok && !valid) invalidSolutions += 1;

  if (result?.zbXCrossProbe?.selectedTargetPairs === 1) xcrossSelected += 1;
  else if (result?.zbXCrossProbe?.attempted) xcrossRejected += 1;

  const f2l = result?.performanceDiagnostics?.f2l || null;
  if (f2l?.beamSucceeded) beamSuccesses += 1;
  if (f2l?.compactFallbackUsed) compactFallbacks += 1;

  const stageDiagnostics = Array.isArray(result?.stageDiagnostics) ? result.stageDiagnostics : [];
  const zbls = stageDiagnostics.find((stage) => stage.stageName === "ZBLS");
  const zbll = stageDiagnostics.find((stage) => stage.stageName === "ZBLL");
  if (zbls?.metrics?.caseLibraryRescanUsed) zblsRescans += 1;
  if (zbll?.metrics?.caseLibraryRescanUsed) zbllRescans += 1;

  const ok = result?.ok === true && valid;
  if (!ok) {
    const reason = String(result?.reason || (result?.ok ? "INVALID_SOLUTION" : "UNKNOWN_FAILURE"));
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }

  rows.push({
    index: index + 1,
    scramble: scrambleText,
    ok,
    reason: ok ? null : String(result?.reason || "INVALID_SOLUTION"),
    stage: result?.stage || null,
    moveCount: result?.moveCount ?? null,
    elapsedMs: Date.now() - startedAt,
    crossStage: stageDiagnostics[0]?.stageName || null,
    xcrossProbe: result?.zbXCrossProbe || null,
    f2l: f2l
      ? {
          finalMethod: f2l.finalMethod,
          beamSucceeded: f2l.beamSucceeded,
          beamTermination: f2l.beamTermination,
          attemptsCount: f2l.attemptsCount,
          candidateScanCount: f2l.candidateScanCount,
          compactFallbackUsed: f2l.compactFallbackUsed,
          beamDepthProgression: f2l.beamDepthProgression || [],
        }
      : null,
    zblsRescan: zbls?.metrics?.caseLibraryRescanUsed === true,
    zbllRescan: zbll?.metrics?.caseLibraryRescanUsed === true,
    failureCapture: ok
      ? null
      : {
          stages: Array.isArray(result?.stages) ? result.stages : [],
          partialSolution: result?.partialSolution || "",
          failureState: result?.failureState || null,
          stageDiagnostics,
        },
  });

  if ((index + 1) % 10 === 0 || index + 1 === RUNS) {
    console.log(`[Pure ZB pipeline] ${index + 1}/${RUNS} success=${rows.filter((row) => row.ok).length}`);
  }
}

const failures = rows.filter((row) => !row.ok);
const elapsedValues = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
const summary = {
  runs: RUNS,
  successes: RUNS - failures.length,
  failures: failures.length,
  successRate: (RUNS - failures.length) / RUNS,
  invalidSolutions,
  xcrossSelected,
  xcrossRejected,
  xcrossSelectionRate: (xcrossSelected + xcrossRejected) > 0
    ? xcrossSelected / (xcrossSelected + xcrossRejected)
    : null,
  beamSuccesses,
  compactFallbacks,
  zblsRescans,
  zbllRescans,
  reasonCounts: Object.fromEntries(reasonCounts),
  timingMs: {
    median: elapsedValues[Math.floor(elapsedValues.length / 2)] || 0,
    p95: elapsedValues[Math.min(elapsedValues.length - 1, Math.floor(elapsedValues.length * 0.95))] || 0,
    max: elapsedValues.at(-1) || 0,
  },
  failureDetails: failures,
};

fs.mkdirSync("benchmark-results", { recursive: true });
fs.writeFileSync(
  "benchmark-results/zb-pipeline-reliability-250.json",
  `${JSON.stringify(summary, null, 2)}\n`,
);
console.log(JSON.stringify(summary, null, 2));

if (invalidSolutions > 0) {
  throw new Error(`Pure ZB produced ${invalidSolutions} invalid solution(s)`);
}
if (failures.length > 0) {
  throw new Error(`Pure ZB pipeline reliability regression: ${failures.length}/${RUNS} failed`);
}
