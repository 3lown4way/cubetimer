from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


path = Path("solver/cfop3x3.js")
text = path.read_text()

metric_block = '''function countMetricMoves(moves) {
  const tokens = Array.isArray(moves) ? moves : splitMoves(moves);
  let count = 0;
  for (const token of tokens) {
    if (!CUBE_ROTATION_RE.test(String(token || "").trim())) count += 1;
  }
  return count;
}
'''

human_helpers = metric_block + r'''
const HUMAN_VIEWPOINT_FACE_RING = Object.freeze(["F", "R", "B", "L"]);
const HUMAN_VIEWPOINT_ROTATIONS = Object.freeze([
  Object.freeze({ token: "y", turns: 1 }),
  Object.freeze({ token: "y2", turns: 2 }),
  Object.freeze({ token: "y'", turns: 3 }),
]);
const HUMAN_VIEWPOINT_MOVE_RE = /^([URFDLBurfdlb])([wW]?)(2'?|')?$/;

function getHumanViewpointMoveMetrics(moves) {
  const tokens = Array.isArray(moves) ? moves : splitMoves(moves);
  let backFaceMoves = 0;
  let backFaceQuarterTurns = 0;
  let viewpointRotations = 0;
  let executionPenalty = 0;
  let previousWasBack = false;
  for (const rawToken of tokens) {
    const token = String(rawToken || "").trim();
    if (!token) continue;
    if (CUBE_ROTATION_RE.test(token)) {
      viewpointRotations += 1;
      executionPenalty += token.includes("2") ? 1.35 : 0.9;
      previousWasBack = false;
      continue;
    }
    const match = HUMAN_VIEWPOINT_MOVE_RE.exec(token);
    if (!match) {
      previousWasBack = false;
      continue;
    }
    const face = match[1].toUpperCase();
    const isHalfTurn = match[3].includes("2");
    if (face === "B") {
      backFaceMoves += 1;
      backFaceQuarterTurns += isHalfTurn ? 2 : 1;
      executionPenalty += isHalfTurn ? 2.35 : 3.0;
      if (previousWasBack) executionPenalty += 0.45;
      previousWasBack = true;
      continue;
    }
    previousWasBack = false;
    if (face === "L") executionPenalty += isHalfTurn ? 0.08 : 0.16;
    else if (face === "F") executionPenalty += isHalfTurn ? 0.03 : 0.06;
  }
  return {
    backFaceMoves,
    backFaceQuarterTurns,
    viewpointRotations,
    executionPenalty,
  };
}

function mapMoveForYViewpoint(token, turns, direction) {
  const normalized = String(token || "").trim();
  if (!normalized || CUBE_ROTATION_RE.test(normalized)) return null;
  const match = HUMAN_VIEWPOINT_MOVE_RE.exec(normalized);
  if (!match) return null;
  const rawFace = match[1];
  const upperFace = rawFace.toUpperCase();
  if (upperFace === "U" || upperFace === "D") return normalized;
  const index = HUMAN_VIEWPOINT_FACE_RING.indexOf(upperFace);
  if (index < 0) return null;
  const mappedIndex = (index + direction * turns + 16) % 4;
  const mappedUpper = HUMAN_VIEWPOINT_FACE_RING[mappedIndex];
  const mappedFace = rawFace === rawFace.toLowerCase() ? mappedUpper.toLowerCase() : mappedUpper;
  return `${mappedFace}${match[2]}${match[3]}`;
}

function buildEquivalentYViewpointMoves(moves, rotation, turns, direction) {
  const mapped = [];
  for (const token of moves) {
    const transformed = mapMoveForYViewpoint(token, turns, direction);
    if (!transformed) return null;
    mapped.push(transformed);
  }
  return simplifyMoves([rotation, ...mapped, invertRotation(rotation)]);
}

function arePatternsIdentical(a, b) {
  if (!a || !b) return false;
  if (typeof a.isIdentical === "function") {
    try {
      return a.isIdentical(b);
    } catch (_) {
      return false;
    }
  }
  return false;
}

function chooseHumanViewpointMoves(startPattern, moves, options = {}) {
  const originalMoves = simplifyMoves(Array.isArray(moves) ? moves : splitMoves(moves));
  const originalMetrics = getHumanViewpointMoveMetrics(originalMoves);
  const baseResult = {
    moves: originalMoves,
    changed: false,
    backFaceMovesBefore: originalMetrics.backFaceMoves,
    backFaceMovesAfter: originalMetrics.backFaceMoves,
    backFaceQuarterTurnsBefore: originalMetrics.backFaceQuarterTurns,
    backFaceQuarterTurnsAfter: originalMetrics.backFaceQuarterTurns,
    viewpointRotationsBefore: originalMetrics.viewpointRotations,
    viewpointRotationsAfter: originalMetrics.viewpointRotations,
    viewpointRotationsAdded: 0,
    executionPenaltyBefore: originalMetrics.executionPenalty,
    executionPenaltyAfter: originalMetrics.executionPenalty,
  };
  if (options.enableHumanViewpoint === false || !startPattern || originalMoves.length === 0) {
    return baseResult;
  }
  if (originalMetrics.backFaceMoves === 0) return baseResult;

  const targetPattern = tryApplyMoves(startPattern, originalMoves);
  if (!targetPattern) return baseResult;

  let bestMoves = originalMoves;
  let bestMetrics = originalMetrics;
  for (const rotation of HUMAN_VIEWPOINT_ROTATIONS) {
    for (const direction of [1, -1]) {
      const candidateMoves = buildEquivalentYViewpointMoves(
        originalMoves,
        rotation.token,
        rotation.turns,
        direction,
      );
      if (!candidateMoves || candidateMoves.length === 0) continue;
      if (countMetricMoves(candidateMoves) !== countMetricMoves(originalMoves)) continue;
      const candidatePattern = tryApplyMoves(startPattern, candidateMoves);
      if (!arePatternsIdentical(candidatePattern, targetPattern)) continue;
      const candidateMetrics = getHumanViewpointMoveMetrics(candidateMoves);
      const scoreImproved = candidateMetrics.executionPenalty < bestMetrics.executionPenalty - 0.2;
      const scoreTied = Math.abs(candidateMetrics.executionPenalty - bestMetrics.executionPenalty) <= 0.2;
      const backFaceImproved = candidateMetrics.backFaceMoves < bestMetrics.backFaceMoves;
      const rotationTieBreak =
        candidateMetrics.backFaceMoves === bestMetrics.backFaceMoves &&
        candidateMetrics.viewpointRotations < bestMetrics.viewpointRotations;
      if (scoreImproved || (scoreTied && (backFaceImproved || rotationTieBreak))) {
        bestMoves = candidateMoves;
        bestMetrics = candidateMetrics;
      }
    }
  }

  const changed = joinMoves(bestMoves) !== joinMoves(originalMoves);
  return {
    moves: bestMoves,
    changed,
    backFaceMovesBefore: originalMetrics.backFaceMoves,
    backFaceMovesAfter: bestMetrics.backFaceMoves,
    backFaceQuarterTurnsBefore: originalMetrics.backFaceQuarterTurns,
    backFaceQuarterTurnsAfter: bestMetrics.backFaceQuarterTurns,
    viewpointRotationsBefore: originalMetrics.viewpointRotations,
    viewpointRotationsAfter: bestMetrics.viewpointRotations,
    viewpointRotationsAdded: Math.max(
      0,
      bestMetrics.viewpointRotations - originalMetrics.viewpointRotations,
    ),
    executionPenaltyBefore: originalMetrics.executionPenalty,
    executionPenaltyAfter: bestMetrics.executionPenalty,
  };
}

function combineHumanViewpointDiagnostics(entries) {
  const diagnostics = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!diagnostics.length) return null;
  return diagnostics.reduce(
    (summary, entry) => {
      summary.segments += 1;
      if (entry.changed) summary.segmentsChanged += 1;
      summary.backFaceMovesBefore += Number(entry.backFaceMovesBefore || 0);
      summary.backFaceMovesAfter += Number(entry.backFaceMovesAfter || 0);
      summary.backFaceQuarterTurnsBefore += Number(entry.backFaceQuarterTurnsBefore || 0);
      summary.backFaceQuarterTurnsAfter += Number(entry.backFaceQuarterTurnsAfter || 0);
      summary.viewpointRotationsAdded += Number(entry.viewpointRotationsAdded || 0);
      summary.executionPenaltyBefore += Number(entry.executionPenaltyBefore || 0);
      summary.executionPenaltyAfter += Number(entry.executionPenaltyAfter || 0);
      summary.backFaceMovesAvoided = summary.backFaceMovesBefore - summary.backFaceMovesAfter;
      return summary;
    },
    {
      segments: 0,
      segmentsChanged: 0,
      backFaceMovesBefore: 0,
      backFaceMovesAfter: 0,
      backFaceMovesAvoided: 0,
      backFaceQuarterTurnsBefore: 0,
      backFaceQuarterTurnsAfter: 0,
      viewpointRotationsAdded: 0,
      executionPenaltyBefore: 0,
      executionPenaltyAfter: 0,
    },
  );
}

export function humanizeCfopViewpointMoves(startPattern, moves, options = {}) {
  return chooseHumanViewpointMoves(startPattern, moves, options);
}
'''
text = replace_once(text, metric_block, human_helpers, "human viewpoint helpers")

old_output = '''    const internalMoves = Array.isArray(result.moves) ? result.moves.slice() : [];
    const outputMoves = simplifyMoves(internalMoves);
    const moveText = joinMoves(outputMoves);
'''
new_output = '''    const internalMoves = Array.isArray(result.moves) ? result.moves.slice() : [];
    let outputMoves = simplifyMoves(internalMoves);
    let humanizedPairSegments = null;
    let humanViewpointDiagnostics = null;
    if (stage.name === "F2L") {
      const rawPairSegments = splitF2LMovesIntoPairs(stageStartPattern, internalMoves, ctx);
      const segmentedMoveCount = rawPairSegments.reduce(
        (sum, segment) => sum + (Array.isArray(segment.moves) ? segment.moves.length : 0),
        0,
      );
      if (rawPairSegments.length && segmentedMoveCount === internalMoves.length) {
        let segmentPattern = stageStartPattern;
        const segmentDiagnostics = [];
        humanizedPairSegments = rawPairSegments.map((segment) => {
          const originalSegmentMoves = simplifyMoves(segment.moves);
          const choice = chooseHumanViewpointMoves(segmentPattern, originalSegmentMoves, options);
          const nextPattern = tryApplyMoves(segmentPattern, choice.moves);
          if (nextPattern) segmentPattern = nextPattern;
          segmentDiagnostics.push(choice);
          return {
            ...segment,
            moves: choice.moves,
            humanViewpoint: choice,
          };
        });
        outputMoves = simplifyMoves(
          humanizedPairSegments.flatMap((segment) => segment.moves),
        );
        humanViewpointDiagnostics = combineHumanViewpointDiagnostics(segmentDiagnostics);
      } else {
        const choice = chooseHumanViewpointMoves(stageStartPattern, outputMoves, options);
        outputMoves = choice.moves;
        humanViewpointDiagnostics = combineHumanViewpointDiagnostics([choice]);
      }
    } else {
      const choice = chooseHumanViewpointMoves(stageStartPattern, outputMoves, options);
      outputMoves = choice.moves;
      humanViewpointDiagnostics = combineHumanViewpointDiagnostics([choice]);
    }
    const moveText = joinMoves(outputMoves);
'''
text = replace_once(text, old_output, new_output, "stage output humanization")

old_pair = '''      const pairSegments = splitF2LMovesIntoPairs(stageStartPattern, internalMoves, ctx);
      if (pairSegments.length) {
'''
new_pair = '''      const pairSegments = humanizedPairSegments || splitF2LMovesIntoPairs(stageStartPattern, internalMoves, ctx);
      if (pairSegments.length) {
'''
text = replace_once(text, old_pair, new_pair, "humanized F2L pair display")

old_pair_entry = '''            nodes: index === 0 ? result.nodes : undefined,
          });
'''
new_pair_entry = '''            nodes: index === 0 ? result.nodes : undefined,
            humanViewpoint: segment.humanViewpoint || null,
          });
'''
text = replace_once(text, old_pair_entry, new_pair_entry, "pair viewpoint diagnostics")

old_stage_entry = '''        nodes: result.nodes,
      });
'''
new_stage_entry = '''        nodes: result.nodes,
        humanViewpoint: humanViewpointDiagnostics,
      });
'''
# There are two matching generic stage-entry blocks. Update both.
if text.count(old_stage_entry) < 2:
    raise SystemExit("missing generic stage-entry targets")
text = text.replace(old_stage_entry, new_stage_entry, 2)

old_diag = '''      moveCount: countMetricMoves(outputMoves),
      method: result.method || null,
'''
new_diag = '''      moveCount: countMetricMoves(outputMoves),
      humanViewpoint: humanViewpointDiagnostics,
      method: result.method || null,
'''
text = replace_once(text, old_diag, new_diag, "stage diagnostics viewpoint summary")

path.write_text(text)

Path("benchmark-human-viewpoint-contract.mjs").write_text(r'''import assert from "node:assert/strict";
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
  assert.ok(human.moveCount <= baseline.moveCount, `${mode}: viewpoint rewrite increased HTM`);
  assert.ok(backCount(human.solution) <= backCount(baseline.solution), `${mode}: B usage increased`);
  assert.ok(
    (human.stageDiagnostics || []).some((entry) => entry.humanViewpoint),
    `${mode}: missing viewpoint diagnostics`,
  );
  return {
    mode,
    scramble,
    baselineMoves: baseline.moveCount,
    humanMoves: human.moveCount,
    baselineBack: backCount(baseline.solution),
    humanBack: backCount(human.solution),
    rotations: rotationCount(human.solution),
  };
}

const results = [];
for (const mode of ["strict", "zb"]) {
  let found = null;
  for (const scramble of scrambles) {
    found = await solvePair(scramble, mode);
    if (found) {
      results.push(found);
      if (found.baselineBack > found.humanBack) break;
    }
  }
  assert.ok(found, `${mode}: no successful parity case`);
}
assert.ok(
  results.some((entry) => entry.humanBack < entry.baselineBack && entry.rotations > 0),
  `no real solve traded B moves for viewpoint rotations: ${JSON.stringify(results)}`,
);

console.log(JSON.stringify({ probe, results }));
''')

# Temporary script is removed after CI applies it.
Path("tools/apply-human-viewpoint-cfop.py").unlink()
