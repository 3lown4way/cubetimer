from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

old = '''      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          yauBank ? 10 : 7,
          requiredSolvedTypeMask,
        );
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        const finalLockedMask = chooseProtectedTypeMask(finalSetup.mask, secondLockedMask, 10);'''
new = '''      if (bitCount(nextTwo.mask) < 10) {
        if (yauBank) {
          const multiCycle = searchTargetEdgeTypes444(
            nextTwo.state,
            0x0fff,
            secondLockedMask,
            10,
            model,
            deadlineTs,
            2,
          );
          finalSetup = multiCycle
            ? {
                state: multiCycle.state,
                mask: multiCycle.pairedMask,
                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(model.seedActions[actionIndex].algorithm)
                ),
                sliceFamily: nextTwo.sliceFamily || sliceFamily,
                frameRotation: nextTwo.frameRotation || sliceFamily.rotation,
                workingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
              }
            : null;
        } else {
          finalSetup = searchSliceCycleAcrossFrames(
            nextTwo.state,
            secondLockedMask,
            10,
            nextTwo.sliceFamily || sliceFamily,
            model,
            deadlineTs,
            7,
            requiredSolvedTypeMask,
          );
        }
        if (!finalSetup) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        const finalLockedMask = chooseProtectedTypeMask(finalSetup.mask, secondLockedMask, 10);'''
assert old in s, "missing Yau finalSetup block"
s = s.replace(old, new, 1)

p.write_text(s)
print("Yau final 9->10 setup now supports two center-preserving macros")
