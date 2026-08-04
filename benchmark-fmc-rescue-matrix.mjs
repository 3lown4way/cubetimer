import { buildFmcTablesWasm, solveFmcWasm } from "./solver/wasmSolver.js";

const defaultScrambles = [
  "R' B2 R U F D B' R2 U2 B' U2 R' F' D R F2 L' F' R2 F2 L'",
  "L D2 R2 B' D' F R D2 R' U' F U2 F R2 F2 R2 D2 R' F U2 F",
];
let scrambles = defaultScrambles;
if (process.env.FMC_RESCUE_SCRAMBLES_JSON) {
  const parsed = JSON.parse(process.env.FMC_RESCUE_SCRAMBLES_JSON);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("FMC_RESCUE_SCRAMBLES_JSON must be a non-empty array");
  }
  scrambles = parsed.map(String);
} else if (process.env.FMC_RESCUE_SCRAMBLE) {
  scrambles = [String(process.env.FMC_RESCUE_SCRAMBLE)];
}

const maxVariant = Math.max(0, Number.parseInt(process.env.FMC_RESCUE_MAX_VARIANT || "31", 10));
const budgets = String(process.env.FMC_RESCUE_PREMOVE_SETS || "20,40")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");

const matrices = [];
for (let scrambleIndex = 0; scrambleIndex < scrambles.length; scrambleIndex += 1) {
  const scramble = scrambles[scrambleIndex];
  const rows = [];
  let successBudget = null;
  for (const maxPremoveSets of budgets) {
    let successCount = 0;
    for (let searchVariant = 0; searchVariant <= maxVariant; searchVariant += 1) {
      const startedAt = performance.now();
      const result = await solveFmcWasm(scramble, {
        maxPremoveSets,
        forceRzp: false,
        searchLevel: 3,
        searchVariant,
      });
      const row = {
        scrambleIndex,
        maxPremoveSets,
        searchVariant,
        elapsedMs: performance.now() - startedAt,
        ok: result?.ok === true,
        reason: result?.reason || null,
        moveCount: Number(result?.moveCount || 0),
        candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
        invalidCandidateCount: Number(result?.invalidCandidateCount || 0),
        candidates: Array.isArray(result?.candidates)
          ? result.candidates.slice(0, 3).map((candidate) => ({
              moveCount: Number(candidate?.moveCount || 0),
              source: String(candidate?.source || ""),
              premoves: String(candidate?.premoves || ""),
              premoveIndex: Number.isFinite(candidate?.premoveIndex) ? candidate.premoveIndex : null,
            }))
          : [],
      };
      rows.push(row);
      console.log("FMC_RESCUE_CASE=" + JSON.stringify(row));
      if (row.ok) successCount += 1;
    }
    if (successCount > 0) {
      successBudget = maxPremoveSets;
      break;
    }
  }

  const successes = rows.filter((row) => row.ok);
  const matrix = {
    scrambleIndex,
    scramble,
    successBudget,
    successCount: successes.length,
    successfulVariants: successes.map((row) => row.searchVariant),
    best: successes
      .sort((left, right) => left.moveCount - right.moveCount || left.elapsedMs - right.elapsedMs)
      .slice(0, 8),
  };
  matrices.push(matrix);
  console.log("FMC_RESCUE_MATRIX=" + JSON.stringify(matrix));
}

console.log("FMC_RESCUE_MATRICES=" + JSON.stringify(matrices));
if (matrices.some((matrix) => matrix.successCount === 0)) process.exitCode = 2;
