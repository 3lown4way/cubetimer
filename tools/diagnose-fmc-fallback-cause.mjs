import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const scramble = "B' D F2 R2 F R' F2 L U' B2 D' R' F2 D' F' D B R' U L B2";
const label = process.argv[2] || "profile";
const ready = await buildFmcTablesWasm();
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");

const variants = [
  { name: "base120", maxPremoveSets: 120, forceRzp: false, enableHtrSkeletons: false },
  { name: "forceRzp", maxPremoveSets: 120, forceRzp: true, enableHtrSkeletons: false },
  { name: "htr", maxPremoveSets: 120, forceRzp: false, enableHtrSkeletons: true },
  { name: "rzp+htr", maxPremoveSets: 120, forceRzp: true, enableHtrSkeletons: true },
];

const rows = [];
for (const variant of variants) {
  const started = performance.now();
  const result = await solveFmcWasm(scramble, {
    ...variant,
    enableMultiInsertion: true,
    enableSliceInsertion: true,
    enableCoverageFallback: false,
  });
  const elapsedMs = performance.now() - started;
  let verified = false;
  if (result?.ok && result.solution) {
    const check = await verifyFmcSolutionWasm(scramble, result.solution);
    verified = check?.ok === true && check.solved === true;
  }
  rows.push({
    variant: variant.name,
    ok: result?.ok === true,
    reason: String(result?.reason || ""),
    moveCount: Number(result?.moveCount || 0),
    candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
    skeletonCount: Number(result?.skeletonCount || 0),
    verified,
    elapsedMs,
  });
}
console.log(JSON.stringify({ label, scramble, rows }, null, 2));
