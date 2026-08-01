import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const corpus = JSON.parse(fs.readFileSync(new URL("./fmc-generalization-corpus.json", import.meta.url), "utf8"));
const profile = {
  maxPremoveSets: 24,
  searchLevel: 3,
  searchVariant: 7,
  incumbentMoveCount: 34,
  forceRzp: false,
  enableCoverageFallback: true,
  enableMultiSwitchNiss: true,
  enableDeepMultiSwitchNiss: true,
  enableHtrSkeletons: true,
  enableSliceInsertion: true,
  enableMultiInsertion: true,
};

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const rows = [];
for (const testCase of corpus.developmentCases) {
  const started = performance.now();
  const result = await solveFmcWasm(testCase.scramble, profile);
  const elapsedMs = performance.now() - started;
  if (!result?.ok || !result.solution) throw new Error(`DEV_SOLVE_FAILED:${testCase.id}`);
  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`DEV_VERIFY_FAILED:${testCase.id}`);
  }
  rows.push({
    id: testCase.id,
    known: testCase.knownMoveCount,
    found: Number(result.moveCount),
    elapsedMs: Math.round(elapsedMs),
    source: String(result.source || ""),
    solution: result.solution,
  });
}
const output = {
  averageMoves: rows.reduce((sum, row) => sum + row.found, 0) / rows.length,
  averageMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length,
  rows,
};
console.log(`SUB20_DEV ${JSON.stringify(output)}`);
