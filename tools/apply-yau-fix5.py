from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

old = '''  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
    const seedCandidates = yauBank
      ? [{ state: initialState, path: [], score: Number.MAX_SAFE_INTEGER }]
      : collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);'''
new = '''  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
    if (yauBank && sliceFamily.bankMask !== requiredTypeMask) continue;
    const seedCandidates = yauBank
      ? [{ state: initialState, path: [], score: Number.MAX_SAFE_INTEGER }]
      : collectSeedCandidates(initialState, sliceFamily.bankMask, model, deadlineTs);'''
assert old in s, "missing Yau frame loop"
s = s.replace(old, new, 1)

old = '''      const firstThree = searchSliceCycle(
        seed.state,
        bankTypeMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
        SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
      );'''
new = '''      const firstThree = searchSliceCycle(
        seed.state,
        bankTypeMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
        yauBank ? 7 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
      );'''
assert old in s, "missing firstThree call"
s = s.replace(old, new, 1)

old = '''        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
        );'''
new = '''        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          yauBank ? 10 : 7,
          requiredSolvedTypeMask,
        );'''
assert old in s, "missing finalSetup call"
s = s.replace(old, new, 1)

p.write_text(s)
print("Yau 3-2-3 matching frame and deeper final setup applied")
