import { cube3x3x3 } from "../vendor/cubing/puzzles/index.js";
import { solve3x3RouxV2FromPattern } from "../solver/roux3x3v2.js";

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

let rngState = 0x4d595df4;
function randomUnit() {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) / 0x100000000;
}

const faces = ["U", "D", "R", "L", "F", "B"];
const suffixes = ["", "'", "2"];
const axes = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };

function deterministicScramble(length = 21) {
  const moves = [];
  let lastFace = "";
  let lastAxis = -1;
  for (let index = 0; index < length; index++) {
    let face;
    do {
      face = faces[Math.floor(randomUnit() * faces.length)];
    } while (face === lastFace || axes[face] === lastAxis);
    moves.push(face + suffixes[Math.floor(randomUnit() * suffixes.length)]);
    lastFace = face;
    lastAxis = axes[face];
  }
  return moves.join(" ");
}

const scrambles = Array.from({ length: 1000 }, () => deterministicScramble());
const failures = [];
let firstResult = null;
let totalMoves = 0;
let totalElapsedMs = 0;

for (let index = 0; index < scrambles.length; index++) {
  const scramble = scrambles[index];
  const pattern = solved.applyAlg(scramble);
  const startedAt = performance.now();
  const result = await solve3x3RouxV2FromPattern(pattern, { crossColor: "D" });
  totalElapsedMs += performance.now() - startedAt;
  if (!firstResult) firstResult = result;

  let valid = false;
  try {
    valid = result?.ok === true
      && result.source === "INTERNAL_3X3_ROUX_V2"
      && pattern.applyAlg(result.solution).isIdentical(solved);
  } catch {
    valid = false;
  }
  if (!valid) {
    failures.push({ index: index + 1, scramble, result });
    continue;
  }
  totalMoves += result.moveCount;
}

const expectedMetrics = {
  fbStateCount: 5322240,
  fbMaxDepth: 9,
  sbStateCount: 1088640,
  sbMaxDepth: 14,
  lseStateCount: 184320,
  lseMaxDepth: 20,
};
const actualMetrics = firstResult?.tableBuildMetrics || {};
const metricMismatches = Object.entries(expectedMetrics)
  .filter(([key, expected]) => actualMetrics[key] !== expected)
  .map(([key, expected]) => ({ key, expected, actual: actualMetrics[key] }));

const colorFailures = [];
for (const color of ["D", "U", "F", "B", "R", "L"]) {
  for (let index = 0; index < 20; index++) {
    const scramble = scrambles[index];
    const pattern = solved.applyAlg(scramble);
    const result = await solve3x3RouxV2FromPattern(pattern, { crossColor: color });
    let valid = false;
    try {
      valid = result?.ok === true && pattern.applyAlg(result.solution).isIdentical(solved);
    } catch {
      valid = false;
    }
    if (!valid) colorFailures.push({ color, index: index + 1, scramble, result });
  }
}

const summary = {
  runs: scrambles.length,
  successes: scrambles.length - failures.length,
  failures: failures.length,
  averageMoves: failures.length === scrambles.length
    ? null
    : totalMoves / (scrambles.length - failures.length),
  totalElapsedMs,
  cmllIndexSize: firstResult?.cmllIndexSize ?? null,
  tableBuildMetrics: actualMetrics,
  metricMismatchCount: metricMismatches.length,
  crossColorRuns: 120,
  crossColorFailures: colorFailures.length,
};
console.log(JSON.stringify(summary));

if (
  failures.length
  || colorFailures.length
  || metricMismatches.length
  || firstResult?.cmllIndexSize !== 648
) {
  if (failures.length) console.error("Roux v2 failures:", failures.slice(0, 10));
  if (colorFailures.length) console.error("Cross-color failures:", colorFailures.slice(0, 10));
  if (metricMismatches.length) console.error("Table metric mismatches:", metricMismatches);
  process.exit(1);
}
