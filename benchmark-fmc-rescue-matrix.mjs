import { buildFmcTablesWasm, solveFmcWasm } from "./solver/wasmSolver.js";

const scramble = process.env.FMC_RESCUE_SCRAMBLE ||
  "B2 L2 U' R2 U' B D2 F' R' U' F' L2 F R' U2 F2 R F' R' B' R";
const maxVariant = Math.max(0, Number.parseInt(process.env.FMC_RESCUE_MAX_VARIANT || "31", 10));
const budgets = String(process.env.FMC_RESCUE_PREMOVE_SETS || "20,40")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");

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
console.log("FMC_RESCUE_MATRIX=" + JSON.stringify({
  scramble,
  successBudget,
  successCount: successes.length,
  best: successes
    .sort((left, right) => left.moveCount - right.moveCount || left.elapsedMs - right.elapsedMs)
    .slice(0, 8),
}));

if (successes.length === 0) process.exitCode = 2;
