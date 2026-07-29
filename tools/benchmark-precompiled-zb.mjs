import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const scriptPath = fileURLToPath(import.meta.url);
const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
  "R2 F2 U2 B2 R2 F2 D' L2 D2 B2 U' R' F D2 B' R2 F2 U' L'",
  "D F2 R2 U2 B2 D2 B2 U' L2 B2 R D' L F' R' D L2 U' F",
  "B U2 F2 R2 B2 U2 R2 D' L2 B2 L' B2 U R D2 L F2 U' B'",
];

async function runChild() {
  const [{ cube3x3x3 }, { solve3x3StrictCfopFromPattern }] = await Promise.all([
    import('../vendor/cubing/puzzles/index.js'),
    import('../solver/cfop3x3.js'),
  ]);
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const rows = [];
  for (const scramble of scrambles) {
    const pattern = solved.applyAlg(scramble);
    const started = performance.now();
    const result = await solve3x3StrictCfopFromPattern(pattern, {
      mode: 'zb',
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
    const zbls = result?.stageDiagnostics?.find((stage) => stage.stageName === 'ZBLS');
    const zbll = result?.stageDiagnostics?.find((stage) => stage.stageName === 'ZBLL');
    rows.push({
      valid,
      elapsedMs,
      zblsMs: Number(zbls?.elapsedMs || 0),
      zbllMs: Number(zbll?.elapsedMs || 0),
      zblsBuildMs: Number(zbls?.metrics?.libraryBuildMs || 0),
      zbllBuildMs: Number(zbll?.metrics?.libraryBuildMs || 0),
      moves: Number(result?.moveCount || 0),
      reason: result?.reason || null,
    });
  }
  const validRows = rows.filter((row) => row.valid);
  const warmRows = validRows.slice(1);
  const avg = (items, field) => items.length
    ? items.reduce((sum, row) => sum + Number(row[field] || 0), 0) / items.length
    : 0;
  console.log(JSON.stringify({
    success: validRows.length,
    total: rows.length,
    firstMs: validRows[0]?.elapsedMs || 0,
    firstZblsMs: validRows[0]?.zblsMs || 0,
    firstZbllMs: validRows[0]?.zbllMs || 0,
    firstZblsBuildMs: validRows[0]?.zblsBuildMs || 0,
    firstZbllBuildMs: validRows[0]?.zbllBuildMs || 0,
    warmAvgMs: avg(warmRows, 'elapsedMs'),
    warmZblsAvgMs: avg(warmRows, 'zblsMs'),
    warmZbllAvgMs: avg(warmRows, 'zbllMs'),
    avgMoves: avg(validRows, 'moves'),
    failures: rows.filter((row) => !row.valid),
  }));
}

if (process.argv.includes('--child')) {
  await runChild();
  process.exit(0);
}

const child = spawnSync(process.execPath, [scriptPath, '--child'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 120000,
});
if (child.status !== 0) {
  throw new Error(child.stderr || child.stdout || 'precompiled ZB benchmark child failed');
}
const lines = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
console.log(lines[lines.length - 1]);
