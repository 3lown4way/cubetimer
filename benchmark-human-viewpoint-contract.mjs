import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  humanizeCfopViewpointMoves,
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "./solver/cfop3x3.js";

const ROTATION_RE = /^[xyz](?:2'?|')?$/i;
const BACK_RE = /^[Bb](?:[wW])?(?:2'?|')?$/;
const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
];

function tokens(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}
function metricCount(sequence) {
  return tokens(sequence).filter((token) => !ROTATION_RE.test(token)).length;
}
function backCount(sequence) {
  return tokens(sequence).filter((token) => BACK_RE.test(token)).length;
}
function rotationCount(sequence) {
  return tokens(sequence).filter((token) => ROTATION_RE.test(token)).length;
}

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries({ includeF2L: true, includeSingleStage: true });

const probeStart = solved.applyAlg(scrambles[0]);
const probeOriginal = ["B", "U", "B'", "R", "B2", "U'"];
const probe = humanizeCfopViewpointMoves(probeStart, probeOriginal);
const probeTarget = probeStart.applyAlg(probeOriginal.join(" "));
const probeAfter = probeStart.applyAlg(probe.moves.join(" "));
assert.equal(probeAfter.isIdentical(probeTarget), true, "viewpoint rewrite changed the cube transformation");
assert.ok(probe.backFaceMovesAfter < probe.backFaceMovesBefore, "synthetic B-heavy sequence was not improved");
assert.ok(probe.viewpointRotationsAdded > 0, "viewpoint rewrite did not add a y rotation");
assert.equal(metricCount(probe.moves.join(" ")), metricCount(probeOriginal.join(" ")));

async function solvePair(scramble, mode) {
  const pattern = solved.applyAlg(scramble);
  const common = {
    crossColor: "D",
    mode,
    solverVersion: "v2",
    scramble,
    deadlineTs: Date.now() + (mode === "zb" ? 25000 : 18000),
    enableStyleFallback: false,
    allowRelaxedSearch: false,
  };
  const baseline = await solve3x3StrictCfopFromPattern(pattern, {
    ...common,
    enableHumanViewpoint: false,
  });
  const human = await solve3x3StrictCfopFromPattern(pattern, {
    ...common,
    deadlineTs: Date.now() + (mode === "zb" ? 25000 : 18000),
    enableHumanViewpoint: true,
  });
  if (!baseline?.ok || !human?.ok) return null;
  assert.equal(pattern.applyAlg(baseline.solution).isIdentical(solved), true, `${mode}: invalid baseline`);
  assert.equal(pattern.applyAlg(human.solution).isIdentical(solved), true, `${mode}: invalid human solve`);
  assert.equal(human.moveCount, metricCount(human.solution), `${mode}: rotations affected HTM count`);

  // Baseline and viewpoint-enabled solves are separate searches and may select
  // different valid algorithms near a deadline. Validate the rewrite itself
  // through its per-stage before/after diagnostics instead of comparing the two
  // independently selected final solutions.
  const viewpointEntries = (human.stageDiagnostics || [])
    .map((entry) => entry?.humanViewpoint)
    .filter(Boolean);
  assert.ok(viewpointEntries.length > 0, `${mode}: missing viewpoint diagnostics`);
  for (const entry of viewpointEntries) {
    assert.ok(
      Number(entry.backFaceMovesAfter || 0) <= Number(entry.backFaceMovesBefore || 0),
      `${mode}: viewpoint rewrite increased B usage within a stage`,
    );
    assert.ok(
      Number(entry.executionPenaltyAfter || 0) <= Number(entry.executionPenaltyBefore || 0) + 0.2,
      `${mode}: viewpoint rewrite increased execution penalty`,
    );
  }

  const viewpointBackAvoided = viewpointEntries.reduce(
    (sum, entry) => sum + Number(entry.backFaceMovesAvoided || 0),
    0,
  );
  const viewpointRotationsAdded = viewpointEntries.reduce(
    (sum, entry) => sum + Number(entry.viewpointRotationsAdded || 0),
    0,
  );
  return {
    mode,
    scramble,
    baselineMoves: baseline.moveCount,
    humanMoves: human.moveCount,
    baselineBack: backCount(baseline.solution),
    humanBack: backCount(human.solution),
    rotations: rotationCount(human.solution),
    viewpointBackAvoided,
    viewpointRotationsAdded,
  };
}

const results = [];
for (const mode of ["strict", "zb"]) {
  let found = null;
  for (const scramble of scrambles) {
    found = await solvePair(scramble, mode);
    if (found) {
      results.push(found);
      if (found.viewpointBackAvoided > 0) break;
    }
  }
  assert.ok(found, `${mode}: no successful parity case`);
}
assert.ok(
  results.some((entry) => entry.viewpointBackAvoided > 0 && entry.viewpointRotationsAdded > 0),
  `no real solve traded B moves for viewpoint rotations: ${JSON.stringify(results)}`,
);

console.log(JSON.stringify({ probe, results }));
