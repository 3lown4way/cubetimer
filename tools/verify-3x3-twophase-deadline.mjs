import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`${label}: missing ${JSON.stringify(text)}`);
  }
}

const rust = read("solver-wasm/src/twophase_search.rs");
const lib = read("solver-wasm/src/lib.rs");
const wasmSolver = read("solver/wasmSolver.js");
const minmove = read("solver/minmoveExactV2.js");
const generated = read("public/solver-wasm/solver_wasm.js");

requireText(rust, 'TWOPHASE_DEADLINE_REASON: &str = "TWOPHASE_DEADLINE_REACHED"', "Rust deadline reason");
requireText(rust, 'rename = "deadlineTs"', "Rust deadline options");
requireText(rust, "DEADLINE_CHECK_MASK", "Rust periodic checks");
requireText(rust, "activate_twophase_deadline", "Rust deadline guard");
requireText(lib, "activate_twophase_deadline(options.deadline_ts)", "WASM deadline activation");
requireText(lib, 'result.reason == "TWOPHASE_DEADLINE_REACHED"', "WASM timeout status");
requireText(wasmSolver, 'status === "timeout"', "JS timeout normalization");
requireText(wasmSolver, "...(deadlineTs !== null ? { deadlineTs } : {})", "Adaptive deadline propagation");
requireText(minmove, "deadlineTs,", "Exact minmove deadline propagation");
requireText(minmove, 'reason: "MINMOVE_NOT_PROVEN"', "No-fallback result contract");
requireText(minmove, 'solution: ""', "No-fallback empty solution");
requireText(generated, "search_twophase_exact_333", "Generated WASM exact API");

const notProvenStart = minmove.indexOf("function notProvenResult");
const solveStart = minmove.indexOf("export async function solveMinmoveExactV2");
if (notProvenStart < 0 || solveStart <= notProvenStart) {
  throw new Error("No-fallback helper boundaries missing");
}
const notProvenBody = minmove.slice(notProvenStart, solveStart);
if (!notProvenBody.includes("ok: false") || !notProvenBody.includes('solution: ""')) {
  throw new Error("Minmove no-fallback contract changed");
}
if (notProvenBody.includes("solution: candidateSolution")) {
  throw new Error("Candidate solution must not be returned as a successful solution");
}

console.log("3x3 Two-Phase deadline and no-fallback contract verified");
