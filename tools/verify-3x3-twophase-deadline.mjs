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
requireText(minmove, "DEADLINE_ONLY_EXACT_PROFILE", "Full-budget exact profile");
requireText(minmove, "phase1NodeLimit: 0", "Unlimited phase-one deadline profile");
requireText(minmove, "phase2NodeLimit: 0", "Unlimited phase-two deadline profile");
requireText(minmove, "deadlineTs: globalDeadlineTs", "MinMove full-budget deadline propagation");
requireText(minmove, "while (Date.now() < globalDeadlineTs && bestMoveCount > TARGET_HTM)", "MinMove improvement loop");
requireText(minmove, "const TARGET_HTM = 18;", "MinMove target contract");
requireText(minmove, "const MAX_RETURN_HTM = 20;", "MinMove hard-cap contract");
requireText(minmove, "candidateLength > MAX_RETURN_HTM", "MinMove candidate cap enforcement");
requireText(minmove, 'failureResult("MINMOVE_NO_SOLUTION_WITHIN_20"', "MinMove capped failure contract");
requireText(minmove, 'solution: ""', "MinMove failure empty solution");
requireText(generated, "search_twophase_exact_333", "Generated WASM exact API");

if (minmove.includes('reason: "MINMOVE_NOT_PROVEN"')) {
  throw new Error("MinMove still exposes the removed proof-only rejection contract");
}
if (minmove.includes("inverseUpperBoundLength + Math.max")) {
  throw new Error("MinMove still contains an above-20 relaxed ceiling path");
}

console.log("3x3 Two-Phase deadlines and MinMove full-budget 18-target/20-cap contract verified");
