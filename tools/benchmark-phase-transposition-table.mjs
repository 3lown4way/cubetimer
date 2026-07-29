import { performance } from 'node:perf_hooks';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { cube3x3x3 } from '../vendor/cubing/puzzles/index.js';
import { parsePatternToCoords3x3 } from '../solver/solver3x3Phase/state3x3.js';
import { buildPhase1Input, solvePhase1 } from '../solver/solver3x3Phase/phase1.js';

const SCRAMBLES = [
  "R U R' U' R' F R2 U' R' U' R U R' F'",
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "R2 U2 B2 L2 F2 D' F2 L2 B2 U' R2 F' U L' B' D2 R U' F",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
  "U' L2 B2 R2 D F2 D2 R2 B2 U' F2 L' B U2 R D' F' R2 U",
];
const ROUNDS = 2;

const avg = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
};
const mib = (bytes) => bytes / (1024 * 1024);

// Build a benchmark-only copy that always enters the JavaScript Phase 2 fallback.
const here = dirname(fileURLToPath(import.meta.url));
const phase2SourcePath = join(here, '../solver/solver3x3Phase/phase2.js');
const phase2BenchPath = join(here, `../solver/solver3x3Phase/.phase2-tt-bench-${process.pid}.mjs`);
const phase2Source = await readFile(phase2SourcePath, 'utf8');
const phase2BenchSource = phase2Source.replace(
  'import { solvePhase2Direct as wasmSolvePhase2 } from "../wasmSolver.js";',
  'const wasmSolvePhase2 = async () => null;',
);
if (phase2BenchSource === phase2Source) throw new Error('PHASE2_WASM_IMPORT_ANCHOR_NOT_FOUND');
await writeFile(phase2BenchPath, phase2BenchSource, 'utf8');

let phase2Module;
try {
  phase2Module = await import(`${pathToFileURL(phase2BenchPath).href}?run=${Date.now()}`);
} catch (error) {
  await unlink(phase2BenchPath).catch(() => {});
  throw error;
}
const { buildPhase2Input, solvePhase2 } = phase2Module;

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const patterns = SCRAMBLES.map((scramble) => ({ scramble, pattern: solved.applyAlg(scramble) }));

async function solveOne({ scramble, pattern }) {
  const phase1Started = performance.now();
  const coords = parsePatternToCoords3x3(pattern);
  const phase1 = await solvePhase1(buildPhase1Input(coords, {
    phase1MaxDepth: 13,
    phase1NodeLimit: 0,
  }));
  const phase1Ended = performance.now();
  if (!phase1.ok) {
    return { ok: false, scramble, reason: phase1.reason, p1Ms: phase1Ended - phase1Started };
  }

  const afterPhase1 = pattern.applyAlg(phase1.moves.join(' '));
  const phase2Started = performance.now();
  const phase2 = await solvePhase2(buildPhase2Input(afterPhase1, {
    phase2MaxDepth: 20,
    phase2NodeLimit: 12_000_000,
  }));
  const phase2Ended = performance.now();
  if (!phase2.ok) {
    return {
      ok: false,
      scramble,
      reason: phase2.reason,
      p1Ms: phase1Ended - phase1Started,
      p2Ms: phase2Ended - phase2Started,
      p1Nodes: phase1.nodes || 0,
      p2Nodes: phase2.nodes || 0,
    };
  }

  const moves = phase1.moves.concat(phase2.moves);
  const valid = pattern
    .applyAlg(moves.join(' '))
    .experimentalIsSolved({ ignorePuzzleOrientation: false });
  return {
    ok: valid,
    scramble,
    reason: valid ? null : 'INVALID_SOLUTION',
    p1Ms: phase1Ended - phase1Started,
    p2Ms: phase2Ended - phase2Started,
    totalMs: phase2Ended - phase1Started,
    p1Nodes: phase1.nodes || 0,
    p2Nodes: phase2.nodes || 0,
    moves: moves.length,
  };
}

try {
  // Initializes move/pruning tables and the Phase 2 reverse frontier outside timing.
  const warmup = await solveOne(patterns[0]);
  if (!warmup.ok) throw new Error(`WARMUP_FAILED:${warmup.reason}`);
  if (globalThis.gc) globalThis.gc();

  const memoryBefore = process.memoryUsage();
  const rows = [];
  for (let round = 0; round < ROUNDS; round++) {
    for (const entry of patterns) rows.push(await solveOne(entry));
  }
  if (globalThis.gc) globalThis.gc();
  const memoryAfter = process.memoryUsage();

  const okRows = rows.filter((row) => row.ok);
  const summary = {
    success: okRows.length,
    total: rows.length,
    p1AvgMs: avg(okRows.map((row) => row.p1Ms)),
    p2AvgMs: avg(okRows.map((row) => row.p2Ms)),
    totalAvgMs: avg(okRows.map((row) => row.totalMs)),
    totalP95Ms: percentile(okRows.map((row) => row.totalMs), 0.95),
    p1NodesAvg: avg(okRows.map((row) => row.p1Nodes)),
    p2NodesAvg: avg(okRows.map((row) => row.p2Nodes)),
    movesAvg: avg(okRows.map((row) => row.moves)),
    memory: {
      rssBeforeMiB: mib(memoryBefore.rss),
      rssAfterMiB: mib(memoryAfter.rss),
      heapUsedBeforeMiB: mib(memoryBefore.heapUsed),
      heapUsedAfterMiB: mib(memoryAfter.heapUsed),
      arrayBuffersBeforeMiB: mib(memoryBefore.arrayBuffers || 0),
      arrayBuffersAfterMiB: mib(memoryAfter.arrayBuffers || 0),
    },
    failures: rows.filter((row) => !row.ok).map(({ scramble, reason }) => ({ scramble, reason })),
  };
  console.log(JSON.stringify(summary));
} finally {
  await unlink(phase2BenchPath).catch(() => {});
}
