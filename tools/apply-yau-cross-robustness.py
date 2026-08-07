from pathlib import Path

path = Path('solver/edgePairing444.js')
s = path.read_text()

def replace_once(old, new, label):
    global s
    if old not in s:
        raise SystemExit(f'missing anchor: {label}')
    s = s.replace(old, new, 1)

replace_once(
'''const YAU_TARGET_BEAM_WIDTH = 3600;
const YAU_TARGET_MAX_MACROS = 6;
const YAU_ALIGNMENT_BEAM_WIDTH = 5000;
const YAU_ALIGNMENT_MAX_DEPTH = 8;''',
'''const YAU_TARGET_BEAM_WIDTH = 3600;
const YAU_TARGET_RESCUE_BEAM_WIDTH = 10000;
const YAU_TARGET_MAX_MACROS = 6;
const YAU_TARGET_RESCUE_MAX_MACROS = 10;
const YAU_ALIGNMENT_BEAM_WIDTH = 5000;
const YAU_ALIGNMENT_RESCUE_BEAM_WIDTH = 12000;
const YAU_ALIGNMENT_MAX_DEPTH = 8;
const YAU_ALIGNMENT_RESCUE_MAX_DEPTH = 11;''',
'Yau search constants',
)

replace_once(
'''  postAction = null,
  minPairCount = 0,
) {''',
'''  postAction = null,
  minPairCount = 0,
  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
) {''',
'target search signature',
)

replace_once(
'''        const key = compactStateKey(nextState, false);''',
'''        // The fast pass keys only the wings. The rescue pass also keys the
        // center permutation: two nodes with identical wings can differ in
        // whether a later macro sequence can restore the exact Yau center
        // snapshot, so collapsing those nodes makes the search incomplete.
        const key = compactStateKey(nextState, centerAwareKey);''',
'center-aware target search key',
)

replace_once(
'''      .sort((left, right) => right.score - left.score)
      .slice(0, YAU_TARGET_BEAM_WIDTH);
  }
  return overshoot;
}

function searchOuterCrossAlignment444(initialState, targetTypeMask, model, deadlineTs) {''',
'''      .sort((left, right) => right.score - left.score)
      .slice(0, beamWidth);
  }
  return overshoot;
}

function searchOuterCrossAlignment444(
  initialState,
  targetTypeMask,
  model,
  deadlineTs,
  maxDepth = YAU_ALIGNMENT_MAX_DEPTH,
  beamWidth = YAU_ALIGNMENT_BEAM_WIDTH,
) {''',
'beam width and alignment signature',
)

replace_once(
'''  for (let depth = 0; depth < YAU_ALIGNMENT_MAX_DEPTH; depth += 1) {''',
'''  for (let depth = 0; depth < maxDepth; depth += 1) {''',
'alignment max depth',
)

replace_once(
'''      .sort((left, right) => right.score - left.score)
      .slice(0, YAU_ALIGNMENT_BEAM_WIDTH);
  }
  return null;
}''',
'''      .sort((left, right) => right.score - left.score)
      .slice(0, beamWidth);
  }
  return null;
}''',
'alignment beam width',
)

replace_once(
'''  const maxMacros = Math.max(0, Math.min(8, Number(options?.maxMacros) || YAU_TARGET_MAX_MACROS));''',
'''  const maxMacros = Math.max(0, Math.min(YAU_TARGET_RESCUE_MAX_MACROS, Number(options?.maxMacros) || YAU_TARGET_MAX_MACROS));
  const enableRescue = options?.enableRescue !== false;''',
'max macro clamp and rescue flag',
)

replace_once(
'''  const paired = searchTargetEdgeTypes444(
    initialState,
    targetMask,
    requiredTypeMask,
    targetCount,
    model,
    deadlineTs,
    maxMacros,
    postAction,
  );
  if (!paired) {
    return {
      ok: false,
      reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_TARGET_EDGES_NOT_FOUND",
    };
  }''',
'''  let paired = searchTargetEdgeTypes444(
    initialState,
    targetMask,
    requiredTypeMask,
    targetCount,
    model,
    deadlineTs,
    maxMacros,
    postAction,
  );
  let searchRescueUsed = false;
  let searchMaxMacros = maxMacros;
  if (enableRescue && !paired && maxMacros > 0 && !deadlineReached(deadlineTs)) {
    searchMaxMacros = Math.max(maxMacros, YAU_TARGET_RESCUE_MAX_MACROS);
    paired = searchTargetEdgeTypes444(
      initialState,
      targetMask,
      requiredTypeMask,
      targetCount,
      model,
      deadlineTs,
      searchMaxMacros,
      postAction,
      0,
      YAU_TARGET_RESCUE_BEAM_WIDTH,
      true,
    );
    searchRescueUsed = paired != null;
  }
  if (!paired) {
    return {
      ok: false,
      reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_TARGET_EDGES_NOT_FOUND",
      detail: JSON.stringify({ targetCount, maxMacros, rescueEnabled: enableRescue, rescueMaxMacros: searchMaxMacros }),
    };
  }''',
'target search rescue',
)

replace_once(
'''  let finalState = paired.state;
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
  }''',
'''  let finalState = paired.state;
  let alignmentMoves = [];
  let alignmentRescueUsed = false;
  if (alignSolved) {
    let alignment = searchOuterCrossAlignment444(finalState, targetMask, model, deadlineTs);
    if (enableRescue && !alignment && !deadlineReached(deadlineTs)) {
      alignment = searchOuterCrossAlignment444(
        finalState,
        targetMask,
        model,
        deadlineTs,
        YAU_ALIGNMENT_RESCUE_MAX_DEPTH,
        YAU_ALIGNMENT_RESCUE_BEAM_WIDTH,
      );
      alignmentRescueUsed = alignment != null;
    }
    if (!alignment) {
      return {
        ok: false,
        reason: deadlineReached(deadlineTs) ? "444_YAU_DEADLINE_REACHED" : "444_YAU_CROSS_ALIGNMENT_FAILED",
        detail: JSON.stringify({
          rescueEnabled: enableRescue,
          primaryMaxDepth: YAU_ALIGNMENT_MAX_DEPTH,
          rescueMaxDepth: YAU_ALIGNMENT_RESCUE_MAX_DEPTH,
        }),
      };
    }
    finalState = alignment.state;
    alignmentMoves = alignment.moves;
  }''',
'alignment rescue',
)

replace_once(
'''    macroCount: paired.path.length,
    alignmentMoveCount: alignmentMoves.length,
    method: "Yau Cross Edges",''',
'''    macroCount: paired.path.length,
    alignmentMoveCount: alignmentMoves.length,
    searchRescueUsed,
    searchMaxMacros,
    alignmentRescueUsed,
    method: "Yau Cross Edges",''',
'return rescue diagnostics',
)

path.write_text(s)
print('patched Yau cross search robustness')
