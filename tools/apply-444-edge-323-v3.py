from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Runs after apply-444-edge-323-v2.py. The seed still creates a physical
# four-slot working bank, but from that point on a solved dedge is protected by
# edge identity, not by the physical slot it occupies. Outer turns are free to
# carry a paired dedge to another slot, exactly as in a human 3-2-3 solve.
marker = '''function centersSolved(state, solvedCenterPieces) {\n'''
helper = r'''function pairedEdgeTypeMask(state) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType !== 255 &&
      firstType === secondType &&
      state.edgeOrientation[first] === state.edgeOrientation[second]
    ) {
      mask |= 1 << firstType;
    }
  }
  return mask;
}

function pairedEdgeTypeMaskInSlots(state, slotMask) {
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length; slot += 1) {
    if (!(slotMask & (1 << slot))) continue;
    const [first, second] = EDGE_SLOT_PAIRS_444[slot];
    const firstType = EDGE_TYPE_BY_WING_444[state.edgePieces[first]];
    const secondType = EDGE_TYPE_BY_WING_444[state.edgePieces[second]];
    if (
      firstType !== 255 &&
      firstType === secondType &&
      state.edgeOrientation[first] === state.edgeOrientation[second]
    ) {
      mask |= 1 << firstType;
    }
  }
  return mask;
}

function chooseProtectedTypeMask(pairedMask, requiredMask, targetCount) {
  if (!maskContains(pairedMask, requiredMask)) return 0;
  let protectedMask = requiredMask;
  for (let edgeType = 0; edgeType < 12 && bitCount(protectedMask) < targetCount; edgeType += 1) {
    const bit = 1 << edgeType;
    if ((pairedMask & bit) && !(protectedMask & bit)) protectedMask |= bit;
  }
  return protectedMask;
}

function searchSliceCycleAcrossFrames(
  initialState,
  lockedTypeMask,
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
      lockedTypeMask,
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
if 'function pairedEdgeTypeMask(state)' not in s:
    if marker not in s:
        raise SystemExit('centersSolved marker missing')
    s = s.replace(marker, helper + marker, 1)

# searchSliceCycle's mask is now a mask of solved dedge identities. Physical
# slot masks remain in collectSeedCandidates only, where a concrete bank is
# intentionally being created.
s = s.replace('const closedMask = pairedSlotMask(closedState);', 'const closedMask = pairedEdgeTypeMask(closedState);', 1)
s = s.replace('const candidateMask = pairedSlotMask(closedCandidate);', 'const candidateMask = pairedEdgeTypeMask(closedCandidate);', 1)

old = r'''      const seed = seedCandidates[seedIndex];
      const seedMask = pairedSlotMask(seed.state);
      const firstTarget = Math.max(7, bitCount(seedMask));
      const firstThree = searchSliceCycle(seed.state, seedMask, firstTarget, sliceFamily, model, deadlineTs);
      if (!firstThree) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }

      const secondTarget = Math.max(9, bitCount(firstThree.mask));
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

      const l2e = findL2E(beforeL2E.state, model, deadlineTs);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const seedCount = bitCount(seedMask);
      const firstCount = bitCount(firstThree.mask);
      const secondCount = bitCount(nextTwo.mask);
      const finalSetupCount = finalSetup ? bitCount(finalSetup.mask) : secondCount;
      const segments = [
        buildSegment("edge323Bank", `Edge Bank ${seedCount}/12`, seedMoves, 1, seedCount),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, seedCount + 1, firstCount),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstCount + 1, secondCount),
      ];
      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          secondCount + 1,
          finalSetupCount,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        finalSetupCount + 1,
        12,
      ));
'''
new = r'''      const seed = seedCandidates[seedIndex];
      const seedSlotMask = pairedSlotMask(seed.state);
      const bankTypeMask = pairedEdgeTypeMaskInSlots(seed.state, sliceFamily.bankMask);
      if (bitCount(bankTypeMask) !== 4) continue;

      const firstTarget = 7;
      const firstThree = searchSliceCycle(
        seed.state,
        bankTypeMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
      );
      if (!firstThree) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }
      const firstLockedMask = chooseProtectedTypeMask(firstThree.mask, bankTypeMask, firstTarget);
      if (bitCount(firstLockedMask) !== firstTarget) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }

      const secondTarget = 9;
      const nextTwo = searchSliceCycleAcrossFrames(
        firstThree.state,
        firstLockedMask,
        secondTarget,
        sliceFamily,
        model,
        deadlineTs,
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

      let finalSetup = null;
      let beforeL2E = nextTwo;
      let beforeL2ELockedCount = secondTarget;
      if (bitCount(nextTwo.mask) < 10) {
        finalSetup = searchSliceCycleAcrossFrames(
          nextTwo.state,
          secondLockedMask,
          10,
          nextTwo.sliceFamily || sliceFamily,
          model,
          deadlineTs,
        );
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
      }

      const beforeL2ETypeCount = bitCount(pairedEdgeTypeMask(beforeL2E.state));
      const l2e = beforeL2ETypeCount === 12
        ? { state: beforeL2E.state, moves: [] }
        : findL2E(beforeL2E.state, model, deadlineTs);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const segments = [
        buildSegment("edge323Bank", "Edge Bank 4/12", seedMoves, 1, 4),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, 5, 7),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, 8, 9),
      ];
      if (finalSetup) {
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
    raise SystemExit('v2 greedy 3-2-3 block missing')
s = s.replace(old, new, 1)

old_meta = r'''          frameIndex,
          frameRotation: sliceFamily.rotation || "identity",
          workingSlice: sliceFamily.openMoves[0][0],
          seedCandidateIndex: seedIndex,
          seedPairCount: seedCount,
          afterFirstThree: firstCount,
          afterNextTwo: secondCount,
          beforeL2E: finalSetupCount,
          diagnostics,
'''
new_meta = r'''          frameIndex,
          frameRotation: sliceFamily.rotation || "identity",
          workingSlice: sliceFamily.openMoves[0][0],
          nextFrameRotation: nextTwo.frameRotation || sliceFamily.rotation || "identity",
          nextWorkingSlice: nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          finalFrameRotation: finalSetup?.frameRotation || nextTwo.frameRotation || sliceFamily.rotation || "identity",
          finalWorkingSlice: finalSetup?.workingSlice || nextTwo.workingSlice || sliceFamily.openMoves[0][0],
          seedCandidateIndex: seedIndex,
          seedPairCount: 4,
          incidentalSeedPairs: Math.max(0, bitCount(seedSlotMask) - 4),
          afterFirstThree: 7,
          incidentalAfterFirstThree: Math.max(0, bitCount(firstThree.mask) - 7),
          afterNextTwo: 9,
          incidentalAfterNextTwo: Math.max(0, bitCount(nextTwo.mask) - 9),
          beforeL2E: beforeL2ELockedCount,
          diagnostics,
'''
if old_meta not in s:
    raise SystemExit('v2 success meta block missing')
s = s.replace(old_meta, new_meta, 1)

p.write_text(s)
