#!/usr/bin/env node
import { rankFmcCandidatesForTest } from "../solver/fmcSolver.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const rankedByMoveCount = rankFmcCandidatesForTest([
    { source: "FMC_EO_UD", mode: "solved_finish", solution: "A", moveCount: 22, cancellationCount: 3 },
    { source: "FMC_SKELETON", mode: "skeleton_insertion", solution: "B", moveCount: 21, cancellationCount: 0 },
  ]);
  assert(rankedByMoveCount[0]?.solution === "B", "Expected 21-move candidate to rank ahead of 22-move candidate");

  const rankedByCancellation = rankFmcCandidatesForTest([
    { source: "FMC_EO_UD", mode: "solved_finish", solution: "C", moveCount: 21, cancellationCount: 1 },
    { source: "FMC_SKELETON", mode: "skeleton_insertion", solution: "D", moveCount: 21, cancellationCount: 4 },
  ]);
  assert(rankedByCancellation[0]?.solution === "D", "Expected higher cancellationCount to break move-count ties");

  const rankedWithExplicitZeroCancellation = rankFmcCandidatesForTest([
    {
      source: "FMC_EO_UD",
      mode: "solved_finish",
      solution: "E",
      moveCount: 21,
      cancellationCount: 0,
      cancellationPotential: 5,
    },
    {
      source: "FMC_SKELETON",
      mode: "skeleton_insertion",
      solution: "F",
      moveCount: 21,
      cancellationCount: 1,
      cancellationPotential: 0,
    },
  ]);
  assert(
    rankedWithExplicitZeroCancellation[0]?.solution === "F",
    "Expected explicit zero cancellationCount to be used instead of cancellationPotential fallback"
  );

  console.log("Ranking regression ok");
}

main();
