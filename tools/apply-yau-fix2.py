from pathlib import Path


def rep(s, old, new, label):
    assert old in s, f"missing {label}"
    return s.replace(old, new, 1)

p = Path("solver/solver444.js")
s = p.read_text()
old = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
  );
  if (!remainingEdges?.ok) {
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", remainingEdges?.reason || remainingEdges?.detail, deadlineTs);
  }

  const internalYauSetup = translate444MoveConvention(yauSetupPublic);
  const internalYauEdges = translate444MoveConvention(remainingEdges.solution || "");'''
new = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );
  if (!remainingEdges?.ok) {
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", remainingEdges?.reason || remainingEdges?.detail, deadlineTs);
  }

  const beforeCrossRestore = [yauSetupPublic, remainingEdges.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const crossRestore = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    beforeCrossRestore,
    targetTypeMask,
    {
      targetCount: 4,
      requiredTypeMask: targetTypeMask,
      alignSolved: true,
      deadlineTs,
      maxMacros: 0,
    },
  );
  if (!crossRestore?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS_RESTORE_FAILED", crossRestore?.reason || crossRestore?.detail, deadlineTs);
  }
  const yauRemainingEdgePublic = [remainingEdges.solution, crossRestore.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const internalYauSetup = translate444MoveConvention(yauSetupPublic);
  const internalYauEdges = translate444MoveConvention(yauRemainingEdgePublic);'''
s = rep(s, old, new, "relax cross position during edge pairing")
old = '''  const internalEdgeSegments = (Array.isArray(remainingEdges.segments) ? remainingEdges.segments : []).map((segment) => ({
    ...segment,
    solution: translate444MoveConvention(segment?.solution || ""),
    verified: true,
  }));
  const yauEdgeStage = {'''
new = '''  const internalEdgeSegments = (Array.isArray(remainingEdges.segments) ? remainingEdges.segments : []).map((segment) => ({
    ...segment,
    solution: translate444MoveConvention(segment?.solution || ""),
    verified: true,
  }));
  if (crossRestore.solution) {
    internalEdgeSegments.push({
      id: "yauCrossRestore",
      name: "Yau · Cross Restore",
      solution: translate444MoveConvention(crossRestore.solution),
      moveCount: splitAlgorithm(crossRestore.solution).length,
      pairStart: 12,
      pairEnd: 12,
      alreadyPaired: true,
      verified: true,
    });
  }
  const yauEdgeStage = {'''
s = rep(s, old, new, "append cross restore segment")
old = '''      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
new = '''      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
s = rep(s, old, new, "cross restore meta")
p.write_text(s)

print("Yau cross restore fix applied")
