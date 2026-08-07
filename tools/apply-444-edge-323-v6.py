from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Human 3-2-3 does not need to create both "Next 2" dedges in one opened
# slice cycle. Build them one at a time, protecting the newly completed dedge
# by identity before inserting the next one. This removes the artificial
# simultaneous +2 constraint while keeping the visible method 3-2-3.
old = r'''      const secondTarget = 9;
      const nextTwo = searchSliceCycleAcrossFrames(
        firstThree.state,
        firstLockedMask,
        secondTarget,
        sliceFamily,
        model,
        deadlineTs,
        7,
      );
      if (!nextTwo) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const secondLockedMask = chooseProtectedTypeMask(nextTwo.mask, firstLockedMask, secondTarget);
      if (bitCount(secondLockedMask) !== secondTarget) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
'''
new = r'''      const eighthTarget = 8;
      const nextTwoFirst = searchSliceCycleAcrossFrames(
        firstThree.state,
        firstLockedMask,
        eighthTarget,
        sliceFamily,
        model,
        deadlineTs,
        7,
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

      const secondTarget = 9;
      const nextTwoSecond = searchSliceCycleAcrossFrames(
        nextTwoFirst.state,
        eighthLockedMask,
        secondTarget,
        nextTwoFirst.sliceFamily || sliceFamily,
        model,
        deadlineTs,
        7,
      );
      if (!nextTwoSecond) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const secondLockedMask = chooseProtectedTypeMask(
        nextTwoSecond.mask,
        eighthLockedMask,
        secondTarget,
      );
      if (bitCount(secondLockedMask) !== secondTarget) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }
      const nextTwo = {
        ...nextTwoSecond,
        moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
        firstInsertionMoves: nextTwoFirst.moves,
        secondInsertionMoves: nextTwoSecond.moves,
        firstFrameRotation: nextTwoFirst.frameRotation,
        firstWorkingSlice: nextTwoFirst.workingSlice,
      };
'''
if old not in s:
    raise SystemExit('simultaneous Next2 block missing')
s = s.replace(old, new, 1)

# Preserve useful diagnostics so the UI/debug output can tell that Next2 was
# genuinely performed as two human-style insertions.
old_meta = r'''          nextFrameRotation: nextTwo.frameRotation || sliceFamily.rotation || "identity",
          nextWorkingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
'''
new_meta = r'''          nextFrameRotation: nextTwo.frameRotation || sliceFamily.rotation || "identity",
          nextWorkingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          nextTwoInsertionCount: 2,
          nextTwoFirstFrameRotation: nextTwo.firstFrameRotation || sliceFamily.rotation || "identity",
          nextTwoFirstWorkingSlice: nextTwo.firstWorkingSlice || sliceFamily.openMoves[0][0],
'''
if old_meta not in s:
    raise SystemExit('Next2 meta block missing')
s = s.replace(old_meta, new_meta, 1)

p.write_text(s)
