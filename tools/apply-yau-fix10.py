from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

anchor = '''function searchTargetEdgeTypes444(
'''
helper = '''function sameCenterState444(left, right) {
  if (!left?.centerPieces || !right?.centerPieces) return false;
  if (left.centerPieces.length !== right.centerPieces.length) return false;
  for (let index = 0; index < left.centerPieces.length; index += 1) {
    if (left.centerPieces[index] !== right.centerPieces[index]) return false;
  }
  return true;
}

'''
assert anchor in s, "missing target edge search"
s = s.replace(anchor, helper + anchor, 1)

old = '''  const evaluate = (node) => {
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
  };

  let beam = [evaluate({ state: initialState, path: [] })];'''
new = '''  const evaluate = (node) => {
    const pairedMask = pairedEdgeTypeMask(node.state);
    const targetPaired = bitCount(pairedMask & targetTypeMask);
    const centersPreserved = sameCenterState444(node.state, initialState);
    const postState = postAction ? applyCompactAction(node.state, postAction, true) : node.state;
    const postPairedMask = pairedEdgeTypeMask(postState);
    const preservedTarget = bitCount(pairedMask & postPairedMask & targetTypeMask);
    return {
      ...node,
      pairedMask,
      postPairedMask,
      targetPaired,
      preservedTarget,
      centersPreserved,
      score: (centersPreserved ? 500000 : 0)
        + preservedTarget * 250000
        + targetPaired * 100000
        + bitCount(pairedMask) * 1000
        - node.path.length,
    };
  };

  let beam = [evaluate({ state: initialState, path: [] })];'''
assert old in s, "missing target evaluation"
s = s.replace(old, new, 1)

old = '''      .filter((node) =>
        maskContains(node.pairedMask, requiredTypeMask) &&
        maskContains(node.postPairedMask, requiredTypeMask) &&
        node.targetPaired >= targetCount &&
        node.preservedTarget >= targetCount
      )'''
new = '''      .filter((node) =>
        node.centersPreserved &&
        maskContains(node.pairedMask, requiredTypeMask) &&
        maskContains(node.postPairedMask, requiredTypeMask) &&
        node.targetPaired >= targetCount &&
        node.preservedTarget >= targetCount
      )'''
assert old in s, "missing target goal filter"
s = s.replace(old, new, 1)

p.write_text(s)
print("Yau targeted edge pairing now selects only center-state-preserving macro endpoints")
