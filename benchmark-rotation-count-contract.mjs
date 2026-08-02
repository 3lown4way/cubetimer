import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "./solver/cfop3x3.js";
import { solve3x3RouxFromPattern } from "./solver/roux3x3.js";
import { prewarm3x3RouxV2, solve3x3RouxV2FromPattern } from "./solver/roux3x3v2.js";

const ROTATION_RE = /^[xyz](?:2'?|')?$/i;
const scrambles = {
  cfop: "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  zb: "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  roux: "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
};

function tokens(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}
function metricCount(sequence) {
  return tokens(sequence).filter((token) => !ROTATION_RE.test(token)).length;
}
function assertRotationCount(pattern, result, label, verifyStageSum = false) {
  assert.equal(result?.ok, true, `${label}: ${result?.reason || "failed"}`);
  assert.notEqual(result.selectedCrossColor, "D", `${label}: test did not select a rotated orientation`);
  const allTokens = tokens(result.solution);
  assert.ok(allTokens.some((token) => ROTATION_RE.test(token)), `${label}: missing x/y/z inspection rotation`);
  assert.equal(result.moveCount, metricCount(result.solution), `${label}: x/y/z affected moveCount`);
  assert.ok(result.moveCount < allTokens.length, `${label}: rotation was not excluded`);
  const after = result.solution ? pattern.applyAlg(result.solution) : pattern;
  assert.equal(after.isIdentical(solved), true, `${label}: invalid solution`);
  if (verifyStageSum) {
    const rotationStages = (result.stages || []).filter((stage) =>
      tokens(stage.solution).some((token) => ROTATION_RE.test(token)),
    );
    assert.ok(rotationStages.length >= 1, `${label}: no rotation-bearing stage found`);
    for (const stage of rotationStages) {
      assert.equal(
        Number(stage.moveCount || 0),
        metricCount(stage.solution),
        `${label} ${stage.name}: x/y/z affected stage count`,
      );
      if (Number.isFinite(stage.depth)) {
        assert.equal(stage.depth, metricCount(stage.solution), `${label} ${stage.name}: x/y/z affected depth`);
      }
    }
  }
}

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries({ includeF2L: false, includeSingleStage: true });
await prewarm3x3RouxV2();

const cfopPattern = solved.applyAlg(scrambles.cfop);
const cfop = await solve3x3StrictCfopFromPattern(cfopPattern, {
  crossColor: "CN",
  mode: "strict",
  solverVersion: "v2",
  scramble: scrambles.cfop,
  deadlineTs: Date.now() + 15000,
  enableStyleFallback: false,
  allowRelaxedSearch: false,
});
assertRotationCount(cfopPattern, cfop, "CFOP", true);

const zbPattern = solved.applyAlg(scrambles.zb);
const zb = await solve3x3StrictCfopFromPattern(zbPattern, {
  crossColor: "CN",
  mode: "zb",
  solverVersion: "v2",
  scramble: scrambles.zb,
  deadlineTs: Date.now() + 20000,
  enableStyleFallback: false,
  allowRelaxedSearch: false,
});
assertRotationCount(zbPattern, zb, "Pure ZB", true);

const rouxPattern = solved.applyAlg(scrambles.roux);
const rouxV1 = await solve3x3RouxFromPattern(rouxPattern, {
  crossColor: "CN",
  enableRecovery: false,
  deadlineTs: Date.now() + 45000,
});
assertRotationCount(rouxPattern, rouxV1, "Roux v1", false);

const rouxV2 = await solve3x3RouxV2FromPattern(rouxPattern, { crossColor: "CN" });
assertRotationCount(rouxPattern, rouxV2, "Roux v2", false);
assert.equal(rouxV2.moveCount, rouxV2.coreMoveCount);

console.log(JSON.stringify({
  cfop: { color: cfop.selectedCrossColor, moveCount: cfop.moveCount, tokens: tokens(cfop.solution).length },
  zb: { color: zb.selectedCrossColor, moveCount: zb.moveCount, tokens: tokens(zb.solution).length },
  rouxV1: { color: rouxV1.selectedCrossColor, moveCount: rouxV1.moveCount, tokens: tokens(rouxV1.solution).length },
  rouxV2: { color: rouxV2.selectedCrossColor, moveCount: rouxV2.moveCount, tokens: tokens(rouxV2.solution).length },
}));
