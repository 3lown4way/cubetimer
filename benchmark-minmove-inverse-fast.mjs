import assert from "node:assert/strict";

import { solveMinmoveExactV2 } from "./solver/minmoveExactV2.js";
import {
  dropTwophase333Search,
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const cases = [
  {
    name: "realistic-wca-proof",
    scramble: "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'",
  },
  {
    name: "corpus-02",
    scramble: "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  },
  {
    name: "corpus-04",
    scramble: "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  },
  {
    name: "corpus-05",
    scramble: "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
  },
  {
    name: "corpus-07",
    scramble: "L2 D2 B2 U F2 U2 R2 D' F2 U L2 R' B2 U' F D' L B' U2",
  },
  {
    name: "corpus-09",
    scramble: "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'",
  },
];

const PROFILES = [
  { maxPhase1Solutions: 512, phase1MaxDepth: 15, phase1NodeLimit: 20_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 2_048, phase1MaxDepth: 17, phase1NodeLimit: 80_000_000, phase2NodeLimit: 100_000_000 },
  { maxPhase1Solutions: 8_192, phase1MaxDepth: 19, phase1NodeLimit: 250_000_000, phase2NodeLimit: 250_000_000 },
];

function splitMoves(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

function invertMove(move) {
  if (move.endsWith("2") || move.endsWith("2'")) return `${move[0]}2`;
  if (move.endsWith("'")) return move.slice(0, -1);
  return `${move}'`;
}

function invertAlgorithm(sequence) {
  return splitMoves(sequence).reverse().map(invertMove).join(" ");
}

async function findBroadTwophaseImprovement(scramble, incumbentLength) {
  const inverseScramble = invertAlgorithm(scramble);
  const directions = [
    { scramble, invert: false, direction: "normal" },
    { scramble: inverseScramble, invert: true, direction: "inverse" },
  ];

  for (const profile of PROFILES) {
    for (const direction of directions) {
      let searchId = null;
      try {
        const prepared = await prepareTwophase333(direction.scramble, {
          maxPhase1Solutions: profile.maxPhase1Solutions,
          phase1MaxDepth: profile.phase1MaxDepth,
          phase1NodeLimit: profile.phase1NodeLimit,
        });
        if (!prepared?.ok || !Number.isFinite(prepared.searchId)) continue;
        searchId = prepared.searchId;
        const searched = await searchTwophase333(searchId, {
          incumbentLength,
          phase2MaxDepth: 20,
          phase2NodeLimit: profile.phase2NodeLimit,
        });
        if (!searched?.ok || typeof searched.solution !== "string") continue;
        const solution = direction.invert ? invertAlgorithm(searched.solution) : searched.solution.trim();
        const moveCount = splitMoves(solution).length;
        if (!solution || moveCount >= incumbentLength) continue;
        const verification = await verifyFmcSolutionWasm(scramble, solution);
        if (verification?.solved !== true) continue;
        return {
          found: true,
          solution,
          moveCount,
          direction: direction.direction,
          profile,
          nodes: searched.nodes ?? null,
          candidateCount: searched.candidateCount ?? null,
        };
      } finally {
        if (Number.isFinite(searchId)) {
          await dropTwophase333Search(searchId);
        }
      }
    }
  }
  return { found: false };
}

assert.ok(await ensureTwophase333Ready(), "twophase tables must load");

for (const testCase of cases) {
  const exact = await solveMinmoveExactV2(testCase.scramble, null, { timeBudgetMs: 60_000 });
  assert.equal(exact?.ok, true, `${testCase.name} exact-v2 failed: ${exact?.reason || "unknown"}`);
  const inverse = invertAlgorithm(testCase.scramble);
  const literalInverse = exact.solution.trim() === inverse;
  const improvement = literalInverse
    ? await findBroadTwophaseImprovement(testCase.scramble, exact.moveCount)
    : { found: false };

  console.log(JSON.stringify({
    name: testCase.name,
    scramble: testCase.scramble,
    exactMoveCount: exact.moveCount,
    literalInverse,
    seedSource: exact.seedSource || null,
    proofSource: exact.proofSource || null,
    improvementFound: improvement.found === true,
    improvementMoveCount: improvement.moveCount ?? null,
    improvementDirection: improvement.direction ?? null,
    improvementProfile: improvement.profile ?? null,
    improvementNodes: improvement.nodes ?? null,
    improvementCandidateCount: improvement.candidateCount ?? null,
    improvementSolution: improvement.solution ?? null,
  }));

  assert.equal(
    improvement.found === true,
    false,
    `${testCase.name}: exact-v2 claimed ${exact.moveCount} HTM but broad two-phase found ${improvement.moveCount} HTM`,
  );
}

console.log("minmove inverse fast diagnostic passed");
