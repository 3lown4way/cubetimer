#!/usr/bin/env node
import { solveWithFMCSearch } from "../solver/fmcSolver.js";
import { verifyFmcSolutionWasm } from "../solver/wasmSolver.js";

const SCRAMBLES = [
  "R B2 U' L2 D L2 F2 U' B2 F2 L2 F D F2 L B U' B' D' R2",
  "U2 B2 L2 D F2 R2 B2 U' R2 U L' U2 R' D2 F U2 L' B U R2",
  "R2 U F2 D' B2 R2 D2 L2 U F2 U2 L U' B' R' U2 L2 D' B2 U",
  "L2 U2 B2 D' F2 R' F2 U2 L B2 U' R2 F D2 R' U L2 B' D R2",
  "F2 U' R2 D2 B2 L2 U F2 R' U2 L2 D' B U' R B2 L' D F' U2",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stageByName(stages, name) {
  return Array.isArray(stages) ? stages.find((stage) => stage?.name === name) : null;
}

async function main() {
  for (let i = 0; i < SCRAMBLES.length; i += 1) {
    const scramble = SCRAMBLES[i];
    const result = await solveWithFMCSearch(scramble);

    assert(result?.ok === true, `Case ${i + 1}: expected ok=true, got ok=${result?.ok}`);
    assert(Array.isArray(result?.candidates), `Case ${i + 1}: expected candidates array`);

    const verify = await verifyFmcSolutionWasm(scramble, result.solution);
    assert(verify?.ok === true && verify?.solved === true, `Case ${i + 1}: final solution did not verify as solved`);

    const candidates = result.candidates;
    const stages = Array.isArray(result.stages) ? result.stages : [];
    const selectedCandidate = candidates.find((candidate) => candidate?.solution === result.solution) || null;
    if (selectedCandidate?.rzpUsed === true) {
      const drStage = stageByName(stages, "DR");
      assert(drStage, `Case ${i + 1}: expected DR stage when RZP candidate exists`);
      assert(
        typeof drStage.notes === "string" && drStage.notes.includes("RZP"),
        `Case ${i + 1}: expected DR stage notes to include RZP`
      );
    }

    if (
      selectedCandidate?.mode === "skeleton_insertion" &&
      Array.isArray(selectedCandidate?.skeletonMoves) && selectedCandidate.skeletonMoves.length > 0 &&
      Array.isArray(selectedCandidate?.insertionMoves) && selectedCandidate.insertionMoves.length > 0
    ) {
      const skeletonStage = stageByName(stages, "Skeleton");
      const insertionMovesStage = stageByName(stages, "Insertion Moves");
      const insertionSummaryStage = stageByName(stages, "Insertion Summary");
      assert(skeletonStage, `Case ${i + 1}: expected Skeleton stage for skeleton_insertion metadata`);
      assert(insertionMovesStage, `Case ${i + 1}: expected Insertion Moves stage for skeleton_insertion metadata`);
      assert(insertionSummaryStage, `Case ${i + 1}: expected Insertion Summary stage for skeleton_insertion metadata`);
    }
  }

  console.log(`Hybrid e2e ok (${SCRAMBLES.length} scrambles)`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
