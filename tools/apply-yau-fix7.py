from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

old = '''  maxMacros = YAU_TARGET_MAX_MACROS,
  postAction = null,
) {'''
new = '''  maxMacros = YAU_TARGET_MAX_MACROS,
  postAction = null,
  minPairCount = 0,
) {'''
assert old in s, "missing target-search signature"
s = s.replace(old, new, 1)

old = '''        const pairedMask = pairedEdgeTypeMask(nextState);
        if (!maskContains(pairedMask, requiredTypeMask)) continue;
        const candidate = evaluate({ state: nextState, path: [...node.path, actionIndex] });'''
new = '''        const pairedMask = pairedEdgeTypeMask(nextState);
        if (!maskContains(pairedMask, requiredTypeMask)) continue;
        if (bitCount(pairedMask) < minPairCount) continue;
        const candidate = evaluate({ state: nextState, path: [...node.path, actionIndex] });'''
assert old in s, "missing target-search expansion"
s = s.replace(old, new, 1)

old = '''            secondLockedMask,
            10,
            model,
            deadlineTs,
            2,
          );'''
new = '''            requiredTypeMask,
            10,
            model,
            deadlineTs,
            3,
            null,
            9,
          );'''
assert old in s, "missing Yau multi-cycle final search"
s = s.replace(old, new, 1)

old = '''        const finalLockedMask = chooseProtectedTypeMask(finalSetup.mask, secondLockedMask, 10);
        if (bitCount(finalLockedMask) !== 10) {'''
new = '''        const finalLockedMask = chooseProtectedTypeMask(
          finalSetup.mask,
          yauBank ? requiredTypeMask : secondLockedMask,
          10,
        );
        if (bitCount(finalLockedMask) !== 10) {'''
assert old in s, "missing final locked mask"
s = s.replace(old, new, 1)

p.write_text(s)
print("Yau last-three search preserves cross bank and pair count while allowing non-cross bank reshuffle")
