from pathlib import Path

# ---------------------------------------------------------------------------
# 1) Yau orchestration: the completed cross is not merely four paired dedges.
#    Require those four dedges to remain solved in their D-layer cross slots
#    throughout the 3-2-3 stage. The fallback may choose a different working
#    bank, but it is never allowed to relax the solved-cross invariant.
# ---------------------------------------------------------------------------
p = Path("solver/solver444.js")
s = p.read_text()

old = '''  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );'''
new = '''  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
  );'''
if old not in s:
    raise SystemExit("missing primary Yau 3-2-3 call")
s = s.replace(old, new, 1)

old = '''      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        { deadlineTs },
      );'''
new = '''      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        {
          deadlineTs,
          requiredSolvedTypeMask: targetTypeMask,
        },
      );'''
if old not in s:
    raise SystemExit("missing Yau 3-2-3 rescue call")
s = s.replace(old, new, 1)

old = '''      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
new = '''      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauEdge323CrossDownRequired: true,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
if old not in s:
    raise SystemExit("missing Yau 3-2-3 metadata anchor")
s = s.replace(old, new, 1)
p.write_text(s)

# ---------------------------------------------------------------------------
# 2) Human Yau 3-2-3 planner: after the first 3 paired edges, continue with
#    actual slice cycles across the available frames instead of the generic
#    center-preserving seed-macro search. Every committed cycle must preserve
#    requiredSolvedTypeMask, i.e. the four completed cross dedges stay in their
#    solved D-layer slots at each 3-2-3 checkpoint.
# ---------------------------------------------------------------------------
p = Path("solver/edgePairing444.js")
s = p.read_text()

start_anchor = '''      let nextTwo;
      let secondLockedMask;
      if (yauBank) {'''
start = s.find(start_anchor)
if start < 0:
    raise SystemExit("missing Yau next-two start")
else_anchor = '''      } else {
        const nextTwoFirst = searchSliceCycleAcrossFrames('''
end = s.find(else_anchor, start)
if end < 0:
    raise SystemExit("missing Yau next-two else")

replacement = '''      let nextTwo;
      let secondLockedMask;
      if (yauBank) {
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
'''
s = s[:start] + replacement + s[end:]

old = '''        if (yauBank) {
          const multiCycle = searchTargetEdgeTypes444(
            nextTwo.state,
            0x0fff,
            requiredTypeMask,
            10,
            model,
            deadlineTs,
            3,
            null,
            9,
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
        }'''
new = '''        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
          7,
          requiredSolvedTypeMask,
        );'''
if old not in s:
    raise SystemExit("missing Yau last-three setup block")
s = s.replace(old, new, 1)

old = '''        const finalLockedMask = chooseProtectedTypeMask(
          finalSetup.mask,
          yauBank ? requiredTypeMask : secondLockedMask,
          10,
        );'''
new = '''        const finalLockedMask = chooseProtectedTypeMask(
          finalSetup.mask,
          secondLockedMask,
          10,
        );'''
if old not in s:
    raise SystemExit("missing final locked-mask block")
s = s.replace(old, new, 1)

p.write_text(s)
