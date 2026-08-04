import fs from "node:fs";

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  return source.replace(before, after);
}

const wasmPath = "solver/wasmSolver.js";
let wasm = fs.readFileSync(wasmPath, "utf8");
wasm = replaceRequired(
  wasm,
  `    if (lastResult.reason !== "TWOPHASE_NO_IMPROVING_SOLUTION") break;`,
  `    if (!["TWOPHASE_NO_IMPROVING_SOLUTION", "PHASE2_NOT_FOUND"].includes(lastResult.reason)) break;`,
  "adaptive continuation reasons",
);
fs.writeFileSync(wasmPath, wasm);

const workerPath = "solver/solverWorker.js";
let worker = fs.readFileSync(workerPath, "utf8");
worker = replaceRequired(
  worker,
  `            incumbentLength:
              inverseLength > 0 ? inverseLength + (noFallback ? 1 : 0) : undefined,
            excludedSolution: noFallback ? inverseSolution : undefined,
            strictIncumbent: noFallback,`,
  `            incumbentLength: inverseLength > 0 ? inverseLength : undefined,
            excludedSolution: noFallback ? inverseSolution : undefined,
            strictIncumbent: false,`,
  "worker exact-inverse exclusion options",
);
fs.writeFileSync(workerPath, worker);

const benchmarkPath = "benchmark-twophase-nontrivial-reliability.mjs";
let benchmark = fs.readFileSync(benchmarkPath, "utf8");
benchmark = replaceRequired(
  benchmark,
  `      incumbentLength: 21,
      excludedSolution: inverse,
      strictIncumbent: true,`,
  `      incumbentLength: 20,
      excludedSolution: inverse,
      strictIncumbent: false,`,
  "benchmark exact-inverse exclusion options",
);
fs.writeFileSync(benchmarkPath, benchmark);

console.log("Adjusted two-phase contract to exclude only the exact inverse path");
