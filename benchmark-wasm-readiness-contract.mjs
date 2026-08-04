import fs from "node:fs";

const loader = fs.readFileSync("solver/wasmSolver.js", "utf8");
const fmcSolver = fs.readFileSync("solver/fmcSolver.js", "utf8");

const requiredLoaderFragments = [
  'new URL("../solver-wasm/solver_wasm.js", import.meta.url).href',
  'new URL("../solver-wasm/twophase/twophase-333-v2.bin", import.meta.url).href',
  'for (const cacheMode of ["force-cache", "reload"])',
  "if (!ready && wasmApiPromise === readyPromise)",
  "wasmApiPromise = null;",
  "if (!ready && twophase333ReadyPromise === readyPromise)",
  "twophase333ReadyPromise = null;",
  "export function getWasmSolverReadinessStatus()",
  'recordWasmFailure("twophase-bundle"',
];

for (const fragment of requiredLoaderFragments) {
  if (!loader.includes(fragment)) {
    throw new Error(`WASM_READINESS_CONTRACT_MISSING:${fragment}`);
  }
}

if (!fmcSolver.includes("getWasmSolverReadinessStatus")) {
  throw new Error("FMC_WASM_STATUS_IMPORT_MISSING");
}
if (!fmcSolver.includes("wasmReadiness: getWasmSolverReadinessStatus()")) {
  throw new Error("FMC_WASM_STATUS_DIAGNOSTIC_MISSING");
}

console.log("WASM_READINESS_RETRY_CONTRACT_OK");
