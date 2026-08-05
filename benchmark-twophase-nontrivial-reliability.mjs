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

function splitAlgorithm(algorithm) {
  return String(algorithm || "").trim().split(/\s+/).filter(Boolean);
}

function longestCommonSubsequenceLength(left, right) {
  let previous = new Array(right.length + 1).fill(0);
  let current = new Array(right.length + 1).fill(0);
  for (const leftMove of left) {
    current.fill(0);
    for (let index = 0; index < right.length; index += 1) {
      current[index + 1] = leftMove === right[index]
        ? previous[index] + 1
        : Math.max(current[index], previous[index + 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

function longestCommonContiguousLength(left, right) {
  let previous = new Array(right.length + 1).fill(0);
  let current = new Array(right.length + 1).fill(0);
  let best = 0;
  for (const leftMove of left) {
    current.fill(0);
    for (let index = 0; index < right.length; index += 1) {
      if (leftMove === right[index]) {
        current[index + 1] = previous[index] + 1;
        best = Math.max(best, current[index + 1]);
      }
    }
    [previous, current] = [current, previous];
  }
  return best;
}

function isInverseDerived(solution, inverse) {
  const path = splitAlgorithm(solution);
  const excluded = splitAlgorithm(inverse);
  if (path.join(" ") === excluded.join(" ")) return true;
  const sharedLength = Math.min(path.length, excluded.length);
  if (sharedLength < 10) return false;
  const lcs = longestCommonSubsequenceLength(path, excluded);
  if (lcs + 2 >= sharedLength && lcs * 100 >= sharedLength * 85) return true;
  const contiguous = longestCommonContiguousLength(path, excluded);
  return contiguous >= 10 && contiguous * 2 >= sharedLength;
}

const regressionCases = [
  {
    name: "uploaded-local-commutation",
    scramble: "F2 D F2 D2 B2 R2 D' B2 D R2 U2 B2 L R2 D F' R U2 B D U'",
    rejectedSolution: "U D' B' U2 R' F D' L' R2 B2 U2 R2 D' B2 D R2 B2 D2 F2 D' F2",
  },
  {
    name: "uploaded-long-inverse-block",
    scramble: "F2 L2 F2 U' L2 B2 U B2 R2 F2 U2 F2 L D' R' U L B' L2 R D2",
    rejectedSolution: "D2 R' L2 B L' U' R D L' F2 U2 D F2 U F2 L2 F2 D' F2 B2 D",
  },
];

for (const regressionCase of regressionCases) {
  const inverse = invertAlgorithm(regressionCase.scramble);
  if (!isInverseDerived(regressionCase.rejectedSolution, inverse)) {
    throw new Error(`TWOPHASE_REGRESSION_CLASSIFIER_MISS:${regressionCase.name}`);
  }
}

const ready = await ensureTwophase333Ready();
if (!ready) throw new Error("TWOPHASE_RELIABILITY_WASM_NOT_READY");

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const cases = [
  ...regressionCases.map(({ name, scramble }) => ({ name, scramble })),
  ...generateScrambles(100, 20).map((scramble, index) => ({
    name: `generated-${String(index + 1).padStart(3, "0")}`,
    scramble,
  })),
];
const rows = [];

for (const [index, testCase] of cases.entries()) {
  const { name, scramble } = testCase;
  const inverse = invertAlgorithm(scramble);
  const startedAt = performance.now();
  const result = await solveTwophaseAdaptive333(scramble, {
    frontierLimits: [2, 12, 48, 192, 768],
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
  const inverseDerived = isInverseDerived(solution, inverse);
  rows.push({
    index,
    name,
    ok: solvedState && !inverseDerived,
    elapsedMs,
    moveCount: result?.moveCount ?? null,
    frontierLimit: result?.frontierLimit ?? null,
    frontierExpansionCount: result?.frontierExpansionCount ?? null,
    reason: result?.reason || null,
    inverseDerived,
  });
}

const failures = rows.filter((row) => !row.ok);
const expanded = rows.filter((row) => Number(row.frontierExpansionCount) > 0);
const maxElapsedMs = Math.max(...rows.map((row) => row.elapsedMs));
const averageElapsedMs = rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length;

console.log(`TWOPHASE_NONTRIVIAL_RELIABILITY=${JSON.stringify({
  total: rows.length,
  regressionCases: regressionCases.length,
  successes: rows.length - failures.length,
  failures,
  inverseDerivedResults: rows.filter((row) => row.inverseDerived).length,
  expandedCases: expanded.length,
  averageElapsedMs,
  maxElapsedMs,
})}`);

if (failures.length > 0) {
  throw new Error(`TWOPHASE_NONTRIVIAL_FAILURES:${JSON.stringify(failures)}`);
}
