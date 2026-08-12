from pathlib import Path
import re
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v9.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Next 2: use the fast macro planner again, but every macro token is already
# filtered by requiredPairedEveryMoveMask from v2. Do not require exact D slots.
pattern = re.compile(r'''      if \(yauBank\) \{\n        const nextTwoFirst = searchSliceCycle\(.*?\n      \} else \{\n        const nextTwoFirst = searchSliceCycleAcrossFrames\(''', re.S)
replacement = '''      if (yauBank) {
        const nextTwoFirst = searchTargetEdgeTypes444(
          firstThree.state,
          0x0fff,
          firstLockedMask,
          eighthTarget,
          model,
          deadlineTs,
          4,
          null,
          7,
          YAU_TARGET_RESCUE_BEAM_WIDTH,
          true,
          false,
          0,
          requiredTypeMask,
        );
        if (!nextTwoFirst) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const eighthLockedMask = chooseProtectedTypeMask(
          nextTwoFirst.pairedMask,
          firstLockedMask,
          eighthTarget,
        );
        if (bitCount(eighthLockedMask) !== eighthTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const nextTwoSecond = searchTargetEdgeTypes444(
          nextTwoFirst.state,
          0x0fff,
          eighthLockedMask,
          secondTarget,
          model,
          deadlineTs,
          4,
          null,
          8,
          YAU_TARGET_RESCUE_BEAM_WIDTH,
          true,
          false,
          0,
          requiredTypeMask,
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.pairedMask,
          eighthLockedMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const firstInsertionMoves = nextTwoFirst.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        const secondInsertionMoves = nextTwoSecond.path.flatMap((actionIndex) =>
          splitAlgorithm(model.seedActions[actionIndex].algorithm)
        );
        nextTwo = {
          state: nextTwoSecond.state,
          mask: nextTwoSecond.pairedMask,
          moves: [...firstInsertionMoves, ...secondInsertionMoves],
          firstInsertionMoves,
          secondInsertionMoves,
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
    raise SystemExit(f'fast Yau Next 2 replacement count={n}')
s = s2

# Last 3: return to fast 9->10 macro + L2E, both token-filtered to preserve
# the four cross dedges. Exact cross placement is aligned later with outer turns.
pattern = re.compile(r'''      let finalSetup = null;\n      let beforeL2E = nextTwo;\n      let beforeL2ELockedCount = secondTarget;\n      let l2e = null;\n      if \(yauBank\) \{.*?\n      \} else \{\n        if \(bitCount\(nextTwo\.mask\) < 10\) \{''', re.S)
replacement = '''      let finalSetup = null;
      let beforeL2E = nextTwo;
      let beforeL2ELockedCount = secondTarget;
      let l2e = null;
      if (yauBank) {
        if (bitCount(nextTwo.mask) < 10) {
          const multiCycle = searchTargetEdgeTypes444(
            nextTwo.state,
            0x0fff,
            requiredTypeMask,
            10,
            model,
            deadlineTs,
            5,
            null,
            9,
            YAU_TARGET_RESCUE_BEAM_WIDTH,
            true,
            false,
            0,
            requiredTypeMask,
          );
          finalSetup = multiCycle
            ? {
                state: multiCycle.state,
                mask: multiCycle.pairedMask,
                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(model.seedActions[actionIndex].algorithm)
                ),
                sliceFamily,
                frameRotation: sliceFamily.rotation,
                workingSlice: sliceFamily.openMoves[0][0],
              }
            : null;
          if (!finalSetup) {
            diagnostics.lastThreeFailures += 1;
            continue;
          }
          beforeL2ELockedCount = 10;
          beforeL2E = finalSetup;
        }
        const beforeL2ETypeCount = bitCount(pairedEdgeTypeMask(beforeL2E.state));
        l2e = beforeL2ETypeCount === 12
          ? { state: beforeL2E.state, moves: [] }
          : findL2E(beforeL2E.state, model, deadlineTs, 0, requiredTypeMask);
        if (!l2e) {
          diagnostics.l2eFailures += 1;
          continue;
        }
      } else {
        if (bitCount(nextTwo.mask) < 10) {'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'fast Yau Last 3 replacement count={n}')
s = s2

# Restore segment semantics for the 10-pair setup + L2E path.
old = '''      if (finalSetup) {
        segments.push(buildSegment(
          yauBank ? "edge323Last3" : "edge323Last3Setup",
          yauBank ? "3-2-3 · Last 3" : "3-2-3 · Last 3 setup",
          finalSetup.moves,
          10,
          yauBank ? 12 : 10,
        ));
      }
      if (!yauBank || l2e.moves.length) {
        segments.push(buildSegment(
          "edge323L2E",
          "3-2-3 · L2E",
          l2e.moves,
          beforeL2ELockedCount + 1,
          12,
        ));
      }
'''
new = '''      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          10,
          10,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        beforeL2ELockedCount + 1,
        12,
      ));
'''
if old not in s:
    raise SystemExit('segment semantics anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('installed fast macro-based Yau 3-2-3 with atomic cross-pair filtering')
