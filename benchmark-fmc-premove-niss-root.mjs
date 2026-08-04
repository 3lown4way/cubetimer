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

if (!result?.ok || !Array.isArray(result.candidates) || result.candidates.length === 0) {
  throw new Error(`FMC_ROOT_FIX_SOLVE_FAILED:${JSON.stringify(result)}`);
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

  const verification = await verifyFmcSolutionWasm(scramble, candidate.solution);
  const pipelineVerification = candidate.source.includes("PREMOVE_NISS")
    ? await verifyFmcSolutionWasm(effectiveInverseScramble, pipeline.join(" "))
    : null;
  const metadataVerification = candidate.source.includes("PREMOVE_NISS")
    ? await verifyFmcSolutionWasm(scramble, metadataFlattening)
    : null;

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
      pipelineVerification == null
        ? null
        : pipelineVerification?.ok === true && pipelineVerification.solved === true,
    metadataFlattening,
    metadataFlatteningSolved:
      metadataVerification == null
        ? null
        : metadataVerification?.ok === true && metadataVerification.solved === true,
    eoLength: Number(candidate.eoLength || 0),
    drLength: Number(candidate.drLength || 0),
    p2Length: Number(candidate.p2Length || 0),
    rzpUsed: candidate.rzpUsed === true,
  });
}

console.log(`FMC_PREMOVE_NISS_ROOT_FIXED=${JSON.stringify({ scramble, rows })}`);

const invalidCandidates = rows.filter((row) => !row.solved);
if (invalidCandidates.length > 0) {
  throw new Error(`FMC_INVALID_CANDIDATES_REMAIN:${JSON.stringify(invalidCandidates)}`);
}

const invalidPremovePipelines = rows.filter(
  (row) =>
    row.source.includes("PREMOVE_NISS") &&
    (row.pipelineSolvesEffectiveInverse !== true || row.metadataFlatteningSolved !== true),
);
if (invalidPremovePipelines.length > 0) {
  throw new Error(
    `FMC_PREMOVE_NISS_PIPELINE_INVALID:${JSON.stringify(invalidPremovePipelines)}`,
  );
}
