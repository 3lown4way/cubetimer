import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const scramble = "D2 F' U L B U B U' R U' R U L' D' F' U2 B2 R' F D' L";

function invertMove(move) {
  if (move.endsWith("2")) return move;
  if (move.endsWith("'")) return move.slice(0, -1);
  return `${move}'`;
}

function invertMoves(moves) {
  return [...moves].reverse().map(invertMove);
}

function tokens(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

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

const inverseScramble = invertMoves(tokens(scramble));
const rows = [];
for (const [index, candidate] of result.candidates.entries()) {
  const premoves = tokens(candidate.premoves);
  const eoMoves = tokens(candidate.eoMoves);
  const drMoves = tokens(candidate.drMoves);
  const finishMoves = tokens(candidate.finishMoves);
  const pipeline = [...eoMoves, ...drMoves, ...finishMoves];
  const effectiveInverseScramble = [...inverseScramble, ...premoves].join(" ");
  const metadataFlattening = [
    ...invertMoves(pipeline),
    ...invertMoves(premoves),
  ].join(" ");
  const oppositeMetadataFlattening = [
    ...invertMoves(premoves),
    ...invertMoves(pipeline),
  ].join(" ");

  const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
  const pipelineVerification = await verifyFmcSolutionWasm(
    effectiveInverseScramble,
    pipeline.join(" "),
  );
  const metadataVerification = await verifyFmcSolutionWasm(
    scramble,
    metadataFlattening,
  );
  const oppositeMetadataVerification = await verifyFmcSolutionWasm(
    scramble,
    oppositeMetadataFlattening,
  );

  rows.push({
    index,
    solved: verification?.ok === true && verification.solved === true,
    verification,
    solution: String(candidate.solution || ""),
    moveCount: Number(candidate.moveCount || 0),
    source: String(candidate.source || ""),
    axisName: String(candidate.axisName || ""),
    premoves: premoves.join(" "),
    eoMoves,
    drMoves,
    finishMoves,
    pipeline: pipeline.join(" "),
    pipelineSolvesEffectiveInverse:
      pipelineVerification?.ok === true && pipelineVerification.solved === true,
    pipelineVerification,
    metadataFlattening,
    metadataFlatteningSolved:
      metadataVerification?.ok === true && metadataVerification.solved === true,
    oppositeMetadataFlattening,
    oppositeMetadataFlatteningSolved:
      oppositeMetadataVerification?.ok === true && oppositeMetadataVerification.solved === true,
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
