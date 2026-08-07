from pathlib import Path


def replace_once(text, old, new, label):
    assert old in text, f"missing anchor: {label}"
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Edge planner: targeted cross-edge pairing + protected Yau 3-2-3.
# ---------------------------------------------------------------------------
p = Path("solver/edgePairing444.js")
s = p.read_text()

anchor = "const EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);"
insert = '''const EDGE_SLOT_TO_333_444 = Object.freeze([0, 8, 9, 4, 5, 7, 6, 3, 11, 10, 2, 1]);
const EDGE_NAMES_333_444 = Object.freeze(["UF", "UR", "UB", "UL", "DF", "DR", "DB", "DL", "FR", "FL", "BR", "BL"]);

export function crossEdgeTypeMask444(crossColor = "D") {
  const face = /^[URFDLB]$/i.test(String(crossColor || "D"))
    ? String(crossColor || "D").toUpperCase()
    : "D";
  let mask = 0;
  EDGE_SLOT_TO_333_444.forEach((cubieIndex, edgeType) => {
    if (EDGE_NAMES_333_444[cubieIndex].includes(face)) mask |= 1 << edgeType;
  });
  return mask;
}

'''
s = replace_once(s, anchor, insert + anchor, "edge mapping")

anchor = "function pairedEdgeTypeMaskInSlots(state, slotMask) {"
insert = '''function solvedEdgeTypeMask(state) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType === slot &&
      secondType === slot &&
      state.edgeOrientation[first] === 0 &&
      state.edgeOrientation[second] === 0
    ) {
      mask |= 1 << slot;
    }
  }
  return mask;
}

function chooseTargetTypeMask(pairedMask, targetMask, requiredMask, targetCount) {
  if (!maskContains(pairedMask, requiredMask)) return 0;
  let selected = requiredMask & targetMask;
  for (let edgeType = 0; edgeType < 12 && bitCount(selected) < targetCount; edgeType += 1) {
    const bit = 1 << edgeType;
    if ((targetMask & bit) && (pairedMask & bit) && !(selected & bit)) selected |= bit;
  }
  return bitCount(selected) === targetCount ? selected : 0;
}

'''
s = replace_once(s, anchor, insert + anchor, "solved edge masks")

old = '''function searchSliceCycleAcrossFrames(
  initialState,
  lockedTypeMask,
  targetCount,
  preferredFamily,
  model,
  deadlineTs,
  maxOuterMoves = SLICE_MAX_OUTER_MOVES,
) {'''
new = '''function searchSliceCycleAcrossFrames(
  initialState,
  lockedTypeMask,
  targetCount,
  preferredFamily,
  model,
  deadlineTs,
  maxOuterMoves = SLICE_MAX_OUTER_MOVES,
  requiredSolvedTypeMask = 0,
) {'''
s = replace_once(s, old, new, "across-frames signature")
old = '''      deadlineTs,
      maxOuterMoves,
    );'''
new = '''      deadlineTs,
      maxOuterMoves,
      requiredSolvedTypeMask,
    );'''
s = replace_once(s, old, new, "across-frames call")

old = "function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES) {"
new = "function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES, requiredSolvedTypeMask = 0) {"
s = replace_once(s, old, new, "slice signature")
old = '''        if (
          maskContains(closedMask, lockedMask) &&
          bitCount(closedMask) >= targetCount &&
          centersSolved(closedState, solvedCenters.centerPieces)
        ) {'''
new = '''        if (
          maskContains(closedMask, lockedMask) &&
          bitCount(closedMask) >= targetCount &&
          (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(closedState), requiredSolvedTypeMask)) &&
          centersSolved(closedState, solvedCenters.centerPieces)
        ) {'''
s = replace_once(s, old, new, "slice protected solved cross")

old = "function findL2E(initialState, model, deadlineTs) {"
new = "function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0) {"
s = replace_once(s, old, new, "L2E signature")
old = '''      if (
        bitCount(pairedSlotMask(candidate)) === 12 &&
        centersSolved(candidate, solvedCenters.centerPieces)
      ) {'''
new = '''      if (
        bitCount(pairedSlotMask(candidate)) === 12 &&
        (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(candidate), requiredSolvedTypeMask)) &&
        centersSolved(candidate, solvedCenters.centerPieces)
      ) {'''
s = replace_once(s, old, new, "L2E protected solved cross")

anchor = "function buildSegment(id, name, moves, pairStart, pairEnd) {"
insert = r'''const YAU_TARGET_BEAM_WIDTH = 1800;
const YAU_TARGET_MAX_MACROS = 6;
const YAU_ALIGNMENT_BEAM_WIDTH = 5000;
const YAU_ALIGNMENT_MAX_DEPTH = 8;

function searchTargetEdgeTypes444(
  initialState,
  targetTypeMask,
  requiredTypeMask,
  targetCount,
  model,
  deadlineTs,
  maxMacros = YAU_TARGET_MAX_MACROS,
) {
  const evaluate = (node) => {
    const pairedMask = pairedEdgeTypeMask(node.state);
    const targetPaired = bitCount(pairedMask & targetTypeMask);
    return {
      ...node,
      pairedMask,
      targetPaired,
      score: targetPaired * 100000 + bitCount(pairedMask) * 1000 - node.path.length,
    };
  };

  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
  for (let depth = 0; depth <= maxMacros; depth += 1) {
    if (deadlineReached(deadlineTs)) return null;
    const goals = beam
      .filter((node) => maskContains(node.pairedMask, requiredTypeMask) && node.targetPaired >= targetCount)
      .sort((left, right) => {
        const leftExact = left.targetPaired === targetCount ? 1 : 0;
        const rightExact = right.targetPaired === targetCount ? 1 : 0;
        return rightExact - leftExact || right.score - left.score;
      });
    if (goals.length && goals[0].targetPaired === targetCount) return goals[0];
    if (goals.length && !overshoot) overshoot = goals[0];
    if (depth === maxMacros) break;

    const seen = new Map();
    for (const node of beam) {
      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, false);
        const pairedMask = pairedEdgeTypeMask(nextState);
        if (!maskContains(pairedMask, requiredTypeMask)) continue;
        const candidate = evaluate({ state: nextState, path: [...node.path, actionIndex] });
        const key = compactStateKey(nextState, false);
        const previous = seen.get(key);
        if (!previous || previous.score < candidate.score) seen.set(key, candidate);
      }
    }
    beam = [...seen.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, YAU_TARGET_BEAM_WIDTH);
  }
  return overshoot;
}

function searchOuterCrossAlignment444(initialState, targetTypeMask, model, deadlineTs) {
  const solvedCenters = model.solvedCompact;
  const initialSolvedMask = solvedEdgeTypeMask(initialState);
  if (
    maskContains(initialSolvedMask, targetTypeMask) &&
    centersSolved(initialState, solvedCenters.centerPieces)
  ) {
    return { state: initialState, moves: [] };
  }

  let beam = [{
    state: initialState,
    path: [],
    lastFace: "",
    score: bitCount(initialSolvedMask & targetTypeMask) * 10000,
  }];
  for (let depth = 0; depth < YAU_ALIGNMENT_MAX_DEPTH; depth += 1) {
    if (deadlineReached(deadlineTs)) return null;
    const seen = new Map();
    for (const node of beam) {
      for (const move of OUTER_MOVES_444) {
        if (node.lastFace && node.lastFace === move[0]) continue;
        const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
        if (!maskContains(pairedEdgeTypeMask(nextState), targetTypeMask)) continue;
        const solvedMask = solvedEdgeTypeMask(nextState);
        const path = [...node.path, move];
        if (
          maskContains(solvedMask, targetTypeMask) &&
          centersSolved(nextState, solvedCenters.centerPieces)
        ) {
          return { state: nextState, moves: path };
        }
        const score = bitCount(solvedMask & targetTypeMask) * 10000
          + bitCount(solvedMask) * 120
          - path.length;
        const key = compactStateKey(nextState, true);
        const previous = seen.get(key);
        if (!previous || previous.score < score) {
          seen.set(key, { state: nextState, path, lastFace: move[0], score });
        }
      }
    }
    beam = [...seen.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, YAU_ALIGNMENT_BEAM_WIDTH);
  }
  return null;
}

export async function solveTargetEdgeTypes444(
  publicScramble,
  publicSetupSolution,
  targetTypeMask,
  options = {},
) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const model = await getPlannerModel();
  const targetMask = Number(targetTypeMask) >>> 0;
  const requiredTypeMask = Number(options?.requiredTypeMask) >>> 0;
  const targetCount = Math.max(1, Math.min(bitCount(targetMask), Number(options?.targetCount) || bitCount(targetMask)));
  const maxMacros = Math.max(0, Math.min(8, Number(options?.maxMacros) || YAU_TARGET_MAX_MACROS));
  const alignSolved = options?.alignSolved === true;
  if (!targetMask || deadlineReached(deadlineTs)) {
    return { ok: false, reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_BAD_TARGET" };
  }

  let pattern = model.solved;
  const scramble = String(publicScramble || "").trim();
  const setup = String(publicSetupSolution || "").trim();
  if (scramble) pattern = pattern.applyAlg(scramble);
  if (setup) pattern = pattern.applyAlg(setup);
  const centerSnapshot = JSON.stringify(pattern.patternData.CENTERS);
  const initialState = compactStateFromPattern(pattern);
  const initialPaired = pairedEdgeTypeMask(initialState);
  if (!maskContains(initialPaired, requiredTypeMask)) {
    return { ok: false, reason: "444_YAU_REQUIRED_CROSS_BROKEN" };
  }

  const paired = searchTargetEdgeTypes444(
    initialState,
    targetMask,
    requiredTypeMask,
    targetCount,
    model,
    deadlineTs,
    maxMacros,
  );
  if (!paired) {
    return {
      ok: false,
      reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_TARGET_EDGES_NOT_FOUND",
    };
  }

  const lockedTypeMask = chooseTargetTypeMask(
    paired.pairedMask,
    targetMask,
    requiredTypeMask,
    targetCount,
  );
  if (!lockedTypeMask) return { ok: false, reason: "444_YAU_TARGET_LOCK_FAILED" };

  const pairMoves = paired.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
  let finalState = paired.state;
  let alignmentMoves = [];
  if (alignSolved) {
    const alignment = searchOuterCrossAlignment444(finalState, targetMask, model, deadlineTs);
    if (!alignment) {
      return {
        ok: false,
        reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_CROSS_ALIGNMENT_FAILED",
      };
    }
    finalState = alignment.state;
    alignmentMoves = alignment.moves;
  }

  const moves = simplifyOuterSequence([...pairMoves, ...alignmentMoves]);
  const solution = moves.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedPaired = pairedEdgeTypeMask(verifiedState);
  if (
    bitCount(verifiedPaired & targetMask) < targetCount ||
    !maskContains(verifiedPaired, requiredTypeMask)
  ) {
    return { ok: false, reason: "444_YAU_TARGET_VERIFICATION_FAILED" };
  }
  if (alignSolved && !maskContains(solvedEdgeTypeMask(verifiedState), targetMask)) {
    return { ok: false, reason: "444_YAU_CROSS_ALIGNMENT_VERIFICATION_FAILED" };
  }
  if (alignSolved) {
    if (!centersSolved(verifiedState, model.solvedCompact.centerPieces)) {
      return { ok: false, reason: "444_YAU_ALIGNMENT_BREAKS_CENTERS" };
    }
  } else if (JSON.stringify(verified.patternData.CENTERS) !== centerSnapshot) {
    return { ok: false, reason: "444_YAU_PAIRING_BREAKS_CENTERS" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: moves.length,
    pairedTargetMask: verifiedPaired & targetMask,
    lockedTypeMask,
    solvedTargetMask: solvedEdgeTypeMask(verifiedState) & targetMask,
    targetCount,
    macroCount: paired.path.length,
    alignmentMoveCount: alignmentMoves.length,
    method: "Yau Cross Edges",
  };
}

'''
s = replace_once(s, anchor, insert + anchor, "Yau target planner")

# Add Yau requirements to the existing 3-2-3 entry point.
old = '''export async function solveEdgePairing323(publicScramble, publicCenterSolution, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const model = await getPlannerModel();'''
new = '''export async function solveEdgePairing323(publicScramble, publicCenterSolution, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const requiredTypeMask = Number(options?.requiredTypeMask) >>> 0;
  const requiredSolvedTypeMask = Number(options?.requiredSolvedTypeMask) >>> 0;
  const yauBank = bitCount(requiredTypeMask) === 4;
  const edgeMethod = yauBank ? "Yau 3-2-3" : "3-2-3";
  const model = await getPlannerModel();'''
s = replace_once(s, old, new, "3-2-3 options")
old = '''  const initialMask = pairedSlotMask(initialState);
  if (bitCount(initialMask) === 12) {
    return { ok: true, reason: null, solution: "", moveCount: 0, segments: [], method: "3-2-3" };
  }'''
new = '''  const initialMask = pairedSlotMask(initialState);
  const initialTypeMask = pairedEdgeTypeMask(initialState);
  if (!maskContains(initialTypeMask, requiredTypeMask)) {
    return { ok: false, reason: "444_323_REQUIRED_TYPES_NOT_PAIRED", solution: "", segments: [], method: edgeMethod };
  }
  if (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(initialState), requiredSolvedTypeMask)) {
    return { ok: false, reason: "444_323_REQUIRED_CROSS_NOT_SOLVED", solution: "", segments: [], method: edgeMethod };
  }
  if (bitCount(initialMask) === 12) {
    return { ok: true, reason: null, solution: "", moveCount: 0, segments: [], method: edgeMethod };
  }'''
s = replace_once(s, old, new, "3-2-3 required masks")
old = '''    const sliceFamily = model.sliceFamilies[frameIndex];
    const seedCandidates = collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);'''
new = '''    const sliceFamily = model.sliceFamilies[frameIndex];
    const seedCandidates = yauBank
      ? [{ state: initialState, path: [], score: Number.MAX_SAFE_INTEGER }]
      : collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);'''
s = replace_once(s, old, new, "Yau bank seed")
old = "      const bankTypeMask = pairedEdgeTypeMaskInSlots(seed.state, sliceFamily.bankMask);"
new = '''      const bankTypeMask = yauBank
        ? chooseProtectedTypeMask(pairedEdgeTypeMask(seed.state), requiredTypeMask, 4)
        : pairedEdgeTypeMaskInSlots(seed.state, sliceFamily.bankMask);
      if (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(seed.state), requiredSolvedTypeMask)) continue;'''
s = replace_once(s, old, new, "Yau bank types")
old = '''        model,
        deadlineTs,
      );
      if (!firstThree) {'''
new = '''        model,
        deadlineTs,
        SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
      );
      if (!firstThree) {'''
s = replace_once(s, old, new, "first-three protected cross")
# The three across-frame searches use max depth 7.
s = s.replace(
    '''        deadlineTs,
        7,
      );''',
    '''        deadlineTs,
        7,
        requiredSolvedTypeMask,
      );''',
)
old = "        : findL2E(beforeL2E.state, model, deadlineTs);"
new = "        : findL2E(beforeL2E.state, model, deadlineTs, requiredSolvedTypeMask);"
s = replace_once(s, old, new, "Yau L2E protection")
old = '''      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const segments = [
        buildSegment("edge323Bank", "Edge Bank 4/12", seedMoves, 1, 4),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, 5, 7),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, 8, 9),
      ];'''
new = '''      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const bankSegment = yauBank
        ? {
            id: "edge323Bank",
            name: "Yau Cross Bank 4/12",
            solution: "",
            moveCount: 0,
            pairStart: 1,
            pairEnd: 4,
            alreadyPaired: true,
            verified: true,
          }
        : buildSegment("edge323Bank", "Edge Bank 4/12", seedMoves, 1, 4);
      const segments = [
        bankSegment,
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, 5, 7),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, 8, 9),
      ];'''
s = replace_once(s, old, new, "Yau bank segment")
s = s.replace('method: "3-2-3",', 'method: edgeMethod,')

p.write_text(s)


# ---------------------------------------------------------------------------
# 4x4 coordinator: method option + Yau reduction construction.
# ---------------------------------------------------------------------------
p = Path("solver/solver444.js")
s = p.read_text()
anchor = "function normalizeBoundaryResponse(raw) {"
insert = r'''function yauFailure444(reduction, reason, detail = null, deadlineTs = 0) {
  const timedOut = deadlineReached(deadlineTs);
  return {
    ...reduction,
    ok: false,
    status: timedOut ? "timeout" : "partial",
    reason: timedOut ? "444_DEADLINE_REACHED" : reason,
    detail: detail == null ? null : String(detail),
    solution: "",
    moveCount: 0,
    verified: false,
    stages: [],
    meta: {
      ...reduction.meta,
      method444: "yau",
      yauAttempted: true,
      yauFallbackReason: detail || reason,
    },
  };
}

async function preferYauReduction444(
  api,
  reduction,
  publicScramble,
  internalScramble,
  crossColor,
  deadlineTs,
) {
  if (
    reduction?.status !== "partial" ||
    reduction?.reason !== "444_REDUCTION_INCOMPLETE" ||
    reduction?.meta?.centersSolved !== true ||
    reduction?.meta?.edgesPaired !== true
  ) {
    return yauFailure444(reduction, "444_YAU_REDUCTION_BASE_INVALID", reduction?.reason, deadlineTs);
  }

  const sourceCenterStage = Array.isArray(reduction.stages)
    ? reduction.stages.find((stage) => stage?.id === "centers" && stage?.verified === true)
    : null;
  if (!sourceCenterStage) {
    return yauFailure444(reduction, "444_YAU_CENTER_SOURCE_MISSING", null, deadlineTs);
  }

  const phaseCounts = Array.isArray(reduction.meta?.centerPhaseMoveCounts)
    ? reduction.meta.centerPhaseMoveCounts.map((value) => Math.max(0, Number(value) || 0))
    : [];
  if (phaseCounts.length !== 4) {
    return yauFailure444(reduction, "444_YAU_CENTER_PHASES_MISSING", null, deadlineTs);
  }
  const publicCenterMoves = splitAlgorithm(translate444MoveConvention(sourceCenterStage.solution || ""));
  if (phaseCounts.reduce((sum, value) => sum + value, 0) !== publicCenterMoves.length) {
    return yauFailure444(reduction, "444_YAU_CENTER_PHASE_COUNT_MISMATCH", null, deadlineTs);
  }

  const p1End = phaseCounts[0];
  const p2End = p1End + phaseCounts[1];
  const p3End = p2End + phaseCounts[2];
  const firstCenter = publicCenterMoves.slice(0, p1End).join(" ");
  const oppositeCenter = publicCenterMoves.slice(p1End, p2End).join(" ");
  const remainingCenters = publicCenterMoves.slice(p2End).join(" ");
  const firstTwoCenters = [firstCenter, oppositeCenter].filter(Boolean).join(" ");

  let edgeModule;
  try {
    edgeModule = await import("./edgePairing444.js");
  } catch (error) {
    return yauFailure444(reduction, "444_YAU_EDGE_MODULE_FAILED", error?.message || error, deadlineTs);
  }
  const targetTypeMask = edgeModule.crossEdgeTypeMask444(crossColor);

  const cross3 = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    firstTwoCenters,
    targetTypeMask,
    { targetCount: 3, deadlineTs, maxMacros: 6 },
  );
  if (!cross3?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS3_FAILED", cross3?.reason || cross3?.detail, deadlineTs);
  }

  const beforeCross4 = [firstTwoCenters, cross3.solution, remainingCenters]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const cross4 = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    beforeCross4,
    targetTypeMask,
    {
      targetCount: 4,
      requiredTypeMask: cross3.lockedTypeMask,
      alignSolved: true,
      deadlineTs,
      maxMacros: 6,
    },
  );
  if (!cross4?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS4_FAILED", cross4?.reason || cross4?.detail, deadlineTs);
  }

  const yauSetupPublic = [beforeCross4, cross4.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
  );
  if (!remainingEdges?.ok) {
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", remainingEdges?.reason || remainingEdges?.detail, deadlineTs);
  }

  const internalYauSetup = translate444MoveConvention(yauSetupPublic);
  const internalYauEdges = translate444MoveConvention(remainingEdges.solution || "");
  const continuationScramble = [internalScramble, internalYauSetup, internalYauEdges]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  let continued;
  try {
    continued = normalizeBoundaryResponse(api.solve({
      scramble: continuationScramble,
      crossColor,
      deadlineTs,
    }));
  } catch (error) {
    return yauFailure444(reduction, "444_YAU_CONTINUATION_FAILED", error?.message || error, deadlineTs);
  }
  const parityStage = Array.isArray(continued.stages)
    ? continued.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;
  if (
    continued.status !== "partial" ||
    continued.reason !== "444_REDUCTION_INCOMPLETE" ||
    continued.meta?.virtual333Ready !== true ||
    !continued.meta?.virtual333 ||
    !parityStage
  ) {
    return yauFailure444(reduction, "444_YAU_CONTINUATION_INVALID", continued.reason, deadlineTs);
  }

  const makeSetupSegment = (id, name, publicSolution, extra = {}) => {
    const internalSolution = translate444MoveConvention(publicSolution || "");
    return {
      id,
      name,
      solution: internalSolution,
      moveCount: splitAlgorithm(internalSolution).length,
      verified: true,
      ...extra,
    };
  };
  const setupSegments = [
    makeSetupSegment("yauFirstCenter", "Yau · First Center", firstCenter),
    makeSetupSegment("yauOppositeCenter", "Yau · Opposite Center", oppositeCenter),
    makeSetupSegment("yauCross3", "Yau · Cross Edges 3/4", cross3.solution, {
      crossEdgeCount: 3,
      lockedTypeMask: cross3.lockedTypeMask,
    }),
    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", remainingCenters),
    makeSetupSegment("yauCross4", "Yau · Cross Edge 4/4", cross4.solution, {
      crossEdgeCount: 4,
      alignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
    }),
  ];
  const yauSetupStage = {
    id: "centers",
    name: "Yau Setup",
    solution: internalYauSetup,
    moveCount: splitAlgorithm(internalYauSetup).length,
    verified: true,
    method: "Yau",
    segments: setupSegments,
  };

  const internalEdgeSegments = (Array.isArray(remainingEdges.segments) ? remainingEdges.segments : []).map((segment) => ({
    ...segment,
    solution: translate444MoveConvention(segment?.solution || ""),
    verified: true,
  }));
  const yauEdgeStage = {
    id: "edges",
    name: "Edge Pairing · Yau 3-2-3",
    solution: internalYauEdges,
    moveCount: splitAlgorithm(internalYauEdges).length,
    verified: true,
    method: "Yau 3-2-3",
    segments: internalEdgeSegments,
  };

  return {
    ...continued,
    stages: [yauSetupStage, yauEdgeStage, parityStage],
    meta: {
      ...continued.meta,
      parsedMoveCount: reduction.meta?.parsedMoveCount,
      scrambleValid: reduction.meta?.scrambleValid,
      stateValid: reduction.meta?.stateValid,
      solvedState: reduction.meta?.solvedState,
      centersSolved: true,
      centerMoveCount: yauSetupStage.moveCount,
      centerPhaseMoveCounts: [...phaseCounts],
      centerTableBuildMs: Number(reduction.meta?.centerTableBuildMs) || 0,
      centerSearchMs: Number(reduction.meta?.centerSearchMs) || 0,
      edgesPaired: true,
      edgeMoveCount: yauEdgeStage.moveCount,
      edgeTableBuildMs: 0,
      edgeSearchMs: Number(remainingEdges.meta?.diagnostics?.elapsedMs) || 0,
      edgeMethod: "Yau 3-2-3",
      method444: "yau",
      yauAttempted: true,
      yauFallbackReason: null,
      yauCrossTypeMask: targetTypeMask,
      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauPureCenterMoveCount: publicCenterMoves.length,
      yauRemainingCenterMoveCount: splitAlgorithm(remainingCenters).length,
      yauEdge323: remainingEdges.meta && typeof remainingEdges.meta === "object"
        ? { ...remainingEdges.meta }
        : {},
    },
  };
}

'''
s = replace_once(s, anchor, insert + anchor, "Yau reduction coordinator")

old = '''export async function solve444(scramble, onProgress = null, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossColor = /^[URFDLB]$/i.test(String(options?.crossColor || "D"))
    ? String(options?.crossColor || "D").toUpperCase()
    : "D";'''
new = '''export async function solve444(scramble, onProgress = null, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossColor = /^[URFDLB]$/i.test(String(options?.crossColor || "D"))
    ? String(options?.crossColor || "D").toUpperCase()
    : "D";
  const method444 = String(options?.method444 || "reduction").trim().toLowerCase() === "yau"
    ? "yau"
    : "reduction";'''
s = replace_once(s, old, new, "4x4 method option")

old = '''  result = await preferHumanEdgePairing323(
    api,
    result,
    publicScramble,
    internalScramble,
    crossColor,
    deadlineTs,
  );'''
new = '''  result = method444 === "yau"
    ? await preferYauReduction444(
        api,
        result,
        publicScramble,
        internalScramble,
        crossColor,
        deadlineTs,
      )
    : await preferHumanEdgePairing323(
        api,
        result,
        publicScramble,
        internalScramble,
        crossColor,
        deadlineTs,
      );'''
s = replace_once(s, old, new, "method branch")

old = '''    if (publicEdgeStage && publicEdgeStage.method !== "3-2-3") {'''
new = '''    if (publicEdgeStage && !String(publicEdgeStage.method || "").includes("3-2-3")) {'''
s = replace_once(s, old, new, "retain Yau edge segments")
old = '''    const centerHuman = publicCenterStage
      ? buildHumanCenterPresentation444(publicCenterStage, result.meta?.centerPhaseMoveCounts, crossColor)
      : null;'''
new = '''    const centerHuman = publicCenterStage && publicCenterStage.method !== "Yau"
      ? buildHumanCenterPresentation444(publicCenterStage, result.meta?.centerPhaseMoveCounts, crossColor)
      : null;'''
s = replace_once(s, old, new, "preserve Yau setup order")
old = '''      crossColor,
      humanViewpointApplied,'''
new = '''      crossColor,
      method444: result.meta?.method444 === "yau" ? "yau" : method444,
      humanViewpointApplied,'''
s = replace_once(s, old, new, "final method meta")
p.write_text(s)


# ---------------------------------------------------------------------------
# Worker option plumbing.
# ---------------------------------------------------------------------------
p = Path("solver/solverWorker.js")
s = p.read_text()
old = '''    let benchmarkNoFallback = false;
    let deadlineTs = 0;'''
new = '''    let benchmarkNoFallback = false;
    let deadlineTs = 0;
    let method444 = "reduction";'''
s = replace_once(s, old, new, "worker method variable")
old = '''      if (Number.isFinite(Number(arg1.deadlineTs))) {
        deadlineTs = Math.max(0, Number(arg1.deadlineTs));
      }
      benchmarkNoFallback = arg1.benchmarkNoFallback === true;'''
new = '''      if (Number.isFinite(Number(arg1.deadlineTs))) {
        deadlineTs = Math.max(0, Number(arg1.deadlineTs));
      }
      if (typeof arg1.method444 === "string" && arg1.method444) {
        method444 = arg1.method444.trim().toLowerCase() === "yau" ? "yau" : "reduction";
      }
      benchmarkNoFallback = arg1.benchmarkNoFallback === true;'''
s = replace_once(s, old, new, "worker method parse")
old = '''        solve444Lazy(scramble, onProgress, {
          deadlineTs: effective444DeadlineTs,
          crossColor,
        }),'''
new = '''        solve444Lazy(scramble, onProgress, {
          deadlineTs: effective444DeadlineTs,
          crossColor,
          method444,
        }),'''
s = replace_once(s, old, new, "worker method pass")
p.write_text(s)


# ---------------------------------------------------------------------------
# UI: expose 4x4 cross color + method selector and pass both to worker.
# ---------------------------------------------------------------------------
p = Path("index.html")
s = p.read_text()
anchor = '''              <label for="solverModeSelect">
                탐색 모드'''
insert = '''              <label for="solver444MethodSelect" id="solver444MethodField" hidden>
                4×4 방식
                <select id="solver444MethodSelect">
                  <option value="reduction" selected>Reduction · 3-2-3</option>
                  <option value="yau">Yau</option>
                </select>
              </label>
'''
s = replace_once(s, anchor, insert + anchor, "4x4 method selector")
p.write_text(s)

p = Path("solver/solver444UiActivation.js")
s = p.read_text()
old = '''  const solverStageList = document.getElementById("solverStageList");
  const solveTitle = document.getElementById("solveTitle");'''
new = '''  const solverStageList = document.getElementById("solverStageList");
  const solveTitle = document.getElementById("solveTitle");
  const crossColorSelect = document.getElementById("crossColorSelect");
  const solver444MethodField = document.getElementById("solver444MethodField");
  const solver444MethodSelect = document.getElementById("solver444MethodSelect");'''
s = replace_once(s, old, new, "4x4 UI controls")
old = '''  const threeByThreeOnly = [
    document.getElementById("crossColorSelect")?.closest("label"),
    document.getElementById("solverModeSelect")?.closest("label"),'''
new = '''  const threeByThreeOnly = [
    document.getElementById("solverModeSelect")?.closest("label"),'''
s = replace_once(s, old, new, "keep cross color visible")
old = '''    const title = document.createElement("strong");
    title.textContent = STAGE_LABELS[stage?.id] || String(stage?.name || stage?.id || "단계");'''
new = '''    const title = document.createElement("strong");
    title.textContent = stage?.method === "Yau"
      ? "Yau Setup"
      : STAGE_LABELS[stage?.id] || String(stage?.name || stage?.id || "단계");'''
s = replace_once(s, old, new, "Yau setup label")
old = '''    setStatus(`4×4 해를 찾았습니다. ${moveCount}수 · 96-facelet 검증 완료`);'''
new = '''    const methodLabel = result?.meta?.method444 === "yau" ? "Yau · " : "";
    setStatus(`4×4 ${methodLabel}해를 찾았습니다. ${moveCount}수 · 96-facelet 검증 완료`);'''
s = replace_once(s, old, new, "Yau success status")
old = '''        {
          scramble,
          eventId: EVENT_ID,
          deadlineTs,
        },'''
new = '''        {
          scramble,
          eventId: EVENT_ID,
          deadlineTs,
          crossColor: /^[URFDLB]$/i.test(String(crossColorSelect?.value || "D"))
            ? String(crossColorSelect.value).toUpperCase()
            : "D",
          method444: solver444MethodSelect?.value === "yau" ? "yau" : "reduction",
        },'''
s = replace_once(s, old, new, "pass Yau UI options")
old = '''    if (is444()) {
      setThreeByThreeControlsHidden(true);
      if (solveTitle) solveTitle.textContent = "4×4 해 찾기";
      findSolutionBtn.title = "검증된 4×4 해 찾기";
      syncButton();
      return;
    }

    runId += 1;'''
new = '''    if (is444()) {
      setThreeByThreeControlsHidden(true);
      if (crossColorSelect?.value === "CN") crossColorSelect.value = "D";
      if (solver444MethodField) solver444MethodField.hidden = false;
      if (solveTitle) solveTitle.textContent = "4×4 해 찾기";
      findSolutionBtn.title = solver444MethodSelect?.value === "yau"
        ? "검증된 4×4 Yau 해 찾기"
        : "검증된 4×4 Reduction 해 찾기";
      syncButton();
      return;
    }

    if (solver444MethodField) solver444MethodField.hidden = true;
    runId += 1;'''
s = replace_once(s, old, new, "show Yau selector")
anchor = '''  findSolutionBtn.addEventListener("click", solveCurrent444, true);'''
insert = '''  solver444MethodSelect?.addEventListener("change", () => {
    if (!is444()) return;
    runId += 1;
    busy = false;
    resetResultPresentation();
    findSolutionBtn.title = solver444MethodSelect.value === "yau"
      ? "검증된 4×4 Yau 해 찾기"
      : "검증된 4×4 Reduction 해 찾기";
    syncButton();
  });
  crossColorSelect?.addEventListener("change", () => {
    if (!is444()) return;
    runId += 1;
    busy = false;
    resetResultPresentation();
    syncButton();
  });
'''
s = replace_once(s, anchor, insert + anchor, "Yau selector listeners")
p.write_text(s)

print("Yau integration patch applied")
