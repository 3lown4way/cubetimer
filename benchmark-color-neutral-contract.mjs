import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "./solver/cfop3x3.js";
import { solve3x3RouxFromPattern } from "./solver/roux3x3.js";
import { prewarm3x3RouxV2, solve3x3RouxV2FromPattern } from "./solver/roux3x3v2.js";

const COLORS = ["D", "U", "F", "B", "R", "L"];
const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
];

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries({ includeF2L: false, includeSingleStage: true });
await prewarm3x3RouxV2();

function assertSixColors(result, label) {
  assert.ok(Array.isArray(result?.colorNeutralCandidates), `${label}: missing CN diagnostics`);
  assert.deepEqual(
    result.colorNeutralCandidates.map((entry) => entry.color),
    COLORS,
    `${label}: did not evaluate all six colors`,
  );
  assert.ok(COLORS.includes(result.selectedCrossColor), `${label}: invalid selected color`);
}

function assertSolved(pattern, result, label) {
  assert.equal(result?.ok, true, `${label}: ${result?.reason || "failed"}`);
  const after = result.solution ? pattern.applyAlg(result.solution) : pattern;
  assert.equal(after.isIdentical(solved), true, `${label}: returned solution is invalid`);
}

const selected = { cfop: [], zb: [], rouxV2: [] };
for (let index = 0; index < scrambles.length; index += 1) {
  const pattern = solved.applyAlg(scrambles[index]);

  const cfop = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: "CN",
    mode: "strict",
    solverVersion: "v2",
    scramble: scrambles[index],
    deadlineTs: Date.now() + 15000,
    enableStyleFallback: false,
    allowRelaxedSearch: false,
  });
  assertSolved(pattern, cfop, `CFOP #${index + 1}`);
  assertSixColors(cfop, `CFOP #${index + 1}`);
  selected.cfop.push(cfop.selectedCrossColor);

  const zb = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: "CN",
    mode: "zb",
    solverVersion: "v2",
    scramble: scrambles[index],
    deadlineTs: Date.now() + 20000,
    enableStyleFallback: false,
    allowRelaxedSearch: false,
  });
  if (zb?.ok) {
    assertSolved(pattern, zb, `ZB #${index + 1}`);
    assertSixColors(zb, `ZB #${index + 1}`);
    selected.zb.push(zb.selectedCrossColor);
  }

  const rouxV2 = await solve3x3RouxV2FromPattern(pattern, { crossColor: "CN" });
  assertSolved(pattern, rouxV2, `Roux v2 #${index + 1}`);
  assertSixColors(rouxV2, `Roux v2 #${index + 1}`);
  selected.rouxV2.push(rouxV2.selectedCrossColor);
}

assert.ok(selected.cfop.some((color) => color !== "D"), `CFOP remained yellow-only: ${selected.cfop}`);
assert.ok(selected.zb.length >= 1, "Pure ZB produced no valid contract result");
assert.ok(selected.zb.some((color) => color !== "D"), `Pure ZB remained yellow-only: ${selected.zb}`);
assert.ok(selected.rouxV2.some((color) => color !== "D"), `Roux v2 remained yellow-only: ${selected.rouxV2}`);

const v1Pattern = solved.applyAlg(scrambles[0]);
const rouxV1 = await solve3x3RouxFromPattern(v1Pattern, {
  crossColor: "CN",
  enableRecovery: false,
  deadlineTs: Date.now() + 45000,
});
assertSolved(v1Pattern, rouxV1, "Roux v1");
assertSixColors(rouxV1, "Roux v1");
const bestFb = [...rouxV1.colorNeutralCandidates].sort((a, b) => {
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  if (a.fbMoveCount !== b.fbMoveCount) return a.fbMoveCount - b.fbMoveCount;
  if (a.nodes !== b.nodes) return a.nodes - b.nodes;
  return COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
})[0];
assert.equal(rouxV1.selectedCrossColor, bestFb.ok ? bestFb.color : "D");

console.log(JSON.stringify({ selected, rouxV1: rouxV1.selectedCrossColor }));
