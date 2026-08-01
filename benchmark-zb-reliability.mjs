// Deterministic single-path reliability gate for Pure ZB v2.
import { performance } from "node:perf_hooks";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3StrictCfopFromPattern } from "./solver/cfop3x3.js";

const RUNS = Math.max(1, Number.parseInt(process.env.ZB_RELIABILITY_RUNS || "1000", 10) || 1000);
const TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.ZB_RELIABILITY_TIMEOUT_MS || "10000", 10) || 10000);
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

function makeScramble(length = 21) {
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

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, reason: `TIMEOUT_${timeoutMs}MS` }), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: String(error?.message || error || "ERROR") });
    });
  });
}

const failures = [];
const reasons = new Map();
const durations = [];
let totalMoves = 0;

for (let index = 0; index < RUNS; index += 1) {
  const scramble = makeScramble();
  const pattern = solved.applyAlg(scramble);
  const startedAt = performance.now();
  const result = await withTimeout(
    solve3x3StrictCfopFromPattern(pattern, {
      mode: "zb",
      solverVersion: "v2",
      crossColor: "D",
      scramble,
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + TIMEOUT_MS - 100,
    }),
    TIMEOUT_MS,
  );
  const elapsedMs = performance.now() - startedAt;
  durations.push(elapsedMs);

  let solvedCorrectly = false;
  if (result?.ok && result.solution) {
    try {
      solvedCorrectly = pattern
        .applyAlg(result.solution)
        .experimentalIsSolved({ ignorePuzzleOrientation: false });
    } catch {
      solvedCorrectly = false;
    }
  }

  if (!solvedCorrectly) {
    const reason = String(result?.reason || (result?.ok ? "INVALID_SOLUTION" : "UNKNOWN_FAILURE"));
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
    failures.push({
      index: index + 1,
      scramble,
      reason,
      stage: result?.stage || null,
      elapsedMs: Number(elapsedMs.toFixed(3)),
    });
  } else {
    totalMoves += Number(result.moveCount) || 0;
  }

  if ((index + 1) % 100 === 0 || index + 1 === RUNS) {
    console.log(`[Pure ZB reliability] ${index + 1}/${RUNS} success=${index + 1 - failures.length}`);
  }
}

const sortedDurations = durations.slice().sort((a, b) => a - b);
const percentile = (ratio) => sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * ratio) - 1)];
const summary = {
  runs: RUNS,
  successes: RUNS - failures.length,
  failures: failures.length,
  successRate: (RUNS - failures.length) / RUNS,
  averageMoves: failures.length === RUNS ? null : totalMoves / (RUNS - failures.length),
  averageMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  maxMs: Math.max(...durations),
  reasons: Object.fromEntries(reasons),
  failureDetails: failures.slice(0, 25),
};
console.log(JSON.stringify(summary, null, 2));

if (failures.length) {
  throw new Error(`Pure ZB reliability regression: ${failures.length}/${RUNS} failed`);
}
