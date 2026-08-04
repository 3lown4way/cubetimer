import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const scramble = "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L";

const ready = await buildFmcTablesWasm();
if (!ready) throw new Error("FMC_TABLE_BUILD_FAILED");

const result = await solveFmcWasm(scramble, {
  maxPremoveSets: 120,
  forceRzp: false,
  enableMultiInsertion: false,
  enableHtrSkeletons: false,
  enableSliceInsertion: false,
  enableMultiSwitchNiss: false,
  enableDeepMultiSwitchNiss: false,
  searchLevel: 3,
  searchVariant: 0,
  incumbentMoveCount: 40,
});

if (!result?.ok || !Array.isArray(result.candidates)) {
  throw new Error(`FMC_DIAGNOSTIC_SOLVE_FAILED:${JSON.stringify(result)}`);
}

const rows = [];
for (const [index, candidate] of result.candidates.entries()) {
  const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
  rows.push({
    index,
    solved: verification?.ok === true && verification.solved === true,
    verification,
    solution: String(candidate.solution || ""),
    moveCount: Number(candidate.moveCount || 0),
    source: String(candidate.source || ""),
    axisName: String(candidate.axisName || ""),
    premoves: String(candidate.premoves || ""),
    eoMoves: Array.isArray(candidate.eoMoves) ? candidate.eoMoves : [],
    drMoves: Array.isArray(candidate.drMoves) ? candidate.drMoves : [],
    finishMoves: Array.isArray(candidate.finishMoves) ? candidate.finishMoves : [],
    eoLength: Number(candidate.eoLength || 0),
    drLength: Number(candidate.drLength || 0),
    p2Length: Number(candidate.p2Length || 0),
    rzpUsed: candidate.rzpUsed === true,
  });
}

console.log(`FMC_PREMOVE_NISS_ROOT=${JSON.stringify({ scramble, rows })}`);

const invalidPremoveNiss = rows.filter(
  (row) => !row.solved && row.source.includes("PREMOVE_NISS"),
);
if (invalidPremoveNiss.length === 0) {
  throw new Error("FMC_PREMOVE_NISS_BUG_NOT_REPRODUCED");
}
