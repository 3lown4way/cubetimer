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

assert.match(source, /DEADLINE_ONLY_EXACT_PROFILE/);
assert.match(source, /phase1NodeLimit:\s*0/);
assert.match(source, /phase2NodeLimit:\s*0/);
assert.match(source, /useFullProofBudget\s*=\s*options\.useFullProofBudget\s*!==\s*false/);
assert.match(source, /solution:\s*""/);
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
const deadlineProfileStarts = progress.filter(
  (event) => event?.type === "proof_profile_start" && event.deadlineOnly === true,
);

assert.ok(deadlineProfileStarts.length >= 1, "deadline-only proof profile was not attempted");
assert.ok(Number(result?.proofAttempts) >= 2, "staged and deadline-only profiles were not both attempted");
assert.equal(result?.fallbackReason ?? null, null, "Minmove must not expose a fallback");

if (result?.ok) {
  assert.equal(result.optimalityProven, true, "successful Minmove result must be proven");
  assert.ok(result.solution, "proven result must contain a solution");
  assert.equal(
    shouldRejectLiteralInverseSolution(SCRAMBLE, result.solution),
    false,
    "proven result must not be the rejected literal inverse",
  );
  const verification = await verifyFmcSolutionWasm(SCRAMBLE, result.solution);
  assert.equal(verification?.solved, true, "proven solution is invalid");
} else {
  assert.equal(result?.reason, "MINMOVE_NOT_PROVEN");
  assert.equal(result?.solution, "");
  assert.equal(result?.moveCount, 0);
  assert.equal(result?.optimalityProven, false);
  assert.equal(result?.budgetExhausted, true, "unproven result must consume the proof budget");
  assert.ok(
    ["TWOPHASE_DEADLINE_REACHED", "MINMOVE_EXACT_TIMEOUT"].includes(result?.interruptedReason),
    `unexpected interruption reason: ${result?.interruptedReason}`,
  );
  assert.ok(
    Number(result?.elapsedMs) >= timeBudgetMs - 1_000,
    `solver returned too early: ${result?.elapsedMs}ms for ${timeBudgetMs}ms budget`,
  );
  assert.ok(
    wallElapsedMs >= timeBudgetMs - 1_000,
    `wall clock returned too early: ${wallElapsedMs}ms for ${timeBudgetMs}ms budget`,
  );
  if (result?.candidateSolution) {
    assert.equal(
      shouldRejectLiteralInverseSolution(SCRAMBLE, result.candidateSolution),
      false,
      "diagnostic candidate must not be the rejected literal inverse",
    );
    const verification = await verifyFmcSolutionWasm(SCRAMBLE, result.candidateSolution);
    assert.equal(verification?.solved, true, "diagnostic candidate is invalid");
  }
}

console.log(JSON.stringify({
  ok: true,
  timeBudgetMs,
  wallElapsedMs,
  result: {
    ok: result?.ok === true,
    reason: result?.reason || null,
    moveCount: result?.moveCount ?? 0,
    candidateMoveCount: result?.candidateMoveCount ?? null,
    optimalityProven: result?.optimalityProven === true,
    proofAttempts: result?.proofAttempts ?? 0,
    interruptedReason: result?.interruptedReason || null,
    budgetExhausted: result?.budgetExhausted === true,
    elapsedMs: result?.elapsedMs ?? null,
    nodes: result?.nodes ?? 0,
  },
  deadlineProfileAttempts: deadlineProfileStarts.length,
}, null, 2));
