import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3StrictCfopFromPattern } from "./solver/cfop3x3.js";

const RUNS = Math.max(1, Number.parseInt(process.env.ZB_RELIABILITY_RUNS || "250", 10) || 250);
const TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.ZB_RELIABILITY_TIMEOUT_MS || "30000", 10) || 30000);
const DIAGNOSTIC_INDICES = new Set([58, 76, 81, 132, 143]);
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

async function solveOne(pattern, scramble) {
  return Promise.race([
    solve3x3StrictCfopFromPattern(pattern, {
      mode: "zb",
      solverVersion: "v2",
      crossColor: "D",
      scramble,
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      enableStyleFallback: false,
      allowSlowFormulaFallback: false,
      zbllSearchMaxDepth: 16,
      zbllNodeLimit: 12000000,
      deadlineTs: Date.now() + TIMEOUT_MS - 150,
    }),
    new Promise((resolve) => setTimeout(
      () => resolve({ ok: false, reason: `TIMEOUT_${TIMEOUT_MS}MS` }),
      TIMEOUT_MS,
    )),
  ]);
}

const failures = [];
const synthesized = [];
for (let index = 0; index < RUNS; index += 1) {
  const scramble = makeScramble();
  const pattern = solved.applyAlg(scramble);
  const result = await solveOne(pattern, scramble);
  let valid = false;
  if (result?.ok && result.solution) {
    try {
      valid = pattern.applyAlg(result.solution).experimentalIsSolved({ ignorePuzzleOrientation: false });
    } catch {
      valid = false;
    }
  }
  const recordIndex = index + 1;
  if (DIAGNOSTIC_INDICES.has(recordIndex)) {
    const zbllStage = Array.isArray(result?.stages)
      ? result.stages.find((stage) => String(stage?.name || "").startsWith("ZBLL"))
      : null;
    synthesized.push({
      index: recordIndex,
      scramble,
      ok: valid,
      reason: result?.reason || null,
      zbll: zbllStage?.solution || null,
      zbllMoveCount: zbllStage?.moveCount ?? null,
      stages: result?.stages || null,
    });
  }
  if (!valid) {
    failures.push({
      index: recordIndex,
      scramble,
      reason: result?.reason || "INVALID_SOLUTION",
      stage: result?.stage || null,
      source: result?.source || null,
    });
  }
  if (recordIndex % 25 === 0 || recordIndex === RUNS) {
    console.log(`[Pure ZB direct generation] ${recordIndex}/${RUNS} failures=${failures.length}`);
  }
}

console.log(JSON.stringify({ runs: RUNS, failures: failures.length, synthesized, failureDetails: failures }, null, 2));
assert.equal(failures.length, 0, `Pure ZB diagnostic generation failed ${failures.length}/${RUNS}`);
