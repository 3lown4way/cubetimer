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
const proofBound = knownOptimum - 1;

const loadStarted = performance.now();
const ready = await ensureMinmove333Ready();
const loadMs = Math.round(performance.now() - loadStarted);
assert.ok(ready, "minmove PDB tables must load");

const prepared = await prepareMinmove333(scramble);
assert.equal(prepared?.ok, true, prepared?.reason || "prepare_minmove_333 failed");
assert.ok(Number.isFinite(prepared.searchId), "missing search id");
assert.ok(Number.isFinite(prepared.lowerBound), "missing lower bound");
assert.ok(prepared.lowerBound <= proofBound, "heuristic lower bound exceeds the known proof bound");

let proof = null;
let found = null;
try {
  const proofStarted = performance.now();
  proof = await searchMinmove333Bound(prepared.searchId, proofBound, 0);
  const proofElapsedMs = Math.round(performance.now() - proofStarted);
  assert.equal(proof?.ok, true, proof?.reason || `bound ${proofBound} failed`);
  assert.equal(proof.status, "exhausted", `bound ${proofBound} must prove every shorter depth impossible`);
  console.log(JSON.stringify({
    type: "proof",
    bound: proofBound,
    status: proof.status,
    nodes: proof.nodes,
    elapsedMs: proofElapsedMs,
  }));

  const findStarted = performance.now();
  found = await searchMinmove333Bound(prepared.searchId, knownOptimum, 0);
  const findElapsedMs = Math.round(performance.now() - findStarted);
  assert.equal(found?.ok, true, found?.reason || `bound ${knownOptimum} failed`);
  assert.equal(found.status, "found", `bound ${knownOptimum} must find the known optimum`);
  assert.equal(found.moveCount, knownOptimum, "PDB exact search returned an unexpected optimum");
  console.log(JSON.stringify({
    type: "find",
    bound: knownOptimum,
    status: found.status,
    moveCount: found.moveCount,
    nodes: found.nodes,
    elapsedMs: findElapsedMs,
  }));
} finally {
  await dropMinmove333Search(prepared.searchId);
}

const verification = await verifyFmcSolutionWasm(scramble, found.solution);
assert.equal(verification?.solved, true, "PDB exact solution does not solve the scramble");

console.log(JSON.stringify({
  summary: true,
  loadMs,
  lowerBound: prepared.lowerBound,
  reverseDepth: prepared.reverseDepth,
  reverseStates: prepared.reverseStates,
  proofBound,
  proofNodes: Number(proof?.nodes || 0),
  findNodes: Number(found?.nodes || 0),
  moveCount: found.moveCount,
  solution: found.solution,
}));
