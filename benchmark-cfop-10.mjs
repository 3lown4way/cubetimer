import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from './solver/cfop3x3.js';
import { getGlobalF2LDownstreamProfile } from './solver/f2lDownstreamProfiles.js';

const scrambles = [
  "R U R' U' R' F R2 U' R' U' R U R' F'",
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "R2 U2 B2 L2 F2 D' F2 L2 B2 U' R2 F' U L' B' D2 R U' F",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
  "U' L2 B2 R2 D F2 D2 R2 B2 U' F2 L' B U2 R D' F' R2 U",
  "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'",
  "D B2 R2 F2 U' L2 U B2 L2 D2 F2 R' D' L U2 B' R2 F U'",
];

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries();
const downstreamProfile = await getGlobalF2LDownstreamProfile().catch(() => null);

const warmPattern = solved.applyAlg(scrambles[0]);
await solve3x3StrictCfopFromPattern(warmPattern, {
  crossColor: 'D',
  mode: 'strict',
  deadlineMs: 10000,
  enableStyleFallback: true,
});

const rows = [];
for (let i = 0; i < scrambles.length; i += 1) {
  const pattern = solved.applyAlg(scrambles[i]);

  const baselineStarted = performance.now();
  const baseline = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: 'D',
    mode: 'strict',
    deadlineMs: 10000,
    enableStyleFallback: true,
    enableOllPllPrediction: true,
    f2lDownstreamProfile: downstreamProfile,
    f2lDownstreamWeight: 0.35,
  });
  const baselineMs = performance.now() - baselineStarted;

  const optimizedStarted = performance.now();
  const optimized = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: 'D',
    mode: 'strict',
    deadlineMs: 10000,
    enableStyleFallback: true,
    enableOllPllPrediction: false,
  });
  const optimizedMs = performance.now() - optimizedStarted;

  rows.push({
    run: i + 1,
    baselineMs,
    optimizedMs,
    baselineOk: baseline?.ok === true,
    optimizedOk: optimized?.ok === true,
    baselineMoves: baseline?.moveCount ?? null,
    optimizedMoves: optimized?.moveCount ?? null,
    optimizedNodes: optimized?.nodes ?? null,
  });
}

const values = (key) => rows.map((row) => row[key]);
const avg = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const percentile = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
};

console.log('=== CFOP 10-run benchmark (warm, D cross, strict/legacy) ===');
for (const row of rows) {
  console.log(
    `#${String(row.run).padStart(2, '0')} ` +
    `optimized=${row.optimizedMs.toFixed(1).padStart(7)}ms ` +
    `ok=${row.optimizedOk ? 'Y' : 'N'} ` +
    `moves=${String(row.optimizedMoves ?? '?').padStart(2)} ` +
    `nodes=${String(row.optimizedNodes ?? '?').padStart(8)} | ` +
    `baseline=${row.baselineMs.toFixed(1).padStart(7)}ms`,
  );
}

const baselineTimes = values('baselineMs');
const optimizedTimes = values('optimizedMs');
console.log('--- summary ---');
console.log(`success: ${rows.filter((row) => row.optimizedOk).length}/${rows.length}`);
console.log(`optimized avg: ${avg(optimizedTimes).toFixed(1)}ms`);
console.log(`optimized median: ${percentile(optimizedTimes, 0.5).toFixed(1)}ms`);
console.log(`optimized p95: ${percentile(optimizedTimes, 0.95).toFixed(1)}ms`);
console.log(`optimized max: ${Math.max(...optimizedTimes).toFixed(1)}ms`);
console.log(`baseline avg: ${avg(baselineTimes).toFixed(1)}ms`);
console.log(`average speedup: ${(avg(baselineTimes) / avg(optimizedTimes)).toFixed(2)}x`);
