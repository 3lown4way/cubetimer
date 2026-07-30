import { performance } from 'node:perf_hooks';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cube3x3x3 } from '../vendor/cubing/puzzles/index.js';

if (process.argv.length < 3) {
  throw new Error('usage: benchmark-wasm-search-hotpath.mjs MODULE_DIR');
}

const moduleDir = resolve(process.argv[2]);
const jsPath = join(moduleDir, 'solver_wasm.js');
const wasmPath = join(moduleDir, 'solver_wasm_bg.wasm');
const moduleUrl = `${pathToFileURL(jsPath).href}?run=${Date.now()}`;
const mod = await import(moduleUrl);
const wasmBytes = await readFile(wasmPath);
if (typeof mod.initSync === 'function') {
  mod.initSync({ module: wasmBytes });
} else if (typeof mod.default === 'function') {
  await mod.default(wasmBytes);
}

if (typeof mod.load_twophase_333_bundle !== 'function') {
  throw new Error('TWOPHASE_WASM_API_MISSING');
}
const bundle = new Uint8Array(await readFile('public/solver-wasm/twophase/twophase-333-v1.bin'));
mod.load_twophase_333_bundle(bundle);
if (typeof mod.warm_twophase_333 === 'function') mod.warm_twophase_333();

const SCRAMBLES = [
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
const ROUNDS = 3;
const PREPARE_OPTIONS = JSON.stringify({
  maxPhase1Solutions: 2,
  phase1MaxDepth: 13,
  phase1NodeLimit: 0,
});
const SEARCH_OPTIONS = JSON.stringify({
  phase2MaxDepth: 20,
  phase2NodeLimit: 12_000_000,
});

const avg = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
};
const parse = (raw) => {
  try { return JSON.parse(String(raw || '')); } catch { return null; }
};

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();

async function solveOne(scramble) {
  const started = performance.now();
  const prepared = parse(mod.prepare_twophase_333(scramble, PREPARE_OPTIONS));
  const preparedAt = performance.now();
  let result = null;
  const searchId = Number(prepared?.searchId);
  try {
    if (prepared?.ok && Number.isFinite(searchId)) {
      result = parse(mod.search_twophase_333(searchId, SEARCH_OPTIONS));
    }
  } finally {
    if (Number.isFinite(searchId) && typeof mod.drop_twophase_search === 'function') {
      mod.drop_twophase_search(searchId);
    }
  }
  const ended = performance.now();
  const valid = result?.ok === true && solved
    .applyAlg(scramble)
    .applyAlg(result.solution || '')
    .experimentalIsSolved({ ignorePuzzleOrientation: false });
  return {
    ok: valid,
    reason: valid ? null : (result?.reason || prepared?.reason || 'INVALID_SOLUTION'),
    prepareMs: preparedAt - started,
    searchMs: ended - preparedAt,
    totalMs: ended - started,
    moves: Number(result?.moveCount ?? 0),
    phase1Nodes: Number(result?.phase1Nodes ?? prepared?.phase1Nodes ?? 0),
    phase2Nodes: Number(result?.phase2Nodes ?? 0),
  };
}

const warmup = await solveOne(SCRAMBLES[0]);
if (!warmup.ok) throw new Error(`WARMUP_FAILED:${warmup.reason}`);
if (globalThis.gc) globalThis.gc();
const memoryBefore = process.memoryUsage();
const rows = [];
for (let round = 0; round < ROUNDS; round++) {
  for (const scramble of SCRAMBLES) rows.push(await solveOne(scramble));
}
if (globalThis.gc) globalThis.gc();
const memoryAfter = process.memoryUsage();
const okRows = rows.filter((row) => row.ok);
const wasmStat = await stat(wasmPath);

console.log(JSON.stringify({
  success: okRows.length,
  total: rows.length,
  prepareAvgMs: avg(okRows.map((row) => row.prepareMs)),
  searchAvgMs: avg(okRows.map((row) => row.searchMs)),
  totalAvgMs: avg(okRows.map((row) => row.totalMs)),
  totalMedianMs: percentile(okRows.map((row) => row.totalMs), 0.5),
  totalP95Ms: percentile(okRows.map((row) => row.totalMs), 0.95),
  movesAvg: avg(okRows.map((row) => row.moves)),
  phase1NodesAvg: avg(okRows.map((row) => row.phase1Nodes)),
  phase2NodesAvg: avg(okRows.map((row) => row.phase2Nodes)),
  wasmBytes: wasmStat.size,
  heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
  arrayBufferDeltaBytes: (memoryAfter.arrayBuffers || 0) - (memoryBefore.arrayBuffers || 0),
  failures: rows.filter((row) => !row.ok).map(({ reason }) => reason),
}));
