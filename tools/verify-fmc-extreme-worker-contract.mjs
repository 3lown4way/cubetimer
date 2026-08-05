import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { normalizeFmcHybridCandidate } from "../solver/fmcExtremeHybrid.js";

const worker = await fs.readFile(new URL("../solver/solverWorker.js", import.meta.url), "utf8");

assert.match(worker, /async function solveWithFmcExtremeHybridLazy\(/);
assert.equal(
  (worker.match(/\? solveWithFmcExtremeHybridLazy\(scramble, onProgress/g) || []).length,
  2,
  "Both worker solve entry points must route Extreme FMC through the hybrid solver",
);
assert.equal(
  (worker.match(/isExtremeFmc\s*\n\s*\? 120000/g) || []).length,
  2,
  "Extreme FMC must receive the full 120 second profile budget",
);
assert.equal(
  (worker.match(/const fmcTimeoutMs = isExtremeFmc/g) || []).length,
  2,
  "Extreme FMC timeout must include completion headroom",
);
assert.doesNotMatch(
  worker,
  /isExtremeFmc\s*\n\s*\? 90000/,
  "The timer must not keep the obsolete 90 second Extreme budget",
);

const targetMissCandidate = normalizeFmcHybridCandidate({
  ok: false,
  reason: "FMC_EXTREME_TARGET_NOT_REACHED",
  bestHumanSolution: "R U R' U' F2",
  bestHumanMoveCount: 22,
  bestHumanSource: "FMC_WASM",
  bestHumanStages: [{ name: "FMC Best", solution: "R U R' U' F2" }],
}, "progressive-frontier");

assert.equal(targetMissCandidate?.moveCount, 22);
assert.equal(targetMissCandidate?.solution, "R U R' U' F2");

console.log(JSON.stringify({
  ok: true,
  workerExtremeRoutes: 2,
  extremeBudgetMs: 120000,
  targetMissRecovered: true,
}));
