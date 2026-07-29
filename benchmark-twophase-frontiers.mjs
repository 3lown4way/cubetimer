import { performance } from 'node:perf_hooks';
import { cube3x3x3 } from './vendor/cubing/puzzles/index.js';
import {
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  dropTwophase333Search,
} from './solver/wasmSolver.js';

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
const frontierCounts = [1, 2, 4, 6, 12];
const avg = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const pct = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
};

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
const ready = await ensureTwophase333Ready();
if (!ready) throw new Error('TWOPHASE_UNAVAILABLE');

for (const frontiers of frontierCounts) {
  const rows = [];
  for (const scramble of scrambles) {
    let searchId = null;
    const started = performance.now();
    const prepared = await prepareTwophase333(scramble, {
      maxPhase1Solutions: frontiers,
      phase1MaxDepth: 13,
      phase1NodeLimit: 0,
    });
    const preparedAt = performance.now();
    let result = null;
    try {
      if (prepared?.ok && Number.isFinite(prepared.searchId)) {
        searchId = prepared.searchId;
        result = await searchTwophase333(searchId, {
          phase2MaxDepth: 20,
          phase2NodeLimit: 12_000_000,
        });
      }
    } finally {
      if (Number.isFinite(searchId)) await dropTwophase333Search(searchId);
    }
    const ended = performance.now();
    const valid = result?.ok === true && solved
      .applyAlg(scramble)
      .applyAlg(result.solution)
      .experimentalIsSolved({ ignorePuzzleOrientation: false });
    rows.push({
      ok: valid,
      prepareMs: preparedAt - started,
      searchMs: ended - preparedAt,
      totalMs: ended - started,
      moves: result?.moveCount ?? null,
      p1Nodes: result?.phase1Nodes ?? prepared?.phase1Nodes ?? 0,
      p2Nodes: result?.phase2Nodes ?? 0,
    });
  }
  const okRows = rows.filter((row) => row.ok);
  console.log(
    `frontiers=${String(frontiers).padStart(2)} ` +
    `success=${okRows.length}/10 ` +
    `avg=${avg(okRows.map((row) => row.totalMs)).toFixed(1)}ms ` +
    `median=${pct(okRows.map((row) => row.totalMs), 0.5).toFixed(1)}ms ` +
    `p95=${pct(okRows.map((row) => row.totalMs), 0.95).toFixed(1)}ms ` +
    `prepare=${avg(okRows.map((row) => row.prepareMs)).toFixed(1)}ms ` +
    `moves=${avg(okRows.map((row) => row.moves)).toFixed(2)} ` +
    `p1nodes=${avg(okRows.map((row) => row.p1Nodes)).toFixed(0)} ` +
    `p2nodes=${avg(okRows.map((row) => row.p2Nodes)).toFixed(0)}`,
  );
}
