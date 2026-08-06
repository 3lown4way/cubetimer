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
  { deadlineTs: Date.now() + 10_000 },
);

assert.equal(valid.ok, false);
assert.equal(valid.eventId, "444");
assert.equal(valid.status, "not_implemented");
assert.equal(valid.reason, "444_NOT_IMPLEMENTED");
assert.equal(valid.solution, "");
assert.equal(valid.moveCount, 0);
assert.equal(valid.verified, false);
assert.deepEqual(valid.stages, []);
assert.equal(valid.meta.scrambleValid, true);
assert.equal(valid.meta.stateValid, true);
assert.equal(valid.meta.parsedMoveCount, 6);
assert.equal(valid.meta.apiVersion, "444-boundary-v1");
assert.ok(progress.some((update) => update.type === "444_stage_start"));
assert.ok(progress.some((update) => update.type === "444_stage_update" && update.phase === "wasm_ready"));
assert.ok(progress.some((update) => update.type === "444_state_validated"));
assert.ok(progress.some((update) => update.type === "444_stage_fail" && update.reason === "444_NOT_IMPLEMENTED"));

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
assert.equal(readiness.apiVersion, "444-boundary-v1");

const workerSource = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /let solver444ModulePromise = null;/);
assert.match(workerSource, /function getSolver444Module\(\)/);
assert.match(workerSource, /async function solve444Lazy\(scramble, onProgress, options\)/);
assert.match(workerSource, /if \(normalizedEventId === "444"\)/);
assert.match(workerSource, /deadlineTs: effective444DeadlineTs/);
assert.match(workerSource, /444_BOUNDARY_TIMEOUT_MS/);

const routeStart = workerSource.indexOf('if (normalizedEventId === "444")');
const routeEnd = workerSource.indexOf('if (normalizedEventId === "333" && mode === "twophase")', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "missing isolated 4x4 route");
const routeSource = workerSource.slice(routeStart, routeEnd);
assert.doesNotMatch(routeSource, /solveWithExternalSearchLazy|fallback/i);
assert.match(routeSource, /build444WorkerFailure\("444_DEADLINE_REACHED", "timeout"/);

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

console.log("4x4 WASM and worker boundary contract passed");
