from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

start_marker = "      if (bitCount(nextTwo.mask) < 10) {\n"
start = s.find(start_marker)
assert start >= 0, "missing final 9->10 setup block"
end_marker = "        beforeL2E = finalSetup;\n      }"
end = s.find(end_marker, start)
assert end > start, "missing final 9->10 setup block end"
end += len(end_marker)

replacement = '''      if (bitCount(nextTwo.mask) < 10) {
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
        const finalLockedMask = chooseProtectedTypeMask(finalSetup.mask, secondLockedMask, 10);
        if (bitCount(finalLockedMask) !== 10) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        beforeL2ELockedCount = 10;
        beforeL2E = finalSetup;
      }'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("Yau final 9->10 setup now supports two center-preserving macros")
