from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# This script runs after apply-444-edge-323-v2.py. The human 3-2-3 method only
# protects the four-edge bank and the pairs intentionally added by each group.
# Incidental pairs are allowed to break later; locking every currently paired
# slot made Next2 artificially impossible on otherwise normal center states.
marker = '''function enumerateSetupPaths(maxDepth = 3) {\n'''
helper = r'''function chooseProtectedPairMask(pairedMask, requiredMask, targetCount) {
  let protectedMask = requiredMask & pairedMask;
  if (!maskContains(pairedMask, requiredMask)) return 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS_444.length && bitCount(protectedMask) < targetCount; slot += 1) {
    const bit = 1 << slot;
    if ((pairedMask & bit) && !(protectedMask & bit)) protectedMask |= bit;
  }
  return protectedMask;
}

function searchSliceCycleAcrossFrames(
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
if 'function chooseProtectedPairMask(' not in s:
    if marker not in s:
        raise SystemExit('enumerateSetupPaths marker missing')
    s = s.replace(marker, helper + marker, 1)

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
      const seedMask = pairedSlotMask(seed.state);
      const protectedBankMask = sliceFamily.bankMask;
      if (!maskContains(seedMask, protectedBankMask)) continue;

      const bankCount = bitCount(protectedBankMask);
      const firstTarget = Math.max(7, bankCount);
      const firstThree = searchSliceCycle(
        seed.state,
        protectedBankMask,
        firstTarget,
        sliceFamily,
        model,
        deadlineTs,
      );
      if (!firstThree) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }
      const firstLockedMask = chooseProtectedPairMask(
        firstThree.mask,
        protectedBankMask,
        firstTarget,
      );
      if (bitCount(firstLockedMask) < firstTarget) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }

      const secondTarget = Math.max(9, bitCount(firstLockedMask));
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
      const secondLockedMask = chooseProtectedPairMask(
        nextTwo.mask,
        firstLockedMask,
        secondTarget,
      );
      if (bitCount(secondLockedMask) < secondTarget) {
        diagnostics.nextTwoFailures += 1;
        continue;
      }

      let finalSetup = null;
      let beforeL2E = nextTwo;
      let finalLockedCount = secondTarget;
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
        const finalLockedMask = chooseProtectedPairMask(
          finalSetup.mask,
          secondLockedMask,
          10,
        );
        if (bitCount(finalLockedMask) < 10) {
          diagnostics.lastThreeFailures += 1;
          continue;
        }
        finalLockedCount = 10;
        beforeL2E = finalSetup;
      }

      const beforeL2ECount = bitCount(pairedSlotMask(beforeL2E.state));
      const l2e = beforeL2ECount === 12
        ? { state: beforeL2E.state, moves: [] }
        : findL2E(beforeL2E.state, model, deadlineTs);
      if (!l2e) {
        diagnostics.l2eFailures += 1;
        continue;
      }

      const seedMoves = seed.path.flatMap((actionIndex) => splitAlgorithm(model.seedActions[actionIndex].algorithm));
      const segments = [
        buildSegment("edge323Bank", `Edge Bank ${bankCount}/12`, seedMoves, 1, bankCount),
        buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, bankCount + 1, firstTarget),
        buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstTarget + 1, secondTarget),
      ];
      if (finalSetup) {
        segments.push(buildSegment(
          "edge323Last3Setup",
          "3-2-3 · Last 3 setup",
          finalSetup.moves,
          secondTarget + 1,
          finalLockedCount,
        ));
      }
      segments.push(buildSegment(
        "edge323L2E",
        "3-2-3 · L2E",
        l2e.moves,
        finalLockedCount + 1,
        12,
      ));
'''
if old not in s:
    raise SystemExit('v2 greedy 3-2-3 group block missing')
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
          seedPairCount: bankCount,
          incidentalSeedPairs: Math.max(0, bitCount(seedMask) - bankCount),
          afterFirstThree: firstTarget,
          incidentalAfterFirstThree: Math.max(0, bitCount(firstThree.mask) - firstTarget),
          afterNextTwo: secondTarget,
          incidentalAfterNextTwo: Math.max(0, bitCount(nextTwo.mask) - secondTarget),
          beforeL2E: finalLockedCount,
          diagnostics,
'''
if old_meta not in s:
    raise SystemExit('v2 success meta block missing')
s = s.replace(old_meta, new_meta, 1)

p.write_text(s)
