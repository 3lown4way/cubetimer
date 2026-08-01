import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  buildFmcTablesWasm,
  solveFmcWasm,
  verifyFmcSolutionWasm,
} from "../solver/wasmSolver.js";

const corpus = JSON.parse(fs.readFileSync(new URL("./fmc-generalization-corpus.json", import.meta.url), "utf8"));
const examples = [
  {
    id: "random-example-1",
    scramble: "L2 D2 F R' F' U2 R B D2 L F U' F2 R2 U' B R B' U' B' L' U' B R' B",
  },
  {
    id: "random-example-2",
    scramble: "L2 U2 R U' F2 R' D L D2 L2 B' R' D2 F2 R' B' R2 F L F2 U B D2 B' U2",
  },
];
const cases = [...corpus.developmentCases, ...examples];
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
  const elapsedMs = performance.now() - started;
  if (!result?.ok || !result.solution) throw new Error(`SOLVE_FAILED:${testCase.id}`);
  const verification = await verifyFmcSolutionWasm(testCase.scramble, result.solution);
  if (!verification?.ok || verification.solved !== true) {
    throw new Error(`VERIFY_FAILED:${testCase.id}`);
  }
  rows.push({
    id: testCase.id,
    known: testCase.knownMoveCount ?? null,
    found: Number(result.moveCount),
    elapsedMs: Math.round(elapsedMs),
    solution: result.solution,
    source: String(result.source || ""),
    candidateCount: Number(result.candidateCount ?? result.candidates?.length ?? 0),
    skeletonCount: Number(result.skeletonCount ?? result.skeletons?.length ?? 0),
    longestRawSkeleton: Number(result.longestRawSkeleton ?? result.diagnostics?.longestRawSkeleton ?? 0),
    rawLimitIndependentFromFinalBest:
      result.rawLimitIndependentFromFinalBest ??
      result.diagnostics?.rawLimitIndependentFromFinalBest ??
      null,
  });
}
console.log(`RAW_FRONTIER_DEV ${JSON.stringify({ rows })}`);
