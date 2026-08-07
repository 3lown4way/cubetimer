from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

start_marker = "      const eighthTarget = 8;\n"
start = s.find(start_marker)
assert start >= 0, "missing 3-2-3 Next2 block"
end_marker = "      };\n\n      let finalSetup = null;"
end = s.find(end_marker, start)
assert end > start, "missing 3-2-3 Next2 block end"
end += len("      };\n")

replacement = '''      const eighthTarget = 8;
      const secondTarget = 9;
      let nextTwo;
      let secondLockedMask;
      if (yauBank) {
        const nextTwoFirst = searchTargetEdgeTypes444(
          firstThree.state,
          0x0fff,
          requiredTypeMask,
          eighthTarget,
          model,
          deadlineTs,
          2,
          null,
          7,
        );
        if (!nextTwoFirst) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const eighthLockedMask = chooseProtectedTypeMask(
          nextTwoFirst.pairedMask,
          requiredTypeMask,
          eighthTarget,
        );
        if (bitCount(eighthLockedMask) !== eighthTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const nextTwoSecond = searchTargetEdgeTypes444(
          nextTwoFirst.state,
          0x0fff,
          requiredTypeMask,
          secondTarget,
          model,
          deadlineTs,
          2,
          null,
          8,
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.pairedMask,
          requiredTypeMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const firstMoves = nextTwoFirst.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        const secondMoves = nextTwoSecond.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        nextTwo = {
          state: nextTwoSecond.state,
          mask: nextTwoSecond.pairedMask,
          moves: [...firstMoves, ...secondMoves],
          firstInsertionMoves: firstMoves,
          secondInsertionMoves: secondMoves,
          sliceFamily,
          frameRotation: sliceFamily.rotation,
          workingSlice: sliceFamily.openMoves[0][0],
          firstFrameRotation: sliceFamily.rotation,
          firstWorkingSlice: sliceFamily.openMoves[0][0],
        };
      } else {
        const nextTwoFirst = searchSliceCycleAcrossFrames(
          firstThree.state,
          firstLockedMask,
          eighthTarget,
          sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
        );
        if (!nextTwoFirst) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const eighthLockedMask = chooseProtectedTypeMask(
          nextTwoFirst.mask,
          firstLockedMask,
          eighthTarget,
        );
        if (bitCount(eighthLockedMask) !== eighthTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const nextTwoSecond = searchSliceCycleAcrossFrames(
          nextTwoFirst.state,
          eighthLockedMask,
          secondTarget,
          nextTwoFirst.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.mask,
          eighthLockedMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        nextTwo = {
          ...nextTwoSecond,
          moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
          firstInsertionMoves: nextTwoFirst.moves,
          secondInsertionMoves: nextTwoSecond.moves,
          firstFrameRotation: nextTwoFirst.frameRotation,
          firstWorkingSlice: nextTwoFirst.workingSlice,
        };
      }
'''

s = s[:start] + replacement + s[end:]
p.write_text(s)
print("Yau Next2 now uses flexible cross-locked multi-cycle pairing while standard 3-2-3 stays unchanged")
