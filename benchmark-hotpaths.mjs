import { performance } from 'node:perf_hooks';
import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import {
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  dropTwophase333Search,
} from './solver/wasmSolver.js';
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from './solver/cfop3x3.js';

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

const average = (values) => values.length
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0;
const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const moveCount = (alg) => String(alg || '').trim().split(/\s+/).filter(Boolean).length;

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

async function verify(scramble, solution) {
  try {
    return solved
      .applyAlg(scramble)
      .applyAlg(solution)
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
  } catch {
    return false;
  }
}

async function benchmarkTwoPhase() {
  console.log('=== 2-PHASE 10-run benchmark ===');
  const readyStarted = performance.now();
  const ready = await ensureTwophase333Ready();
  const readyMs = performance.now() - readyStarted;
  if (!ready) {
    console.log(`backend unavailable after ${readyMs.toFixed(1)}ms`);
    return;
  }
  console.log(`bundle/init: ${readyMs.toFixed(1)}ms`);

  const rows = [];
  for (let i = 0; i < scrambles.length; i += 1) {
    const scramble = scrambles[i];
    let searchId = null;
    const started = performance.now();
    const prepared = await prepareTwophase333(scramble, {
      maxPhase1Solutions: 2,
      phase1MaxDepth: 13,
      phase1NodeLimit: 4_000_000,
    });
    const preparedAt = performance.now();
    let searched = null;
    try {
      if (prepared?.ok && Number.isFinite(prepared.searchId)) {
        searchId = prepared.searchId;
        searched = await searchTwophase333(searchId, {
          phase2MaxDepth: 20,
          phase2NodeLimit: 12_000_000,
        });
      }
    } finally {
      if (Number.isFinite(searchId)) await dropTwophase333Search(searchId);
    }
    const ended = performance.now();
    const valid = searched?.ok === true && await verify(scramble, searched.solution);
    const row = {
      run: i + 1,
      ok: valid,
      prepareMs: preparedAt - started,
      searchMs: ended - preparedAt,
      totalMs: ended - started,
      moves: searched?.moveCount ?? null,
      phase1Depth: searched?.phase1Depth ?? null,
      phase2Depth: searched?.phase2Depth ?? null,
      candidates: searched?.candidateCount ?? prepared?.candidateCount ?? null,
      phase1Nodes: searched?.phase1Nodes ?? prepared?.phase1Nodes ?? null,
      phase2Nodes: searched?.phase2Nodes ?? null,
      reason: searched?.reason || prepared?.reason || null,
    };
    rows.push(row);
    console.log(
      `#${String(row.run).padStart(2, '0')} ok=${row.ok ? 'Y' : 'N'} ` +
      `total=${row.totalMs.toFixed(1).padStart(8)}ms ` +
      `prepare=${row.prepareMs.toFixed(1).padStart(7)}ms ` +
      `search=${row.searchMs.toFixed(1).padStart(8)}ms ` +
      `moves=${String(row.moves ?? '?').padStart(2)} ` +
      `p1=${String(row.phase1Depth ?? '?').padStart(2)} ` +
      `p2=${String(row.phase2Depth ?? '?').padStart(2)} ` +
      `cand=${String(row.candidates ?? '?').padStart(2)} ` +
      `p1nodes=${String(row.phase1Nodes ?? '?').padStart(9)} ` +
      `p2nodes=${String(row.phase2Nodes ?? '?').padStart(10)} ` +
      `${row.reason ? `reason=${row.reason}` : ''}`,
    );
  }
  const successes = rows.filter((row) => row.ok);
  const times = successes.map((row) => row.totalMs);
  console.log('--- 2-phase summary ---');
  console.log(`success: ${successes.length}/${rows.length}`);
  console.log(`avg: ${average(times).toFixed(1)}ms`);
  console.log(`median: ${percentile(times, 0.5).toFixed(1)}ms`);
  console.log(`p95: ${percentile(times, 0.95).toFixed(1)}ms`);
  console.log(`avg moves: ${average(successes.map((row) => row.moves)).toFixed(2)}`);
  console.log(`avg phase2 nodes: ${average(successes.map((row) => row.phase2Nodes || 0)).toFixed(0)}`);
}

function stageTiming(result) {
  if (!Array.isArray(result?.stageDiagnostics)) return '';
  return result.stageDiagnostics
    .filter((stage) => Number.isFinite(stage?.elapsedMs))
    .map((stage) => `${stage.stageName || stage.name || '?'}=${Math.round(stage.elapsedMs)}ms`)
    .join(',');
}

async function benchmarkZb() {
  console.log('=== ZB/ZBLL 10-run benchmark ===');
  await prewarm3x3StrictCfopLibraries();

  const coldPattern = solved.applyAlg(scrambles[0]);
  const coldStarted = performance.now();
  const cold = await solve3x3StrictCfopFromPattern(coldPattern, {
    mode: 'zb',
    crossColor: 'D',
    allowRelaxedSearch: false,
    deadlineTs: Date.now() + 15_000,
  });
  const coldMs = performance.now() - coldStarted;
  console.log(`cold: ok=${cold?.ok === true ? 'Y' : 'N'} ${coldMs.toFixed(1)}ms reason=${cold?.reason || '-'} stages=${stageTiming(cold)}`);

  const rows = [];
  for (let i = 0; i < scrambles.length; i += 1) {
    const pattern = solved.applyAlg(scrambles[i]);
    const started = performance.now();
    const result = await solve3x3StrictCfopFromPattern(pattern, {
      mode: 'zb',
      crossColor: 'D',
      allowRelaxedSearch: false,
      deadlineTs: Date.now() + 15_000,
    });
    const elapsed = performance.now() - started;
    const valid = result?.ok === true && await verify(scrambles[i], result.solution);
    const row = {
      run: i + 1,
      ok: valid,
      elapsed,
      moves: result?.moveCount ?? moveCount(result?.solution),
      nodes: result?.nodes ?? null,
      reason: result?.reason || null,
      stage: result?.stage || null,
      timing: stageTiming(result),
    };
    rows.push(row);
    console.log(
      `#${String(row.run).padStart(2, '0')} ok=${row.ok ? 'Y' : 'N'} ` +
      `time=${row.elapsed.toFixed(1).padStart(8)}ms moves=${String(row.moves ?? '?').padStart(2)} ` +
      `nodes=${String(row.nodes ?? '?').padStart(10)} ` +
      `${row.reason ? `reason=${row.reason} stage=${row.stage || '-'}` : ''} ` +
      `stages=${row.timing}`,
    );
  }
  const successes = rows.filter((row) => row.ok);
  const times = successes.map((row) => row.elapsed);
  console.log('--- ZB summary ---');
  console.log(`success: ${successes.length}/${rows.length}`);
  console.log(`avg: ${average(times).toFixed(1)}ms`);
  console.log(`median: ${percentile(times, 0.5).toFixed(1)}ms`);
  console.log(`p95: ${percentile(times, 0.95).toFixed(1)}ms`);
  console.log(`avg moves: ${average(successes.map((row) => row.moves)).toFixed(2)}`);
}

await benchmarkTwoPhase();
await benchmarkZb();
