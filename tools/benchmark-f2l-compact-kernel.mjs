import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { cube3x3x3 } from '../vendor/cubing/puzzles/index.js';
import { solve3x3StrictCfopFromPattern } from '../solver/cfop3x3.js';

const solverSource = fs.readFileSync(new URL('../solver/cfop3x3.js', import.meta.url), 'utf8');
const kernelVersion = solverSource.includes('F2L_COMPACT_KERNEL_VERSION = 2') ? 2 : 1;

const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
  "R2 F2 U2 B2 R2 F2 D' L2 D2 B2 U' R' F D2 B' R2 F2 U' L'",
  "D F2 R2 U2 B2 D2 B2 U' L2 B2 R D' L F' R' D L2 U' F",
  "B U2 F2 R2 B2 U2 R2 D' L2 B2 L' B2 U R D2 L F2 U' B'",
  "U' F2 D2 B2 L2 F2 R2 U2 B2 R2 D R' F U2 L' B D2 R U'",
  "R' U2 R2 F2 U' B2 D2 R2 U B2 D' F' L U2 R' F2 D B' L",
];

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const summaries = [];

for (const mode of ['strict', 'zb']) {
  const rows = [];
  for (const scramble of scrambles) {
    const pattern = solved.applyAlg(scramble);
    const started = performance.now();
    const result = await solve3x3StrictCfopFromPattern(pattern, {
      mode,
      solverVersion: 'v2',
      crossColor: 'D',
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + 15000,
    });
    const elapsedMs = performance.now() - started;
    const valid = result?.ok === true && pattern
      .applyAlg(result.solution || '')
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
    const f2lStage = Array.isArray(result?.stageDiagnostics)
      ? result.stageDiagnostics.find((entry) => entry.stageName === 'F2L')
      : null;
    rows.push({
      valid,
      elapsedMs,
      f2lMs: Number(f2lStage?.elapsedMs || 0),
      f2lNodes: Number(f2lStage?.nodes || 0),
      f2lMethod: f2lStage?.method || null,
      f2lMetrics: f2lStage?.metrics || null,
      moves: Number(result?.moveCount || 0),
      reason: result?.reason || null,
    });
  }

  const validRows = rows.filter((row) => row.valid);
  const warmRows = validRows.slice(1);
  const average = (items, key) => items.length
    ? items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length
    : 0;
  summaries.push({
    mode,
    success: validRows.length,
    total: rows.length,
    coldTotalMs: validRows[0]?.elapsedMs || 0,
    coldF2lMs: validRows[0]?.f2lMs || 0,
    warmTotalAvgMs: average(warmRows, 'elapsedMs'),
    warmF2lAvgMs: average(warmRows, 'f2lMs'),
    warmF2lAvgNodes: average(warmRows, 'f2lNodes'),
    avgMoves: average(validRows, 'moves'),
    methods: [...new Set(validRows.map((row) => row.f2lMethod))],
    transpositionHits: validRows.reduce(
      (sum, row) => sum + Number(row.f2lMetrics?.compactTranspositionHits || 0),
      0,
    ),
    failures: rows.filter((row) => !row.valid),
  });
}

const payload = {
  marker: 'f2l-compact-kernel',
  kernelVersion,
  summaries,
};
console.log(JSON.stringify(payload));
