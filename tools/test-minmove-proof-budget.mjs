import assert from "node:assert/strict";
import fs from "node:fs";

import { shouldRejectLiteralInverseSolution } from "../solver/inverseSolutionPolicy.js";
import { solveMinmoveExactV2 } from "../solver/minmoveExactV2.js";
import {
  ensureTwophase333Ready,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const SCRAMBLE = "F2 D U2 B2 L2 R2 U2 B' L2 F D2 B' F' U L' U' F U2 R' B";
const timeBudgetMs = Math.max(3_000, Number(process.env.MINMOVE_PROOF_TEST_BUDGET_MS) || 6_000);
const source = fs.readFileSync(new URL("../solver/minmoveExactV2.js", import.meta.url), "utf8");

assert.match(source, /const TARGET_HTM = 18;/);
assert.match(source, /const MAX_RETURN_HTM = 20;/);
assert.match(source, /DEADLINE_ONLY_EXACT_PROFILE/);
assert.match(source, /phase1NodeLimit:\s*0/);
assert.match(source, /phase2NodeLimit:\s*0/);
assert.match(source, /bestMoveCount - 1/);
assert.match(source, /maxTotalDepth:\s*searchBound === MAX_RETURN_HTM \? MAX_RETURN_HTM : searchBound/);
assert.match(source, /while \(Date\.now\(\) < globalDeadlineTs && bestMoveCount > TARGET_HTM\)/);
assert.match(source, /candidateLength > MAX_RETURN_HTM/);
assert.match(source, /MINMOVE_NO_SOLUTION_WITHIN_20/);
assert.doesNotMatch(source, /reason:\s*"MINMOVE_NOT_PROVEN"/);
assert.match(source, /fallbackReason:\s*null/);

const ready = await ensureTwophase333Ready();
assert.ok(ready, "Two-Phase WASM must be ready");

const progress = [];
const startedAt = Date.now();
const result = await solveMinmoveExactV2(
  SCRAMBLE,
  (event) => progress.push(event),
  {
    timeBudgetMs,
    exactProfiles: [
      { phase1NodeLimit: 1, phase2NodeLimit: 1 },
    ],
  },
);
const wallElapsedMs = Date.now() - startedAt;

assert.ok(wallElapsedMs <= timeBudgetMs + 5_000, "MinMove exceeded its bounded runtime envelope");
assert.equal(result?.fallbackReason ?? null, null, "MinMove must not expose a fallback");
assert.equal(result?.targetMoveCount, 18, "MinMove target must be 18 HTM");
assert.equal(result?.maxMoveCount, 20, "MinMove hard cap must be 20 HTM");

if (result?.ok) {
  assert.ok(result.solution, "successful result must contain a solution");
  assert.ok(result.moveCount >= 1 && result.moveCount <= 20, `result escaped the 20 HTM cap: ${result.moveCount}`);
  assert.equal(result.targetReached, result.moveCount <= 18, "targetReached does not match the 18 HTM target");
  assert.equal(
    shouldRejectLiteralInverseSolution(SCRAMBLE, result.solution),
    false,
    "result must not be the rejected literal inverse",
  );
  const verification = await verifyFmcSolutionWasm(SCRAMBLE, result.solution);
  assert.equal(verification?.solved, true, "returned MinMove solution is invalid");
} else {
  assert.equal(result?.reason, "MINMOVE_NO_SOLUTION_WITHIN_20", `unexpected MinMove failure: ${result?.reason}`);
  assert.equal(result?.solution, "");
  assert.equal(result?.moveCount, 0);
  assert.equal(result?.optimalityProven, false);
}

assert.ok(
  progress.some((event) => event?.targetMoveCount === 18 || event?.stageName?.includes("target 18")),
  "18 HTM target progress metadata missing",
);

console.log(JSON.stringify({
  ok: true,
  timeBudgetMs,
  wallElapsedMs,
  result: {
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? 0,
    targetMoveCount: result?.targetMoveCount ?? null,
    maxMoveCount: result?.maxMoveCount ?? null,
    targetReached: result?.targetReached === true,
    optimalityProven: result?.optimalityProven === true,
    proofAttempts: result?.proofAttempts ?? 0,
    elapsedMs: result?.elapsedMs ?? null,
    nodes: result?.nodes ?? 0,
  },
}, null, 2));
