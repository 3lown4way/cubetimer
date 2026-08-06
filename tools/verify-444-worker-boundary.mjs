import assert from "node:assert/strict";
import fs from "node:fs";

import {
  getSolver444ReadinessStatus,
  solve444,
} from "../solver/solver444.js";

const progress = [];
const valid = await solve444(
  "Rw U2 F' Lw D B2",
  (update) => progress.push(update),
  { deadlineTs: Date.now() + 30_000 },
);

assert.equal(valid.ok, false);
assert.equal(valid.eventId, "444");
assert.equal(valid.status, "partial");
assert.equal(valid.reason, "444_REDUCTION_INCOMPLETE");
assert.equal(valid.solution, "");
assert.equal(valid.moveCount, 0);
assert.equal(valid.verified, false);
assert.equal(valid.stages.length, 3);

assert.equal(valid.stages[0].id, "centers");
assert.equal(valid.stages[0].name, "Centers");
assert.equal(valid.stages[0].verified, true);
assert.equal(valid.stages[0].moveCount, valid.meta.centerMoveCount);

assert.equal(valid.stages[1].id, "edges");
assert.equal(valid.stages[1].name, "Edge Pairing");
assert.equal(valid.stages[1].verified, true);
assert.equal(valid.stages[1].moveCount, valid.meta.edgeMoveCount);

assert.equal(valid.stages[2].id, "parity");
assert.equal(valid.stages[2].name, "Parity Normalization");
assert.equal(valid.stages[2].verified, true);
assert.equal(valid.stages[2].moveCount, valid.meta.parityMoveCount);

assert.equal(valid.meta.centersSolved, true);
assert.equal(valid.meta.edgesPaired, true);
assert.equal(valid.meta.parityNormalized, true);
assert.equal(valid.meta.virtual333Ready, true);
assert.equal(valid.meta.scrambleValid, true);
assert.equal(valid.meta.stateValid, true);
assert.equal(valid.meta.parsedMoveCount, 6);
assert.equal(valid.meta.apiVersion, "444-reduction-v1");
assert.equal(typeof valid.meta.ollParityDetected, "boolean");
assert.equal(typeof valid.meta.pllParityDetected, "boolean");
assert.deepEqual(Object.keys(valid.meta.virtual333).sort(), ["co", "cp", "eo", "ep"]);
assert.equal(valid.meta.virtual333.cp.length, 8);
assert.equal(valid.meta.virtual333.co.length, 8);
assert.equal(valid.meta.virtual333.ep.length, 12);
assert.equal(valid.meta.virtual333.eo.length, 12);

assert.ok(progress.some((update) => update.type === "444_stage_start"));
assert.ok(progress.some((update) => update.type === "444_stage_update" && update.phase === "wasm_ready"));
assert.ok(progress.some((update) => update.type === "444_state_validated"));
assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "CENTERS"));
assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "EDGES"));
assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "PARITY"));
assert.ok(progress.some((update) => update.type === "444_stage_done" && update.stage === "VIRTUAL_333"));
assert.ok(progress.some((update) => update.type === "444_stage_update" && update.stage === "REDUCTION" && update.reason === "444_REDUCTION_INCOMPLETE"));

const invalid = await solve444("3Rw U", null, { deadlineTs: Date.now() + 10_000 });
assert.equal(invalid.ok, false);
assert.equal(invalid.status, "invalid");
assert.equal(invalid.reason, "444_INVALID_SCRAMBLE");
assert.equal(invalid.solution, "");
assert.equal(invalid.moveCount, 0);

const expired = await solve444("Rw U", null, { deadlineTs: 1 });
assert.equal(expired.ok, false);
assert.equal(expired.status, "timeout");
assert.equal(expired.reason, "444_DEADLINE_REACHED");
assert.equal(expired.solution, "");
assert.equal(expired.moveCount, 0);
assert.deepEqual(expired.stages, []);

const readiness = getSolver444ReadinessStatus();
assert.equal(readiness.ready, true);
assert.equal(readiness.loading, false);
assert.equal(readiness.apiVersion, "444-reduction-v1");

const workerSource = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /let solver444ModulePromise = null;/);
assert.match(workerSource, /function getSolver444Module\(\)/);
assert.match(workerSource, /async function solve444Lazy\(scramble, onProgress, options\)/);
assert.match(workerSource, /if \(normalizedEventId === "444"\)/);
assert.match(workerSource, /deadlineTs: effective444DeadlineTs/);
assert.match(workerSource, /444_BOUNDARY_TIMEOUT_MS/);

const solveBodyStart = workerSource.indexOf("async solve(arg1");
const routeStart = workerSource.indexOf('if (normalizedEventId === "444")', solveBodyStart);
const routeEnd = workerSource.indexOf('if (normalizedEventId === "333" && mode === "twophase")', routeStart);
const firstSolveWarmup = workerSource.indexOf("startBackgroundWarmups();", solveBodyStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "missing isolated 4x4 route");
assert.ok(
  firstSolveWarmup > routeStart && firstSolveWarmup < routeEnd,
  "4x4 must route before 3x3 background warmups",
);
const routeSource = workerSource.slice(routeStart, routeEnd);
assert.equal(
  routeSource.match(/startBackgroundWarmups\(\);/g)?.length || 0,
  1,
  "non-4x4 warmups must start exactly once after the 4x4 return path",
);
assert.doesNotMatch(routeSource, /solveWithExternalSearchLazy|fallback/i);
assert.match(routeSource, /build444WorkerFailure\("444_DEADLINE_REACHED", "timeout"/);
assert.match(routeSource, /\^TIMEOUT_\\d\+MS\$\/\.test\(errorMessage\)/);
assert.match(
  routeSource,
  /const reason = timedOut \? "444_DEADLINE_REACHED" : "444_WORKER_FAILED"/,
);
assert.match(routeSource, /workerError: errorMessage/);

const mainSource = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8");
assert.doesNotMatch(mainSource, /ensureSolver444Ready|solve444Lazy|444_NOT_IMPLEMENTED/);

for (const path of [
  "public/solver444-wasm/solver444_wasm.js",
  "public/solver444-wasm/solver444_wasm.d.ts",
  "public/solver444-wasm/solver444_wasm_bg.wasm",
  "public/solver444-wasm/solver444_wasm_bg.wasm.d.ts",
]) {
  assert.equal(fs.existsSync(new URL(`../${path}`, import.meta.url)), true, `missing ${path}`);
}

console.log("4x4 parity-normalized WASM and worker boundary contract passed");
