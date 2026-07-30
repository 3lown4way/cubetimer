import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { randomScrambleForEvent } from './vendor/cubing/scramble/index.js';

const scriptPath = fileURLToPath(import.meta.url);
const scrambleFile = '.benchmark-100-unique-scrambles.json';

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

async function runChild(version, mode, file) {
  const [{ cube3x3x3 }, { solve3x3StrictCfopFromPattern }] = await Promise.all([
    import('./vendor/cubing/puzzles/index.js'),
    import('./solver/cfop3x3.js'),
  ]);
  const scrambles = JSON.parse(readFileSync(file, 'utf8'));
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
      deadlineTs: Date.now() + 30000,
    });
    const elapsedMs = performance.now() - started;
    const valid = result?.ok === true && solved
      .applyAlg(scramble)
      .applyAlg(result.solution || '')
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
    rows.push({
      scramble,
      ok: valid,
      elapsedMs,
      moves: result?.moveCount ?? null,
      reason: result?.reason || null,
    });
  }

  const successes = rows.filter((row) => row.ok);
  const times = successes.map((row) => row.elapsedMs).sort((a, b) => a - b);
  const summary = {
    mode,
    version,
    success: successes.length,
    total: rows.length,
    coldMs: rows[0]?.elapsedMs ?? 0,
    avgMs: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : 0,
    medianMs: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    p99Ms: percentile(times, 0.99),
    minMs: times[0] ?? 0,
    maxMs: times.at(-1) ?? 0,
    avgMoves: successes.length
      ? successes.reduce((sum, row) => sum + Number(row.moves || 0), 0) / successes.length
      : 0,
    failures: rows.filter((row) => !row.ok),
  };
  console.log(JSON.stringify(summary));
}

if (process.argv[2] === '--child') {
  await runChild(process.argv[3] === 'v1' ? 'v1' : 'v2', process.argv[4] === 'zb' ? 'zb' : 'strict', process.argv[5]);
  process.exit(0);
}

const unique = new Set();
while (unique.size < 100) {
  unique.add((await randomScrambleForEvent('333')).toString());
}
const scrambles = [...unique];
writeFileSync(scrambleFile, JSON.stringify(scrambles, null, 2));
console.log(`Generated ${scrambles.length} unique new 3x3 scrambles.`);
console.log(`First: ${scrambles[0]}`);
console.log(`Last:  ${scrambles.at(-1)}`);

const summaries = [];
try {
  for (const mode of ['strict', 'zb']) {
    for (const version of ['v1', 'v2']) {
      const child = spawnSync(process.execPath, [scriptPath, '--child', version, mode, scrambleFile], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 3600000,
      });
      if (child.status !== 0) {
        throw new Error(`${mode}/${version} child failed: ${child.stderr || child.stdout}`);
      }
      const lines = String(child.stdout || '').trim().split(/\r?\n/).filter(Boolean);
      const summary = JSON.parse(lines.at(-1));
      summaries.push(summary);
      console.log(JSON.stringify(summary));
    }
  }
} finally {
  unlinkSync(scrambleFile);
}

for (const mode of ['strict', 'zb']) {
  const v1 = summaries.find((item) => item.mode === mode && item.version === 'v1');
  const v2 = summaries.find((item) => item.mode === mode && item.version === 'v2');
  console.log(
    `${mode.toUpperCase()} SPEEDUP ` +
    `avg=${(v1.avgMs / v2.avgMs).toFixed(2)}x ` +
    `median=${(v1.medianMs / v2.medianMs).toFixed(2)}x ` +
    `p95=${(v1.p95Ms / v2.p95Ms).toFixed(2)}x ` +
    `p99=${(v1.p99Ms / v2.p99Ms).toFixed(2)}x ` +
    `moves=${v1.avgMoves.toFixed(2)}->${v2.avgMoves.toFixed(2)} ` +
    `success=${v1.success}/${v1.total}->${v2.success}/${v2.total}`,
  );
  if (v1.failures.length) console.log(`${mode.toUpperCase()} V1 FAILURES ${JSON.stringify(v1.failures)}`);
  if (v2.failures.length) console.log(`${mode.toUpperCase()} V2 FAILURES ${JSON.stringify(v2.failures)}`);
}
