import assert from "node:assert/strict";
import {
  dropMinmove333Search,
  ensureMinmove333Ready,
  prepareMinmove333,
  searchMinmove333Bound,
} from "./solver/wasmSolver.js";

const cases = [
  ["four-move", "R U R' U'", 4],
  ["realistic-wca", "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'", 19],
  ["corpus-01", "R U R' U' R' F R2 U' R' U' R U R' F'", 11],
  ["corpus-02", "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'", 20],
  ["corpus-03", "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D", 17],
  ["corpus-04", "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F", 19],
  ["corpus-05", "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U", 19],
  ["corpus-06", "R2 U2 B2 L2 F2 D' F2 L2 B2 U' R2 F' U L' B' D2 R U' F", 18],
  ["corpus-07", "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2", 19],
  ["corpus-08", "U' L2 B2 R2 D F2 D2 R2 B2 U' F2 L' B U2 R D' F' R2 U", 15],
  ["corpus-09", "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'", 19],
  ["corpus-10", "D B2 R2 F2 U' L2 U B2 L2 D2 F2 R' D' L U2 B' R2 F U'", 19],
];

const loadStarted = performance.now();
const ready = await ensureMinmove333Ready();
const loadMs = performance.now() - loadStarted;
assert.ok(ready, "PDB minmove tables must load");
console.log(JSON.stringify({ type: "load", loadMs: Math.round(loadMs) }));

const rows = [];
for (const [name, scramble, optimum] of cases) {
  const started = performance.now();
  const prepared = await prepareMinmove333(scramble);
  assert.equal(prepared?.ok, true, `${name}: ${prepared?.reason || "prepare failed"}`);
  let nodes = 0;
  let exhaustedBounds = 0;
  try {
    for (let bound = prepared.lowerBound; bound < optimum; bound += 1) {
      const result = await searchMinmove333Bound(prepared.searchId, bound, 0);
      assert.equal(result?.ok, true, `${name}: bound ${bound} failed`);
      assert.equal(result.status, "exhausted", `${name}: found a solution below known optimum ${optimum}`);
      nodes += Number(result.nodes || 0);
      exhaustedBounds += 1;
    }
  } finally {
    await dropMinmove333Search(prepared.searchId);
  }
  const elapsedMs = performance.now() - started;
  const row = {
    name,
    optimum,
    lowerBound: prepared.lowerBound,
    exhaustedBounds,
    nodes,
    elapsedMs: Math.round(elapsedMs),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const sorted = rows.map((row) => row.elapsedMs).sort((a, b) => a - b);
const avg = rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length;
const median = sorted[Math.floor((sorted.length - 1) / 2)];
const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
console.log(JSON.stringify({
  type: "summary",
  cases: rows.length,
  loadMs: Math.round(loadMs),
  warmAverageMs: Math.round(avg),
  warmMedianMs: median,
  warmP95Ms: p95,
  warmMaxMs: sorted.at(-1),
  totalNodes: rows.reduce((sum, row) => sum + row.nodes, 0),
}));
