import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3StrictCfopFromPattern } from "./solver/cfop3x3.js";

const RUNS = Math.max(1, Number.parseInt(process.env.ZB_RELIABILITY_RUNS || "250", 10) || 250);
const ATTEMPT_TIMEOUTS = [10000, 8000, 8000];

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

async function runAttempt(pattern, scrambleText, attemptIndex) {
  const common = {
    mode: "zb",
    crossColor: "D",
    scramble: scrambleText,
    enableOllPllPrediction: false,
    allowRelaxedSearch: false,
  };
  const variants = [
    {
      ...common,
      solverVersion: "v2",
    },
    {
      ...common,
      solverVersion: "v1",
      f2lFormulaMaxSteps: 14,
      f2lFormulaBeamWidth: 8,
      f2lFormulaExpansionLimit: 12,
      f2lFormulaMaxAttempts: 240000,
      f2lFormulaBeamBudgetMs: 40,
      f2lSearchMaxDepth: 12,
      f2lNodeLimit: 320000,
    },
    {
      ...common,
      solverVersion: "v2",
      f2lStyleProfile: "balanced",
      enableStyleFallback: true,
      allowSlowFormulaFallback: true,
      f2lFormulaMaxSteps: 16,
      f2lFormulaBeamWidth: 10,
      f2lFormulaExpansionLimit: 16,
      f2lFormulaMaxAttempts: 420000,
      f2lFormulaBeamBudgetMs: 60,
      f2lSearchMaxDepth: 14,
      f2lNodeLimit: 800000,
    },
  ];
  const timeoutMs = ATTEMPT_TIMEOUTS[attemptIndex];
  const result = await withTimeout(
    solve3x3StrictCfopFromPattern(pattern, {
      ...variants[attemptIndex],
      deadlineTs: Date.now() + timeoutMs - 150,
    }),
    timeoutMs,
  );
  let valid = false;
  if (result?.ok && result.solution) {
    try {
      valid = pattern.applyAlg(result.solution).experimentalIsSolved({ ignorePuzzleOrientation: false });
    } catch {
      valid = false;
    }
  }
  return { result, valid };
}

const rows = [];
const recoveredByAttempt = [0, 0, 0];
const baselineReasons = new Map();
const finalReasons = new Map();

for (let index = 0; index < RUNS; index += 1) {
  const scrambleText = scramble();
  const pattern = solved.applyAlg(scrambleText);
  const attemptRows = [];
  let successAttempt = -1;

  for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
    const attempt = await runAttempt(pattern, scrambleText, attemptIndex);
    attemptRows.push({
      attempt: attemptIndex + 1,
      ok: attempt.valid,
      reason: attempt.result?.reason || null,
      stage: attempt.result?.stage || null,
      moveCount: attempt.result?.moveCount ?? null,
      source: attempt.result?.source || null,
    });
    if (attemptIndex === 0 && !attempt.valid) {
      const reason = String(attempt.result?.reason || "INVALID_SOLUTION");
      baselineReasons.set(reason, (baselineReasons.get(reason) || 0) + 1);
    }
    if (attempt.valid) {
      successAttempt = attemptIndex;
      recoveredByAttempt[attemptIndex] += 1;
      break;
    }
  }

  if (successAttempt < 0) {
    const reason = String(attemptRows.at(-1)?.reason || "INVALID_SOLUTION");
    finalReasons.set(reason, (finalReasons.get(reason) || 0) + 1);
  }
  rows.push({
    index: index + 1,
    scramble: scrambleText,
    ok: successAttempt >= 0,
    successAttempt: successAttempt >= 0 ? successAttempt + 1 : null,
    attempts: attemptRows,
  });

  if ((index + 1) % 25 === 0 || index + 1 === RUNS) {
    const successes = rows.filter((row) => row.ok).length;
    console.log(`[ZB reliability] ${index + 1}/${RUNS} success=${successes}`);
  }
}

const baselineFailures = rows.filter((row) => row.attempts[0]?.ok !== true).length;
const failures = rows.filter((row) => !row.ok);
const summary = {
  runs: RUNS,
  baselineSuccesses: RUNS - baselineFailures,
  baselineFailures,
  baselineSuccessRate: (RUNS - baselineFailures) / RUNS,
  recoveredByAttempt,
  finalSuccesses: RUNS - failures.length,
  finalFailures: failures.length,
  finalSuccessRate: (RUNS - failures.length) / RUNS,
  baselineReasons: Object.fromEntries(baselineReasons),
  finalReasons: Object.fromEntries(finalReasons),
  failureDetails: failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  throw new Error(`Pure ZB reliability regression: ${failures.length}/${RUNS} failed`);
}
