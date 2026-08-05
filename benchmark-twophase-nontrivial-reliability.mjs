import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  ensureTwophase333Ready,
  solveTwophaseAdaptive333,
} from "./solver/wasmSolver.js";

const FACES = ["U", "R", "F", "D", "L", "B"];
const SUFFIXES = ["", "2", "'"];

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function generateScrambles(count, length, seed = 0x2f6e2b1) {
  const random = makeRng(seed);
  const scrambles = [];
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const moves = [];
    let previousFace = "";
    for (let moveIndex = 0; moveIndex < length; moveIndex += 1) {
      let face = FACES[Math.floor(random() * FACES.length)];
      while (face === previousFace) {
        face = FACES[Math.floor(random() * FACES.length)];
      }
      const suffix = SUFFIXES[Math.floor(random() * SUFFIXES.length)];
      moves.push(`${face}${suffix}`);
      previousFace = face;
    }
    scrambles.push(moves.join(" "));
  }
  return scrambles;
}

function invertMove(move) {
  if (move.endsWith("2")) return move;
  if (move.endsWith("'")) return move.slice(0, -1);
  return `${move}'`;
}

function invertAlgorithm(algorithm) {
  return String(algorithm || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .reverse()
    .map(invertMove)
    .join(" ");
}

const ready = await ensureTwophase333Ready();
if (!ready) throw new Error("TWOPHASE_RELIABILITY_WASM_NOT_READY");

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const scrambles = generateScrambles(100, 20);
const rows = [];

for (const [index, scramble] of scrambles.entries()) {
  const inverse = invertAlgorithm(scramble);
  const startedAt = performance.now();
  const result = await solveTwophaseAdaptive333(scramble, {
    frontierLimits: [2, 12, 48],
    prepareOptions: {
      phase1MaxDepth: 13,
      phase1NodeLimit: 0,
    },
    searchOptions: {
      incumbentLength: 20,
      excludedSolution: inverse,
      strictIncumbent: false,
      phase2MaxDepth: 20,
      phase2NodeLimit: 0,
    },
  });
  const elapsedMs = performance.now() - startedAt;
  const solution = String(result?.solution || "").trim();
  const solvedState = result?.ok === true
    && solution
    && solved
      .applyAlg(scramble)
      .applyAlg(solution)
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
  const nontrivial = solution !== inverse;
  rows.push({
    index,
    ok: solvedState && nontrivial,
    elapsedMs,
    moveCount: result?.moveCount ?? null,
    frontierLimit: result?.frontierLimit ?? null,
    frontierExpansionCount: result?.frontierExpansionCount ?? null,
    reason: result?.reason || null,
  });
}

const failures = rows.filter((row) => !row.ok);
const expanded = rows.filter((row) => Number(row.frontierExpansionCount) > 0);
const maxElapsedMs = Math.max(...rows.map((row) => row.elapsedMs));
const averageElapsedMs = rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length;

console.log(`TWOPHASE_NONTRIVIAL_RELIABILITY=${JSON.stringify({
  total: rows.length,
  successes: rows.length - failures.length,
  failures,
  expandedCases: expanded.length,
  averageElapsedMs,
  maxElapsedMs,
})}`);

if (failures.length > 0) {
  throw new Error(`TWOPHASE_NONTRIVIAL_FAILURES:${JSON.stringify(failures)}`);
}
