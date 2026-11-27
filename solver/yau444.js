import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solveYauFirstCenters444, solveYauSideCenters444 } from "./yauCenters444.js?v=20261126-yau-stages-1";
import {
  crossEdgeTypeMask444,
  crossSideColors444,
  solveYauCross4Natural444,
  solveYauFirstThreeCross444,
  solveYauLastEight323444,
} from "./edgePairing444.js?v=20261126-yau-stages-1";

const SIDE_CYCLE = ["F", "L", "B", "R"];
const OPPOSITE = { U: "D", R: "L", F: "B", D: "U", L: "R", B: "F" };
const ROTATION = /^[xyz](?:2|')?$/;

function split(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

function phaseSegment(id, name, turns, extra = {}) {
  return { id, name, solution: turns.join(" "), moveCount: turns.length, verified: true, ...extra };
}

function phaseGroup(id, name, method, segments) {
  return phaseSegment(id, name, segments.flatMap((segment) => split(segment.solution)), { method, segments });
}

// Keep the solved bottom-layer slots stationary. A D turn followed by a
// whole y is a three-layer U turn. Carry that orientation through the
// following side moves instead of actually turning the protected layer.
function stationaryCrossTurns(solution) {
  let offset = 0;
  const turns = [];
  for (const turn of split(solution)) {
    if (turn[0] === "D") {
      const wide = turn[1] === "w";
      const suffix = turn.slice(wide ? 2 : 1);
      offset = (offset + moveAmount(turn)) % 4;
      turns.push(`${wide ? "Uw" : "3Uw"}${suffix}`);
    } else {
      const face = SIDE_CYCLE.indexOf(turn[0]);
      turns.push(face < 0 ? turn : `${SIDE_CYCLE[(face + offset) % 4]}${turn.slice(1)}`);
    }
  }
  if (offset !== 0) throw new Error("444_YAU_CROSS_FRAME_MISMATCH");
  return turns;
}

// On the upper three layers, Uw and 2D act on disjoint slices. A 3Uw
// is Uw plus the lower inner slice in the opposite direction to 2D.
function shortenYauLayerRuns(turns) {
  const shorter = [];
  let upper = 0;
  let inner = 0;
  const suffix = ["", "", "2", "'"];
  function flush() {
    if (upper && upper === inner) shorter.push(`3Uw${suffix[upper]}`);
    else {
      if (upper) shorter.push(`Uw${suffix[upper]}`);
      if (inner) shorter.push(`2D${suffix[4 - inner]}`);
    }
    upper = inner = 0;
  }
  for (const turn of turns) {
    const match = /^(3Uw|Uw|2D)(2|')?$/.exec(turn);
    if (match) {
      const [, layer] = match;
      const amount = moveAmount(turn);
      if (layer !== "2D") upper = (upper + amount) % 4;
      if (layer !== "Uw") inner = (inner + (layer === "2D" ? 4 - amount : amount)) % 4;
      continue;
    }
    flush();
    const base = turn.replace(/(?:2|')$/, "");
    const previous = shorter.at(-1);
    if (!previous || previous.replace(/(?:2|')$/, "") !== base) shorter.push(turn);
    else {
      const amount = (moveAmount(turn) + moveAmount(shorter.pop())) % 4;
      if (amount) shorter.push(`${base}${suffix[amount]}`);
    }
  }
  flush();
  return shorter;
}

function moveAmount(turn) {
  return turn.endsWith("2") ? 2 : turn.endsWith("'") ? 3 : 1;
}

function streamlinePairingTurns(turns) {
  const result = [];
  let run = [];
  // A working-slot adjustment can cancel across an upper turn without
  // changing the open/restore slice moves that make the pairing visible.
  function flush() {
    const netAdjustment = run.reduce((total, turn) => total + (turn.startsWith("3Uw") ? moveAmount(turn) : 0), 0);
    result.push(...(netAdjustment % 4 === 0 ? run.filter((turn) => !turn.startsWith("3Uw")) : run));
    run = [];
  }
  for (const turn of turns) {
    if (/^(3Uw|Uw|U)(2|')?$/.test(turn)) run.push(turn);
    else {
      flush();
      result.push(turn);
    }
  }
  flush();
  return result;
}

export async function solveYauPhases444(scramble, { deadlineTs, edgeBudgetMs, cross4BudgetMs, onStage }) {
  const puzzle = await puzzles["4x4x4"].kpuzzle();
  const initial = puzzle.defaultPattern().applyAlg(scramble);
  const centers = await solveYauFirstCenters444(initial, deadlineTs, onStage);
  onStage("YAU_CROSS3");
  const cross3Started = Date.now();
  const cross = await solveYauFirstThreeCross444(centers.pattern, deadlineTs);
  const cross3Ms = Date.now() - cross3Started;

  onStage("YAU_REMAINING_CENTERS");
  const sides = await solveYauSideCenters444(cross.pattern, cross.workingFace, deadlineTs);
  const [groupLength] = sides.phaseMoveCounts;
  const groupedTurns = shortenYauLayerRuns(sides.turns.slice(0, groupLength));
  const colorTurns = shortenYauLayerRuns(sides.turns.slice(groupLength));
  const sideTurns = [...groupedTurns, ...colorTurns];
  const crossSteps = cross.steps.map((step, index) => phaseSegment(
    `yauCross3_${index + 1}`,
    step.workingGap ? "Yau · Open Working Slot" : `Yau · Cross Edge ${crossSideColors444(step.lockedMask).length}/3`,
    step.turns,
    { protectedSideColors: crossSideColors444(step.lockedMask), edgeSideColor: step.edgeFace },
  ));
  const protectedMask = cross.crossCount === 3 ? cross.lockedMask : cross.lockedMask & (cross.lockedMask - 1);
  const protectedSideColors = crossSideColors444(protectedMask);
  const cross3Turns = crossSteps.flatMap(({ solution }) => split(solution));
  const beforeCross4 = [...centers.first, ...centers.opposite, ...cross3Turns, ...sideTurns].join(" ");
  const targetMask = crossEdgeTypeMask444("D");

  onStage("YAU_CROSS4");
  const cross4 = await solveYauCross4Natural444(scramble, beforeCross4, targetMask, {
    deadlineTs,
    requiredTypeMask: cross.lockedMask,
    timeBudgetMs: cross4BudgetMs,
  });
  if (!cross4.ok) throw new Error(`444_YAU_CROSS4_FAILED:${cross4.reason || ""}`);
  const cross4Turns = shortenYauLayerRuns(stationaryCrossTurns(cross4.solution));

  onStage("EDGES");
  const edges = await solveYauLastEight323444(scramble, [beforeCross4, ...cross4Turns].join(" "), {
    deadlineTs,
    crossTypeMask: targetMask,
    protectedCrossTypeMask: protectedMask,
    timeBudgetMs: edgeBudgetMs,
  });
  if (!edges.ok) throw new Error(`444_YAU_EDGE_PAIRING_FAILED:${edges.reason || ""} ${edges.detail || ""}`);

  const setupStage = phaseGroup("centers", "Yau Setup", "Yau", [
    phaseSegment("yauFirstCenter", "Yau · First Center", centers.first),
    phaseSegment("yauOppositeCenter", "Yau · Opposite Center", centers.opposite),
    phaseSegment("yauCross3", cross.crossCount === 4 ? "Yau · Cross Already Solved" : "Yau · Cross Edges 3/4", cross3Turns, {
      crossEdgeCount: cross.crossCount,
      startingSideColors: crossSideColors444(cross.initialMask & cross.lockedMask),
      protectedSideColors,
      alreadyPaired: cross3Turns.length === 0,
      segments: crossSteps,
    }),
    phaseSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", sideTurns, { crossLockedEveryMove: true }),
    phaseSegment("yauCross4", "Yau · Cross Edge 4/4", cross4Turns, {
      crossEdgeCount: 4,
      crossLockedEveryMove: true,
      alignmentMoveCount: cross4.alignmentMoveCount,
      technique: cross4.technique,
      alreadyPaired: cross4.moveCount === 0,
    }),
  ]);
  const edgeStage = phaseGroup("edges", "Edge Pairing · Yau 3-2-3", "Yau 3-2-3", edges.segments.map((segment) => {
    const turns = streamlinePairingTurns(stationaryCrossTurns(segment.solution));
    return { ...segment, solution: turns.join(" "), moveCount: turns.length };
  }));
  const centerPhaseMoveCounts = [centers.first.length, centers.opposite.length, groupedTurns.length, colorTurns.length];
  return {
    stages: [setupStage, edgeStage],
    workingFace: cross.workingFace,
    meta: {
      method444: "yau",
      scrambleValid: true,
      stateValid: true,
      parsedMoveCount: split(scramble).length,
      solvedState: initial.experimentalIsSolved({ ignorePuzzleOrientation: false }),
      centersSolved: true,
      centerMoveCount: setupStage.moveCount,
      centerPhaseMoveCounts,
      centerTableBuildMs: centers.tableBuildMs + sides.tableBuildMs,
      centerSearchMs: centers.elapsedMs + sides.elapsedMs - centers.tableBuildMs - sides.tableBuildMs,
      edgesPaired: true,
      edgeMoveCount: edgeStage.moveCount,
      edgeTableBuildMs: 0,
      edgeSearchMs: edges.meta.diagnostics.elapsedMs,
      edgeMethod: "Yau 3-2-3",
      yauIndependentStages: true,
      yauAttempted: true,
      yauFallbackReason: null,
      yauCrossTypeMask: targetMask,
      yauCross3SearchMs: cross3Ms,
      yauCross3MoveCount: cross3Turns.length,
      yauCross3HumanStepCount: cross.steps.filter((step) => !step.workingGap).length,
      yauCross3SolvedTargetMask: cross.lockedMask,
      yauCross3PairedTargetMask: cross.lockedMask,
      yauCross3Method: "Yau Human Cross 3/4",
      yauNaturalCross3Applied: true,
      yauHumanCross3Applied: true,
      yauNaturalCross3FallbackReason: null,
      yauRemainingCentersRecomputed: true,
      yauRecomputedCenterPhaseMoveCounts: [0, 0, groupedTurns.length, colorTurns.length],
      yauProtectedCenterSearchMs: sides.elapsedMs,
      yauRemainingCentersCrossLockedEveryMove: true,
      yauCross4SearchMs: cross4.elapsedMs,
      yauCross4MoveCount: cross4Turns.length,
      yauCross4Method: cross4.method,
      yauHumanCross4Applied: true,
      yauCrossRestoreMoveCount: 0,
      yauEdge323ProtectedCrossBank: true,
      yauEdge323ProtectedBankFallbackReason: null,
      yauLastEightOnly: edges.meta.lastEightOnly,
      yauCrossSolvedAtEdgeSegmentBoundaries: edges.meta.crossSolvedAtSegmentBoundaries,
      yauPureCenterMoveCount: centerPhaseMoveCounts.reduce((total, count) => total + count, 0),
      yauRemainingCenterMoveCount: sideTurns.length,
      yauEdge323: edges.meta,
    },
  };
}

let playbackGeometryPromise;

async function buildPlaybackGeometry() {
  const loader = puzzles["4x4x4"];
  const [puzzle, pg] = await Promise.all([loader.kpuzzle(), loader.pg()]);
  const solved = puzzle.defaultPattern();
  const { faces, stickers } = pg.get3d();
  const centers = new Map(faces.map(({ name }) => [name, []]));
  const centerColor = new Map();
  const wings = Array.from({ length: 24 }, () => []);
  for (const sticker of stickers) {
    if (sticker.isDup) continue;
    const { orbit, face, ord, ori } = sticker;
    const name = faces[face].name;
    if (orbit === "CENTERS") {
      centers.get(name).push(ord);
      centerColor.set(solved.patternData.CENTERS.pieces[ord], name);
    } else if (orbit === "EDGES") {
      wings[ord][ori] = name;
    }
  }
  const slots = new Map();
  for (const [wing, names] of wings.entries()) {
    const key = [...names].sort().join("");
    if (!slots.has(key)) slots.set(key, []);
    slots.get(key).push(wing);
  }
  return { solved, centers, centerColor, wings, slots };
}

function crossSnapshot(pattern, crossColor, geometry) {
  const centerColors = new Map();
  for (const [face, positions] of geometry.centers) {
    const colors = positions.map((pos) => geometry.centerColor.get(pattern.patternData.CENTERS.pieces[pos]));
    if (colors.every((color) => color === colors[0])) centerColors.set(face, colors[0]);
  }
  const crossFace = [...centerColors].find(([, color]) => color === crossColor)?.[0];
  const spokes = new Map();
  const { pieces, orientation } = pattern.patternData.EDGES;
  if (crossFace) {
    const sticker = (pos, face) => geometry.wings[pieces[pos]][geometry.wings[pos].indexOf(face) ^ orientation[pos]];
    for (const [faces, [a, b]] of geometry.slots) {
      if (!faces.includes(crossFace) || sticker(a, crossFace) !== crossColor || sticker(b, crossFace) !== crossColor) continue;
      const side = faces.replace(crossFace, "");
      const color = sticker(a, side);
      if (color === sticker(b, side)) spokes.set(color, side);
    }
  }
  return { crossFace, centerColors, spokes };
}

// Audit the actual displayed algorithm using the renderer's sticker geometry.
// A complete three-spoke cross stays in the same slots until the whole-cube
// regrip at the start of edge pairing, then stays in its new slots.
export async function verifyYauPlayback444(scramble, stages, crossColor) {
  playbackGeometryPromise ??= buildPlaybackGeometry().catch((error) => {
    playbackGeometryPromise = null;
    throw error;
  });
  const geometry = await playbackGeometryPromise;
  const [setup, edges, cfop] = stages;
  const [first, opposite, cross3, sides, cross4] = setup.segments;
  let pattern = geometry.solved.applyAlg(scramble);
  const snapshot = () => crossSnapshot(pattern, crossColor, geometry);
  const require = (test, stage) => {
    if (!test) throw new Error(`444_YAU_PLAYBACK_INVALID:${stage}`);
  };
  function verifyStageSequence(stage) {
    if (!stage.segments?.length) return;
    require(stage.segments.map(({ solution }) => solution).filter(Boolean).join(" ") === stage.solution, stage.id);
    for (const child of stage.segments) verifyStageSequence(child);
  }
  for (const stage of stages) verifyStageSequence(stage);

  function playLocked(segment, face, colors, allowGrip = false) {
    const turns = split(segment.solution);
    let start = 0;
    if (allowGrip) {
      while (start < turns.length && ROTATION.test(turns[start])) pattern = pattern.applyMove(turns[start++]);
    }
    const before = snapshot();
    require(before.crossFace === face && colors.every((color) => before.spokes.has(color)), segment.id);
    for (const turn of turns.slice(start)) {
      require(!ROTATION.test(turn), segment.id);
      pattern = pattern.applyMove(turn);
      const after = snapshot();
      require(after.crossFace === face && colors.every((color) => (
        after.spokes.get(color) === before.spokes.get(color)
      )), `${segment.id}:${turn}`);
    }
  }

  function completeCross(face, stage) {
    const { crossFace, centerColors, spokes } = snapshot();
    require(crossFace === face && centerColors.size === 6 && spokes.size === 4 && [...spokes].every(
      ([color, side]) => centerColors.get(side) === color,
    ), stage);
  }

  pattern = pattern.applyAlg(first.solution);
  require(snapshot().crossFace === "U", first.id);
  pattern = pattern.applyAlg(opposite.solution);
  const oppositeState = snapshot();
  require(oppositeState.crossFace === "D" && oppositeState.centerColors.get("U") === OPPOSITE[crossColor], opposite.id);

  const steps = cross3.segments.length ? cross3.segments : [cross3];
  let held = cross3.startingSideColors;
  for (const [index, step] of steps.entries()) {
    playLocked(step, "L", held, index === 0);
    const state = snapshot();
    require(step.protectedSideColors.every((color) => state.spokes.has(color)), step.id);
    held = step.protectedSideColors;
  }
  const placed = snapshot();
  require(placed.spokes.size === cross3.crossEdgeCount && (
    cross3.crossEdgeCount === 4 || ![...placed.spokes.values()].includes("U")
  ), cross3.id);
  playLocked(sides, "L", cross3.protectedSideColors);
  require(snapshot().centerColors.size === 6, sides.id);
  playLocked(cross4, "L", cross3.protectedSideColors);
  completeCross("L", cross4.id);

  for (const [index, segment] of edges.segments.entries()) {
    playLocked(segment, "D", cross3.protectedSideColors, index === 0);
    completeCross("D", segment.id);
  }
  const cross = cfop.segments.find(({ name }) => name === "Cross");
  require(cross?.moveCount === 0, "F2L entry");
  pattern = pattern.applyAlg(cfop.solution);
  require(pattern.experimentalIsSolved({ ignorePuzzleOrientation: true }), "solved state");
}
