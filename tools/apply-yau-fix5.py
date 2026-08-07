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

anchor = "        finalSetup = searchSliceCycleAcrossFrames(\n"
start = s.find(anchor)
assert start >= 0, "missing finalSetup block"
end = s.find("        );", start)
assert end > start, "unterminated finalSetup block"
block = s[start:end + len("        );")]
needle = "          7,\n"
assert needle in block, f"missing finalSetup depth in block: {block}"
block = block.replace(needle, "          yauBank ? 10 : 7,\n", 1)
s = s[:start] + block + s[end + len("        );"):]

p.write_text(s)
print("Yau 3-2-3 matching frame and deeper final setup applied")
