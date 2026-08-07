from pathlib import Path


def rep(s, old, new, label):
    assert old in s, f"missing {label}"
    return s.replace(old, new, 1)

p = Path("solver/edgePairing444.js")
s = p.read_text()
old = '''  model,
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
  };'''
new = '''  model,
  deadlineTs,
  maxMacros = YAU_TARGET_MAX_MACROS,
  postAction = null,
) {
  const evaluate = (node) => {
    const pairedMask = pairedEdgeTypeMask(node.state);
    const targetPaired = bitCount(pairedMask & targetTypeMask);
    const postState = postAction ? applyCompactAction(node.state, postAction, true) : node.state;
    const postPairedMask = pairedEdgeTypeMask(postState);
    const preservedTarget = bitCount(pairedMask & postPairedMask & targetTypeMask);
    return {
      ...node,
      pairedMask,
      postPairedMask,
      targetPaired,
      preservedTarget,
      score: preservedTarget * 250000 + targetPaired * 100000 + bitCount(pairedMask) * 1000 - node.path.length,
    };
  };'''
s = rep(s, old, new, "target evaluation")
old = '''    const goals = beam
      .filter((node) => maskContains(node.pairedMask, requiredTypeMask) && node.targetPaired >= targetCount)
      .sort((left, right) => {
        const leftExact = left.targetPaired === targetCount ? 1 : 0;
        const rightExact = right.targetPaired === targetCount ? 1 : 0;
        return rightExact - leftExact || right.score - left.score;
      });
    if (goals.length && goals[0].targetPaired === targetCount) return goals[0];'''
new = '''    const goals = beam
      .filter((node) =>
        maskContains(node.pairedMask, requiredTypeMask) &&
        maskContains(node.postPairedMask, requiredTypeMask) &&
        node.targetPaired >= targetCount &&
        node.preservedTarget >= targetCount
      )
      .sort((left, right) => {
        const leftExact = left.targetPaired === targetCount ? 1 : 0;
        const rightExact = right.targetPaired === targetCount ? 1 : 0;
        return rightExact - leftExact || right.score - left.score;
      });
    if (goals.length && goals[0].targetPaired === targetCount) return goals[0];'''
s = rep(s, old, new, "post-center target goals")
old = '''  const alignSolved = options?.alignSolved === true;
  if (!targetMask || deadlineReached(deadlineTs)) {'''
new = '''  const alignSolved = options?.alignSolved === true;
  const postSequence = String(options?.postSequence || "").trim();
  const postAction = postSequence ? model.actionFor(postSequence) : null;
  if (!targetMask || deadlineReached(deadlineTs)) {'''
s = rep(s, old, new, "post sequence option")
old = '''    deadlineTs,
    maxMacros,
  );'''
new = '''    deadlineTs,
    maxMacros,
    postAction,
  );'''
s = rep(s, old, new, "post action search")
old = '''  const lockedTypeMask = chooseTargetTypeMask(
    paired.pairedMask,
    targetMask,
    requiredTypeMask,
    targetCount,
  );'''
new = '''  const lockedTypeMask = chooseTargetTypeMask(
    paired.pairedMask & paired.postPairedMask,
    targetMask,
    requiredTypeMask,
    targetCount,
  );'''
s = rep(s, old, new, "preserved lock mask")
p.write_text(s)

p = Path("solver/solver444.js")
s = p.read_text()
old = '''    targetTypeMask,
    { targetCount: 3, deadlineTs, maxMacros: 6 },
  );'''
new = '''    targetTypeMask,
    {
      targetCount: 3,
      deadlineTs,
      maxMacros: 6,
      postSequence: remainingCenters,
    },
  );'''
s = rep(s, old, new, "cross3 remaining-center lookahead")
p.write_text(s)

print("Yau remaining-center preservation fix applied")
