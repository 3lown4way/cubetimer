from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# This script runs after apply-444-edge-323-v2.py. Keep the expensive seed and
# First3 search greedy and fast. Once First3 is complete, allow a natural
# regrip: try the six equivalent working slices for Next2 / Last3 and accept
# the first valid continuation. This matches how a human changes viewpoint
# between 3-2-3 groups without carrying a large search frontier.
marker = '''function enumerateSetupPaths(maxDepth = 3) {\n'''
helper = r'''function searchSliceCycleAcrossFrames(
  initialState,
  lockedMask,
  targetCount,
  preferredFamily,
  model,
  deadlineTs,
) {
  const orderedFamilies = [
    preferredFamily,
    ...model.sliceFamilies.filter((family) => family !== preferredFamily),
  ];
  for (const sliceFamily of orderedFamilies) {
    if (deadlineReached(deadlineTs)) return null;
    const result = searchSliceCycle(
      initialState,
      lockedMask,
      targetCount,
      sliceFamily,
      model,
      deadlineTs,
    );
    if (result) {
      return {
        ...result,
        sliceFamily,
        frameRotation: sliceFamily.rotation || "identity",
        workingSlice: sliceFamily.openMoves[0][0],
      };
    }
  }
  return null;
}

'''
if 'function searchSliceCycleAcrossFrames(' not in s:
    if marker not in s:
        raise SystemExit('enumerateSetupPaths marker missing')
    s = s.replace(marker, helper + marker, 1)

old = r'''      const secondTarget = Math.max(9, bitCount(firstThree.mask));
      const nextTwo = searchSliceCycle(firstThree.state, firstThree.mask, secondTarget, sliceFamily, model, deadlineTs);
      if (!nextTwo) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }

      let finalSetup = null;
      let beforeL2E = nextTwo;
      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycle(nextTwo.state, nextTwo.mask, 10, sliceFamily, model, deadlineTs);
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        beforeL2E = finalSetup;
      }
'''
new = r'''      const secondTarget = Math.max(9, bitCount(firstThree.mask));
      const nextTwo = searchSliceCycleAcrossFrames(
        firstThree.state,
        firstThree.mask,
        secondTarget,
        sliceFamily,
        model,
        deadlineTs,
      );
      if (!nextTwo) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }

      let finalSetup = null;
      let beforeL2E = nextTwo;
      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          nextTwo.mask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
        );
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        beforeL2E = finalSetup;
      }
'''
if old not in s:
    raise SystemExit('v2 Next2/Last3 planner block missing')
s = s.replace(old, new, 1)

old_meta = r'''          frameIndex,
          frameRotation: sliceFamily.rotation || "identity",
          workingSlice: sliceFamily.openMoves[0][0],
          seedCandidateIndex: seedIndex,
'''
new_meta = r'''          frameIndex,
          frameRotation: sliceFamily.rotation || "identity",
          workingSlice: sliceFamily.openMoves[0][0],
          nextFrameRotation: nextTwo.frameRotation || sliceFamily.rotation || "identity",
          nextWorkingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          finalFrameRotation: finalSetup?.frameRotation || nextTwo.frameRotation || sliceFamily.rotation || "identity",
          finalWorkingSlice: finalSetup?.workingSlice || nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          seedCandidateIndex: seedIndex,
'''
if old_meta not in s:
    raise SystemExit('v2 success meta block missing')
s = s.replace(old_meta, new_meta, 1)

p.write_text(s)
