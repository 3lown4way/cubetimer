from pathlib import Path
import re
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v4.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
pattern = re.compile(r'''      if \(yauBank\) \{\n        const nextTwoFirst = searchTargetEdgeTypes444\(.*?\n      \} else \{\n        const nextTwoFirst = searchSliceCycleAcrossFrames\(''', re.S)
replacement = '''      if (yauBank) {
        const nextTwoFirst = searchSliceCycle(
          firstThree.state,
          firstLockedMask,
          eighthTarget,
          sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
          { requiredPairedEveryMoveMask: requiredTypeMask },
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

        const nextTwoSecond = searchSliceCycle(
          nextTwoFirst.state,
          eighthLockedMask,
          secondTarget,
          sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
          { requiredPairedEveryMoveMask: requiredTypeMask },
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
          state: nextTwoSecond.state,
          mask: nextTwoSecond.mask,
          moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
          firstInsertionMoves: nextTwoFirst.moves,
          secondInsertionMoves: nextTwoSecond.moves,
          sliceFamily,
          frameRotation: sliceFamily.rotation,
          workingSlice: sliceFamily.openMoves[0][0],
          firstFrameRotation: sliceFamily.rotation,
          firstWorkingSlice: sliceFamily.openMoves[0][0],
        };
      } else {
        const nextTwoFirst = searchSliceCycleAcrossFrames('''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Yau Next 2 replacement count={n}')
p.write_text(s2)
print('installed true Yau protected Next 2 slice cycles')
