import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[2] !== '--child') {
  const diagnostic = spawnSync(
    'cargo',
    ['run', '--release', '--manifest-path', 'solver-wasm/Cargo.toml', '--bin', 'wr16_diag'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (diagnostic.stdout) process.stdout.write(diagnostic.stdout);
  if (diagnostic.stderr) process.stderr.write(diagnostic.stderr);
  if (diagnostic.status !== 0) {
    throw new Error(`WR16 diagnostic failed with status ${diagnostic.status}`);
  }
}

const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
];

async function runChild(version, mode) {
  const [{ cube3x3x3 }, { solve3x3StrictCfopFromPattern }] = await Promise.all([
    import('./vendor/cubing/puzzles/index.js'),
    import('./solver/cfop3x3.js'),
  ]);
  const kpuzzle = await cube3x3x3.kpuzzle();
  const solved = kpuzzle.defaultPattern();
  const rows = [];
  for (const scramble of scrambles) {
    const started = performance.now();
    const result = await solve3x3StrictCfopFromPattern(solved.applyAlg(scramble), {
      mode,
      solverVersion: version,
      crossColor: 'D',
      enableOllPllPrediction: false,
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + 15000,
    });
    const elapsedMs = performance.now() - started;
    const valid = result?.ok === true && solved
      .applyAlg(scramble)
      .applyAlg(result.solution || '')
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
    rows.push({
      ok: valid,
      elapsedMs,
      moves: result?.moveCount ?? null,
      reason: result?.reason || null,
    });
  }
  const successes = rows.filter((row) => row.ok);
  const summary = {
    version,
    mode,
    success: successes.length,
    total: rows.length,
    firstMs: rows[0]?.elapsedMs ?? 0,
    avgMs: successes.length
      ? successes.reduce((sum, row) => sum + row.elapsedMs, 0) / successes.length
      : 0,
    avgMoves: successes.length
      ? successes.reduce((sum, row) => sum + Number(row.moves || 0), 0) / successes.length
      : 0,
    failures: rows.filter((row) => !row.ok),
  };
  console.log(JSON.stringify(summary));
}

if (process.argv[2] === '--child') {
  await runChild(process.argv[3] === 'v1' ? 'v1' : 'v2', process.argv[4] === 'zb' ? 'zb' : 'strict');
  process.exit(0);
}

const summaries = [];
for (const mode of ['strict', 'zb']) {
  for (const version of ['v1', 'v2']) {
    const child = spawnSync(process.execPath, [scriptPath, '--child', version, mode], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120000,
    });
    if (child.status !== 0) {
      throw new Error(`${mode}/${version} child failed: ${child.stderr || child.stdout}`);
    }
    const lines = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    const summary = JSON.parse(lines[lines.length - 1]);
    summaries.push(summary);
    console.log(
      `${mode.padEnd(6)} ${version}: success=${summary.success}/${summary.total} ` +
      `first=${summary.firstMs.toFixed(1)}ms avg=${summary.avgMs.toFixed(1)}ms ` +
      `moves=${summary.avgMoves.toFixed(2)}`,
    );
    if (summary.success !== summary.total) {
      throw new Error(`${mode}/${version} correctness regression: ${JSON.stringify(summary.failures)}`);
    }
  }
}

const zbV1 = summaries.find((item) => item.mode === 'zb' && item.version === 'v1');
const zbV2 = summaries.find((item) => item.mode === 'zb' && item.version === 'v2');
if (!zbV1 || !zbV2) throw new Error('missing ZB benchmark summaries');
if (!(zbV2.firstMs < zbV1.firstMs * 0.85)) {
  throw new Error(`ZBLL v2 cold-start regression: v1=${zbV1.firstMs.toFixed(1)}ms v2=${zbV2.firstMs.toFixed(1)}ms`);
}
console.log(`ZBLL cold-start speedup: ${(zbV1.firstMs / zbV2.firstMs).toFixed(2)}x`);
