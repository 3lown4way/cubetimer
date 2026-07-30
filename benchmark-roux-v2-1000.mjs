import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import { solve3x3RouxV2FromPattern } from "./solver/roux3x3v2.js";

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
function scramble(length = 21) {
  const moves = [];
  let lastFace = "";
  let lastAxis = -1;
  for (let index = 0; index < length; index++) {
    let face;
    do face = faces[Math.floor(randomUnit() * faces.length)];
    while (face === lastFace || axes[face] === lastAxis);
    moves.push(face + suffixes[Math.floor(randomUnit() * suffixes.length)]);
    lastFace = face;
    lastAxis = axes[face];
  }
  return moves.join(" ");
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p) => sorted[Math.floor((sorted.length - 1) * p)] ?? null;
  return {
    count: sorted.length,
    average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    minimum: sorted[0] ?? null,
    maximum: sorted.at(-1) ?? null,
  };
}

const scrambles = Array.from({ length: 1000 }, () => scramble());
const elapsed = [];
const moveCounts = [];
const failures = [];
for (let index = 0; index < scrambles.length; index++) {
  const pattern = solved.applyAlg(scrambles[index]);
  const startedAt = performance.now();
  const result = await solve3x3RouxV2FromPattern(pattern, { crossColor: "D" });
  elapsed.push(performance.now() - startedAt);
  let valid = false;
  try {
    valid = result?.ok === true && pattern.applyAlg(result.solution).isIdentical(solved);
  } catch {
    valid = false;
  }
  if (valid) moveCounts.push(result.moveCount);
  else failures.push({ index: index + 1, scramble: scrambles[index], result });
}

console.log(JSON.stringify({
  solver: "Roux v2",
  runs: scrambles.length,
  successes: scrambles.length - failures.length,
  failures: failures.length,
  firstRunMs: elapsed[0],
  warmElapsedMs: stats(elapsed.slice(1)),
  allElapsedMs: stats(elapsed),
  moveCounts: stats(moveCounts),
  failureDetails: failures,
}, null, 2));
