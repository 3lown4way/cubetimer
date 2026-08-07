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
  { deadlineTs: Date.now() + 60_000 },
);

assert.equal(valid.ok, true);
assert.equal(valid.eventId, "444");
assert.equal(valid.status, "ok");
assert.equal(valid.reason, null);
assert.equal(typeof valid.solution, "string");
assert.ok(valid.solution.length > 0);
assert.ok(valid.moveCount > 0);
assert.equal(valid.verified, true);
assert.equal(valid.source, "WASM_444_COMPLETE");
assert.equal(valid.stages.length, 4);
assert.equal(valid.moveCount, valid.solution.split(/\s+/).filter((move) => move && !/^[xyz](?:2|')?$/i.test(move)).length);

const expectedStages = [
  ["centers", "Centers"],
  ["edges", "Edge Pairing · 3-2-3"],
  ["parity", "Parity Normalization"],
  ["threeByThree", "3x3 CFOP"],
];
for (let index = 0; index < expectedStages.length; index += 1) {
  const stage = valid.stages[index];
  assert.equal(stage.id, expectedStages[index][0]);
  assert.equal(stage.name, expectedStages[index][1]);
  assert.equal(stage.verified, true);
  assert.equal(typeof stage.solution, "string");
  assert.ok(Number.isFinite(Number(stage.moveCount)));
}
assert.equal(valid.stages[0].moveCount, valid.meta.centerMoveCount);
assert.equal(valid.stages[1].moveCount, valid.meta.edgeMoveCount);
assert.equal(valid.stages[2].moveCount, valid.meta.parityMoveCount);
assert.equal(valid.stages[3].moveCount, valid.meta.cfopMoveCount);
assert.equal(valid.meta.humanViewpointApplied, true);
assert.ok(valid.meta.viewpointRotationCount > 0);
assert.equal(valid.stages[0].method, "Cross → Opposite → Remaining 4");
assert.deepEqual(
  valid.stages[0].segments.map((stage) => stage.name),
  ["Centers · Cross Color", "Centers · Opposite", "Centers · Remaining 4"],
);
assert.ok(valid.stages[0].segments.some((stage) => /(?:^|\s)[xyz](?:2|')?(?:\s|$)/.test(stage.solution)));
assert.equal(
  valid.stages[0].segments.map((stage) => stage.solution).filter(Boolean).join(" "),
  valid.stages[0].solution,
);

const edgeStage = valid.stages[1];
assert.equal(edgeStage.method, "3-2-3");
assert.equal(valid.meta.edgeMethod, "3-2-3");
assert.equal(valid.meta.edge323Attempted, true);
assert.equal(valid.meta.edge323FallbackReason, null);
assert.ok(edgeStage.moveCount <= 80, `3-2-3 edge stage regressed to ${edgeStage.moveCount} moves`);
const edgeSegments = edgeStage.segments;
assert.ok(Array.isArray(edgeSegments) && edgeSegments.length >= 4);
assert.ok(edgeSegments.some((stage) => stage.name === "3-2-3 · First 3"));
assert.ok(edgeSegments.some((stage) => stage.name === "3-2-3 · Next 2"));
assert.equal(edgeSegments.at(-1)?.name, "3-2-3 · L2E");
assert.equal(edgeSegments.at(-1).pairEnd, 12);
assert.equal(
  edgeSegments.map((stage) => stage.solution).filter(Boolean).join(" "),
  edgeStage.solution,
);
for (let index = 1; index < edgeSegments.length; index += 1) {
  assert.ok(
    edgeSegments[index].pairEnd >= edgeSegments[index - 1].pairEnd,
    "3-2-3 setup may preserve the pair count but must never reduce it",
  );
}

const cfopSegments = valid.stages[3].segments;
assert.deepEqual(
  cfopSegments.map((stage) => stage.name),
  ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
);
assert.equal(
  cfopSegments.map((stage) => stage.solution).filter(Boolean).join(" "),
  valid.stages[3].solution,
);
assert.equal(valid.meta.cfopMethod, "CFOP");
assert.equal(valid.meta.cfopStageCount, 7);

assert.equal(valid.meta.apiVersion, "444-complete-v1");
assert.equal(valid.meta.centersSolved, true);
assert.equal(valid.meta.edgesPaired, true);
assert.equal(valid.meta.parityNormalized, true);
assert.equal(valid.meta.virtual333Ready, true);
assert.equal(valid.meta.scrambleValid, true);
assert.equal(valid.meta.stateValid, true);
assert.equal(valid.meta.parsedMoveCount, 6);
assert.equal(valid.meta.fullVerificationSolved, true);
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
for (const stage of ["CENTERS", "EDGES", "PARITY", "VIRTUAL_333", "THREE_BY_THREE", "VERIFY"]) {
  assert.ok(
    progress.some((update) => update.type === "444_stage_done" && update.stage === stage),
    `missing ${stage} completion event`,
  );
}

const invalid = await solve444("3Rw U", null, { deadlineTs: Date.now() + 10_000 });
assert.equal(invalid.ok, false);
assert.equal(invalid.status, "invalid");
assert.equal(invalid.reason, "444_INVALID_SCRAMBLE");
assert.equal(invalid.solution, "");
assert.equal(invalid.moveCount, 0);
assert.equal(invalid.verified, false);

const expired = await solve444("Rw U", null, { deadlineTs: 1 });
assert.equal(expired.ok, false);
assert.equal(expired.status, "timeout");
assert.equal(expired.reason, "444_DEADLINE_REACHED");
assert.equal(expired.solution, "");
assert.equal(expired.moveCount, 0);
assert.equal(expired.verified, false);
assert.deepEqual(expired.stages, []);

const readiness = getSolver444ReadinessStatus();
assert.equal(readiness.ready, true);
assert.equal(readiness.loading, false);
assert.equal(readiness.apiVersion, "444-complete-v1");

const workerSource = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
assert.match(workerSource, /let solver444ModulePromise = null;/);
assert.match(workerSource, /function getSolver444Module\(\)/);
assert.match(workerSource, /async function solve444Lazy\(scramble, onProgress, options\)/);
assert.match(workerSource, /if \(normalizedEventId === "444"\)/);
assert.match(workerSource, /deadlineTs: effective444DeadlineTs/);
assert.match(workerSource, /SOLVER_444_BOUNDARY_TIMEOUT_MS = 60000/);

const solveBodyStart = workerSource.indexOf("async solve(arg1");
const routeStart = workerSource.indexOf('if (normalizedEventId === "444")', solveBodyStart);
const routeEnd = workerSource.indexOf('if (normalizedEventId === "333" && mode === "twophase")', routeStart);
const firstSolveWarmup = workerSource.indexOf("startBackgroundWarmups();", solveBodyStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, "missing isolated 4x4 route");
assert.ok(
  firstSolveWarmup > routeStart && firstSolveWarmup < routeEnd,
  "4x4 must route before general background warmups",
);
const routeSource = workerSource.slice(routeStart, routeEnd);
assert.equal(
  routeSource.match(/startBackgroundWarmups\(\);/g)?.length || 0,
  1,
  "the 4x4 route must start its required tables exactly once",
);
assert.doesNotMatch(routeSource, /solveWithExternalSearchLazy|fallback/i);
assert.match(routeSource, /build444WorkerFailure\("444_DEADLINE_REACHED", "timeout"/);
assert.match(routeSource, /\^TIMEOUT_\\d\+MS\$\/\.test\(errorMessage\)/);
assert.match(
  routeSource,
  /const reason = timedOut \? "444_DEADLINE_REACHED" : "444_WORKER_FAILED"/,
);
assert.match(routeSource, /workerError: errorMessage/);

const solver444Source = fs.readFileSync(new URL("../solver/solver444.js", import.meta.url), "utf8");
assert.match(solver444Source, /solve3x3StrictCfopFromPattern/);
assert.match(solver444Source, /enableHumanViewpoint: true/);
assert.match(solver444Source, /preferHumanEdgePairing323/);
assert.match(solver444Source, /edgePairing444\.js/);
assert.match(solver444Source, /edgeMethod: "3-2-3"/);
assert.match(solver444Source, /buildEdgePairingSegments/);
assert.match(solver444Source, /verify_444_solution_json/);
assert.match(solver444Source, /444_FINAL_VERIFICATION_FAILED/);
assert.match(solver444Source, /fullVerificationSolved: true/);
assert.doesNotMatch(solver444Source, /solveTwophaseAdaptive333FromCubie|solveWithExternalSearch|reverseScramble/i);

const edge323Source = fs.readFileSync(new URL("../solver/edgePairing444.js", import.meta.url), "utf8");
assert.match(edge323Source, /solveEdgePairing323/);
assert.match(edge323Source, /3-2-3 · First 3/);
assert.match(edge323Source, /3-2-3 · Next 2/);
assert.match(edge323Source, /3-2-3 · L2E/);
assert.match(edge323Source, /L2E_ALGORITHMS_444/);

const mainSource = fs.readFileSync(new URL("../main.js", import.meta.url), "utf8");
assert.doesNotMatch(mainSource, /ensureSolver444Ready|solve444Lazy|444_NOT_IMPLEMENTED/);

for (const path of [
  "public/solver444-wasm/solver444_wasm.js",
  "public/solver444-wasm/solver444_wasm.d.ts",
  "public/solver444-wasm/solver444_wasm_bg.wasm",
  "public/solver444-wasm/solver444_wasm_bg.wasm.d.ts",
  "public/solver-wasm/solver_wasm.js",
  "public/solver-wasm/solver_wasm.d.ts",
  "public/solver-wasm/solver_wasm_bg.wasm",
  "public/solver-wasm/solver_wasm_bg.wasm.d.ts",
]) {
  assert.equal(fs.existsSync(new URL(`../${path}`, import.meta.url)), true, `missing ${path}`);
}

console.log("complete verified 4x4 WASM, 3-2-3 edge, and worker contract passed");
