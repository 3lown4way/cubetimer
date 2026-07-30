// Verifies the exact startup-resident paths used by the solver worker.
import { getDefaultPattern } from "../solver/context.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "../solver/cfop3x3.js";
import { prewarm3x3RouxV2 } from "../solver/roux3x3v2.js";

const PREWARM_SCRAMBLE = "U2 L' F' R U' F2 L D L2 F' B R2 F' U2 R2 F' U2 F U'";
const startedAt = performance.now();

const rouxStartedAt = performance.now();
const rouxPromise = prewarm3x3RouxV2().then(() => ({
  ok: true,
  elapsedMs: performance.now() - rouxStartedAt,
}));

await Promise.all([
  prewarm3x3StrictCfopLibraries({
    solverVersion: "v1",
    includeF2L: true,
    includeSingleStage: true,
  }),
  prewarm3x3StrictCfopLibraries({
    solverVersion: "v2",
    includeF2L: true,
    includeSingleStage: true,
  }),
]);

const solved = await getDefaultPattern("333");
const pattern = solved.applyAlg(PREWARM_SCRAMBLE);
const results = [];
for (const entry of [
  { mode: "strict", solverVersion: "v2" },
  { mode: "zb", solverVersion: "v2" },
  { mode: "strict", solverVersion: "v1" },
  { mode: "zb", solverVersion: "v1" },
]) {
  const solveStartedAt = performance.now();
  const result = await solve3x3StrictCfopFromPattern(pattern, {
    mode: entry.mode,
    solverVersion: entry.solverVersion,
    scramble: PREWARM_SCRAMBLE,
    crossColor: "D",
    f2lMethod: "legacy",
    enableMixedCfopStages: false,
    enableOllPllPrediction: false,
    allowRelaxedSearch: false,
  });
  let valid = false;
  try {
    valid = result?.ok === true
      && pattern.applyAlg(result.solution).isIdentical(solved);
  } catch {
    valid = false;
  }
  results.push({
    ...entry,
    ok: valid,
    elapsedMs: performance.now() - solveStartedAt,
    moveCount: result?.moveCount ?? null,
    reason: valid ? null : String(result?.reason || "INVALID_PREWARM_SOLUTION"),
  });
}

const roux = await rouxPromise;
const summary = {
  ok: results.every((entry) => entry.ok) && roux.ok,
  elapsedMs: performance.now() - startedAt,
  cfopZb: results,
  rouxV2: roux,
};
console.log(JSON.stringify(summary));

if (!summary.ok) {
  process.exit(1);
}
