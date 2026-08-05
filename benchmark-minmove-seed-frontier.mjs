import assert from "node:assert/strict";

import {
  dropTwophase333Search,
  ensureTwophase333Ready,
  prepareTwophase333,
  searchTwophase333,
  searchTwophaseExact333,
  verifyFmcSolutionWasm,
} from "./solver/wasmSolver.js";

const scramble = "F R2 U' B2 D2 F2 U R2 U2 L2 D' B' R' U2 L F D R2 U'";
const incumbentLength = 19;
const profiles = [
  { maxPhase1Solutions: 96, phase1MaxDepth: 15, phase1NodeLimit: 2_000_000, phase2NodeLimit: 12_000_000 },
  { maxPhase1Solutions: 384, phase1MaxDepth: 18, phase1NodeLimit: 8_000_000, phase2NodeLimit: 40_000_000 },
  { maxPhase1Solutions: 2_048, phase1MaxDepth: 18, phase1NodeLimit: 80_000_000, phase2NodeLimit: 100_000_000 },
  { maxPhase1Solutions: 8_192, phase1MaxDepth: 19, phase1NodeLimit: 250_000_000, phase2NodeLimit: 250_000_000 },
];

const ready = await ensureTwophase333Ready();
assert.ok(ready, "twophase v3 tables must load");

const rows = [];
for (const profile of profiles) {
  const startedAt = performance.now();
  let searchId = null;
  try {
    const prepared = await prepareTwophase333(scramble, {
      maxPhase1Solutions: profile.maxPhase1Solutions,
      phase1MaxDepth: profile.phase1MaxDepth,
      phase1NodeLimit: profile.phase1NodeLimit,
    });
    assert.equal(prepared?.ok, true, prepared?.reason || "prepare failed");
    searchId = prepared.searchId;
    const searched = await searchTwophase333(searchId, {
      incumbentLength,
      phase2MaxDepth: 20,
      phase2NodeLimit: profile.phase2NodeLimit,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const solution = searched?.ok ? String(searched.solution || "").trim() : "";
    const verification = solution
      ? await verifyFmcSolutionWasm(scramble, solution)
      : null;
    const row = {
      type: "seed",
      maxPhase1Solutions: profile.maxPhase1Solutions,
      phase1MaxDepth: profile.phase1MaxDepth,
      preparedCandidateCount: prepared.candidateCount,
      phase1Depth: prepared.phase1Depth,
      phase1Nodes: prepared.phase1Nodes,
      ok: searched?.ok === true,
      reason: searched?.reason || null,
      moveCount: searched?.moveCount ?? null,
      totalNodes: searched?.nodes ?? null,
      phase2Nodes: searched?.phase2Nodes ?? null,
      elapsedMs,
      solved: verification?.solved === true,
      solution,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  } finally {
    if (Number.isFinite(searchId)) await dropTwophase333Search(searchId);
  }
}

const improving = rows.filter((row) => row.ok && row.solved && row.moveCount < incumbentLength);
console.log(JSON.stringify({
  type: "seed-summary",
  profiles: rows.length,
  firstImprovingFrontier: improving[0]?.maxPhase1Solutions ?? null,
  bestMoveCount: improving.length ? Math.min(...improving.map((row) => row.moveCount)) : null,
}));

const proofScramble = "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'";
const proofBound = 18;
const exactProfiles = [
  { phase1NodeLimit: 64_000_000, phase2NodeLimit: 512_000_000 },
  { phase1NodeLimit: 128_000_000, phase2NodeLimit: 1_000_000_000 },
  { phase1NodeLimit: 256_000_000, phase2NodeLimit: 2_000_000_000 },
];

for (const profile of exactProfiles) {
  const startedAt = performance.now();
  const searched = await searchTwophaseExact333(proofScramble, {
    maxTotalDepth: proofBound,
    phase1NodeLimit: profile.phase1NodeLimit,
    phase2NodeLimit: profile.phase2NodeLimit,
  });
  const row = {
    type: "exact-profile",
    phase1NodeLimit: profile.phase1NodeLimit,
    phase2NodeLimit: profile.phase2NodeLimit,
    status: searched?.status || null,
    ok: searched?.ok === true,
    reason: searched?.reason || null,
    moveCount: searched?.moveCount ?? null,
    phase1Nodes: searched?.phase1Nodes ?? null,
    phase2Nodes: searched?.phase2Nodes ?? null,
    totalNodes: searched?.nodes ?? null,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
  console.log(JSON.stringify(row));
  if (row.status === "found" || row.status === "exhausted") break;
}
