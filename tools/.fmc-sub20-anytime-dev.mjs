import { performance } from "node:perf_hooks";
import fs from "node:fs";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const corpus = JSON.parse(fs.readFileSync(new URL("./fmc-generalization-corpus.json", import.meta.url), "utf8"));
const cases = [
  ...corpus.developmentCases,
  {
    id: "random-example-1",
    knownMoveCount: null,
    scramble: "L2 D2 F R' F' U2 R B D2 L F U' F2 R2 U' B R B' U' B' L' U' B R' B",
  },
  {
    id: "random-example-2",
    knownMoveCount: null,
    scramble: "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2",
  },
];
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
for (const testCase of cases) {
  const started = performance.now();
  const result = await solveFmcWasm(testCase.scramble, profile);
  const elapsedMs = Math.round(performance.now() - started);
  if (!result?.ok || !result.solution) throw new Error(`SOLVE_FAILED:${testCase.id}`);
  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) throw new Error(`VERIFY_FAILED:${testCase.id}`);
  const row = { id: testCase.id, known: testCase.knownMoveCount, found: Number(result.moveCount), elapsedMs, solution: result.solution };
  rows.push(row);
  console.log(`FMC_SUB20_ANYTIME_ROW ${JSON.stringify(row)}`);
}
console.log(`FMC_SUB20_ANYTIME_SUMMARY ${JSON.stringify({ rows })}`);
