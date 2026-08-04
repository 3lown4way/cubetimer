import assert from "node:assert/strict";

import {
  dropMinmove333Search,
  ensureMinmove333Ready,
  prepareMinmove333,
  searchMinmove333Bound,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const scramble = "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'";
const knownOptimum = 18;

const loadStarted = performance.now();
const ready = await ensureMinmove333Ready();
const loadMs = Math.round(performance.now() - loadStarted);
assert.ok(ready, "minmove PDB tables must load");

const prepared = await prepareMinmove333(scramble);
assert.equal(prepared?.ok, true, prepared?.reason || "prepare_minmove_333 failed");
assert.ok(Number.isFinite(prepared.searchId), "missing search id");
assert.ok(Number.isFinite(prepared.lowerBound), "missing lower bound");

const rows = [];
let found = null;
try {
  for (let bound = prepared.lowerBound; bound <= knownOptimum; bound += 1) {
    const started = performance.now();
    const result = await searchMinmove333Bound(prepared.searchId, bound, 0);
    const elapsedMs = Math.round(performance.now() - started);
    assert.equal(result?.ok, true, result?.reason || `bound ${bound} failed`);
    rows.push({
      bound,
      status: result.status,
      moveCount: result.moveCount,
      nodes: result.nodes,
      elapsedMs,
    });
    console.log(JSON.stringify(rows.at(-1)));
    if (result.status === "found") {
      found = result;
      break;
    }
    assert.equal(result.status, "exhausted", `bound ${bound} must be exhausted or found`);
  }
} finally {
  await dropMinmove333Search(prepared.searchId);
}

assert.ok(found, `PDB exact search did not find the known ${knownOptimum}-HTM solution`);
assert.equal(found.moveCount, knownOptimum, "PDB exact search returned an unexpected optimum");
const verification = await verifyFmcSolutionWasm(scramble, found.solution);
assert.equal(verification?.solved, true, "PDB exact solution does not solve the scramble");

console.log(JSON.stringify({
  summary: true,
  loadMs,
  lowerBound: prepared.lowerBound,
  reverseDepth: prepared.reverseDepth,
  reverseStates: prepared.reverseStates,
  totalSearchMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0),
  totalNodes: rows.reduce((sum, row) => sum + Number(row.nodes || 0), 0),
  moveCount: found.moveCount,
  solution: found.solution,
}));
