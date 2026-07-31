import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const corpus = JSON.parse(fs.readFileSync("tools/fmc-generalization-corpus.json", "utf8"));
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
  enableDrFlip: true,
};

if (!(await buildFmcTablesWasm())) throw new Error("FMC_TABLE_BUILD_FAILED");
const rows = [];
for (const testCase of corpus.developmentCases.slice(0, 3)) {
  const started = performance.now();
  const result = await solveFmcWasm(testCase.scramble, profile);
  const elapsedMs = Math.round(performance.now() - started);
  if (!result?.ok || !result.solution) throw new Error(`DEV_SOLVE_FAILED:${testCase.id}`);
  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) throw new Error(`DEV_INVALID:${testCase.id}`);
  rows.push({
    id: testCase.id,
    known: testCase.knownMoveCount,
    found: result.moveCount,
    elapsedMs,
    source: result.source,
    solution: result.solution,
  });
}

const output = {
  averageMoves: rows.reduce((sum, row) => sum + row.found, 0) / rows.length,
  averageMs: rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length,
  rows,
};
fs.writeFileSync(process.argv[2], `${JSON.stringify(output, null, 2)}\n`);
console.log(`SIX_FRAME_DEV ${JSON.stringify(output)}`);
