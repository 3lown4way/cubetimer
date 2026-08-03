import assert from "node:assert/strict";
import {
  dropMinmove333Search,
  ensureMinmove333Ready,
  prepareMinmove333,
  searchMinmove333Bound,
} from "./solver/wasmSolver.js";

const scramble = "R U R' U'";
const ready = await ensureMinmove333Ready();
assert.ok(ready, "minmove WASM tables must load");

const prepared = await prepareMinmove333(scramble);
assert.equal(prepared?.ok, true, prepared?.reason || "prepare_minmove_333 failed");
assert.ok(Number.isFinite(prepared.searchId));
assert.ok(Number.isFinite(prepared.lowerBound));

let found = null;
try {
  for (let bound = prepared.lowerBound; bound <= 4; bound += 1) {
    const result = await searchMinmove333Bound(prepared.searchId, bound, 0);
    assert.equal(result?.ok, true, result?.reason || `bound ${bound} failed`);
    if (result.status === "found") {
      found = result;
      break;
    }
    assert.equal(result.status, "exhausted", `bound ${bound} must be proven exhausted`);
  }
} finally {
  await dropMinmove333Search(prepared.searchId);
}

assert.ok(found, "R U R' U' must be solved within 4 HTM");
assert.equal(found.moveCount, 4);
assert.equal(found.bound, 4);
assert.ok(String(found.solution || "").trim());
console.log(`minmove HTM smoke: ${found.solution} (${found.moveCount} HTM)`);
