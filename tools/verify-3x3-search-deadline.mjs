import assert from "node:assert/strict";
import fs from "node:fs/promises";

const [minmoveSearch, lib, wasmSolver, worker, generatedWasm] = await Promise.all([
  fs.readFile("solver-wasm/src/minmove_search.rs", "utf8"),
  fs.readFile("solver-wasm/src/lib.rs", "utf8"),
  fs.readFile("solver/wasmSolver.js", "utf8"),
  fs.readFile("solver/solverWorker.js", "utf8"),
  fs.readFile("public/solver-wasm/solver_wasm.js", "utf8"),
]);

assert.match(minmoveSearch, /const DEADLINE_CHECK_INTERVAL: u64 = 2_048;/);
assert.match(minmoveSearch, /pub fn search_bound_with_deadline\(/);
assert.match(minmoveSearch, /deadline_reached\(\*nodes, deadline_ms\)/);
assert.match(minmoveSearch, /pub timed_out: bool/);

assert.match(lib, /pub fn search_minmove_bound_with_deadline\(/);
assert.match(lib, /"MINMOVE_DEADLINE_REACHED"/);
assert.match(lib, /"MINMOVE_NODE_LIMIT_REACHED"/);
assert.match(lib, /result\.timed_out/);

assert.match(wasmSolver, /search_minmove_bound_with_deadline/);
assert.match(wasmSolver, /deadlineMs = 0/);
assert.match(wasmSolver, /api\.searchMinmoveBound\(searchId, bound, maxNodes, deadlineMs\)/);

assert.match(worker, /searchMinmove333BoundLazy\(searchId, bound, maxNodes, deadlineTs = 0\)/);
assert.match(worker, /NODES_PER_BOUND,\s*exactSearchDeadlineTs,/);
assert.match(worker, /searchResult\.status === "timeout"/);
assert.match(worker, /searchResult\.reason === "MINMOVE_DEADLINE_REACHED"/);
assert.match(worker, /buildIncumbentFallbackResult\("MINMOVE_TIMEOUT"/);

assert.match(generatedWasm, /export function search_minmove_bound_with_deadline\(/);

console.log(JSON.stringify({
  ok: true,
  deadlineCheckIntervalNodes: 2048,
  wasmDeadlineExport: true,
  workerDeadlineFallback: true,
}));
