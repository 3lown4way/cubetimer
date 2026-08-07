from pathlib import Path
import re

p = Path('solver/edgePairing444.js')
s = p.read_text()

# This script runs after apply-444-edge-323-v2.py. Keep First3 search in the
# seed's selected working frame, but retain multiple valid First3 end states.
# From there, let Next2 / Last3 choose a fresh working slice across all six
# frames. This mirrors a human regrip between 3-2-3 groups without multiplying
# the expensive seed search by six.
s = s.replace(
    'const SLICE_MAX_OUTER_MOVES = 5;\n',
    'const SLICE_MAX_OUTER_MOVES = 5;\nconst SLICE_GOAL_LIMIT = 6;\nconst STAGE_BRANCH_LIMIT = 8;\n',
    1,
)

search_re = re.compile(
    r'function searchSliceCycle\(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs\) \{.*?\n\}\n\nfunction enumerateSetupPaths',
    re.S,
)
search_new = r'''function collectSliceCycleCandidates(
  initialState,
  lockedMask,
  targetCount,
  sliceFamily,
  model,
  deadlineTs,
  goalLimit = SLICE_GOAL_LIMIT,
) {
  const solvedCenters = model.solvedCompact;
  const goals = new Map();

  for (const openMove of sliceFamily.openMoves) {
    const closeMove = invertMoveToken(openMove);
    const openAction = model.actionFor(openMove);
    const closeAction = model.actionFor(closeMove);
    let beam = [{
      state: applyCompactAction(initialState, openAction, true),
      path: [],
      lastFace: "",
      score: 0,
    }];

    for (let depth = 0; depth <= SLICE_MAX_OUTER_MOVES; depth += 1) {
      if (deadlineReached(deadlineTs)) return [];
      const seen = new Map();
      for (const node of beam) {
        const closedState = applyCompactAction(node.state, closeAction, true);
        const closedMask = pairedSlotMask(closedState);
        if (
          maskContains(closedMask, lockedMask) &&
          bitCount(closedMask) >= targetCount &&
          centersSolved(closedState, solvedCenters.centerPieces)
        ) {
          const key = compactStateKey(closedState, true);
          const candidate = {
            state: closedState,
            mask: closedMask,
            moves: [openMove, ...node.path, closeMove],
            frameRotation: sliceFamily.rotation || "identity",
            workingSlice: openMove[0],
            score: bitCount(closedMask) * 1000 - node.path.length,
          };
          const previousGoal = goals.get(key);
          if (
            !previousGoal ||
            candidate.score > previousGoal.score ||
            candidate.moves.length < previousGoal.moves.length
          ) {
            goals.set(key, candidate);
          }
          if (goals.size >= goalLimit) {
            return [...goals.values()]
              .sort((left, right) => right.score - left.score || left.moves.length - right.moves.length)
              .slice(0, goalLimit);
          }
        }
        if (depth === SLICE_MAX_OUTER_MOVES) continue;

        for (const move of OUTER_MOVES_444) {
          if (node.lastFace && move[0] === node.lastFace) continue;
          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
          const candidateMask = pairedSlotMask(closedCandidate);
          const score = bitCount(candidateMask) * 180
            + bitCount(candidateMask & lockedMask) * 220
            - depth;
          const key = compactStateKey(nextState, true);
          const previous = seen.get(key);
          if (!previous || previous.score < score) {
            seen.set(key, {
              state: nextState,
              path: [...node.path, move],
              lastFace: move[0],
              score,
            });
          }
        }
      }
      beam = [...seen.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, SLICE_BEAM_WIDTH);
    }
  }

  return [...goals.values()]
    .sort((left, right) => right.score - left.score || left.moves.length - right.moves.length)
    .slice(0, goalLimit);
}

function collectStageCandidatesAcrossFrames(
  initialState,
  lockedMask,
  targetCount,
  model,
  deadlineTs,
  goalLimit = STAGE_BRANCH_LIMIT,
) {
  const goals = new Map();
  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
    const candidates = collectSliceCycleCandidates(
      initialState,
      lockedMask,
      targetCount,
      sliceFamily,
      model,
      deadlineTs,
      Math.min(SLICE_GOAL_LIMIT, goalLimit),
    );
    for (const candidate of candidates) {
      const key = compactStateKey(candidate.state, true);
      const previous = goals.get(key);
      if (
        !previous ||
        candidate.score > previous.score ||
        candidate.moves.length < previous.moves.length
      ) {
        goals.set(key, { ...candidate, frameIndex });
      }
    }
    if (goals.size >= goalLimit) break;
  }
  return [...goals.values()]
    .sort((left, right) => right.score - left.score || left.moves.length - right.moves.length)
    .slice(0, goalLimit);
}

function enumerateSetupPaths'''
s, count = search_re.subn(search_new, s, count=1)
if count != 1:
    raise SystemExit(f'slice search replacement count {count}')

solve_re = re.compile(
    r'  const diagnostics = \{\n    frameCount: model\.sliceFamilies\.length,.*?\n  const timedOut = deadlineReached\(deadlineTs\);',
    re.S,
)
solve_new = r'''  const diagnostics = {
    frameCount: model.sliceFamilies.length,
    seedCandidates: 0,
    firstThreeFailures: 0,
    firstThreeCandidates: 0,
    nextTwoFailures: 0,
    nextTwoCandidates: 0,
    lastThreeFailures: 0,
    l2eFailures: 0,
    verificationFailures: 0,
  };

  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const seedFamily = model.sliceFamilies[frameIndex];
    const seedCandidates = collectSeedCandidates(initialState, seedFamily.bankMask, model, deadlineTs);
    diagnostics.seedCandidates += seedCandidates.length;
    for (let seedIndex = 0; seedIndex < seedCandidates.length; seedIndex += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seed = seedCandidates[seedIndex];
      const seedMask = pairedSlotMask(seed.state);
      const firstTarget = Math.max(7, bitCount(seedMask));
      const firstCandidates = collectSliceCycleCandidates(
        seed.state,
        seedMask,
        firstTarget,
        seedFamily,
        model,
        deadlineTs,
        SLICE_GOAL_LIMIT,
      );
      if (!firstCandidates.length) {
        diagnostics.firstThreeFailures += 1;
        continue;
      }
      diagnostics.firstThreeCandidates += firstCandidates.length;

      for (let firstIndex = 0; firstIndex < firstCandidates.length; firstIndex += 1) {
        if (deadlineReached(deadlineTs)) break;
        const firstThree = firstCandidates[firstIndex];
        const secondTarget = Math.max(9, bitCount(firstThree.mask));
        const nextCandidates = collectStageCandidatesAcrossFrames(
          firstThree.state,
          firstThree.mask,
          secondTarget,
          model,
          deadlineTs,
          STAGE_BRANCH_LIMIT,
        );
        if (!nextCandidates.length) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        diagnostics.nextTwoCandidates += nextCandidates.length;

        for (let nextIndex = 0; nextIndex < nextCandidates.length; nextIndex += 1) {
          if (deadlineReached(deadlineTs)) break;
          const nextTwo = nextCandidates[nextIndex];
          let finalCandidates;
          if (bitCount(nextTwo.mask) < 10) {
            finalCandidates = collectStageCandidatesAcrossFrames(
              nextTwo.state,
              nextTwo.mask,
              10,
              model,
              deadlineTs,
              Math.min(4, STAGE_BRANCH_LIMIT),
            );
            if (!finalCandidates.length) {
              diagnostics.lastThreeFailures += 1;
              continue;
            }
          } else {
            finalCandidates = [{
              state: nextTwo.state,
              mask: nextTwo.mask,
              moves: [],
              frameRotation: nextTwo.frameRotation,
              workingSlice: nextTwo.workingSlice,
            }];
          }

          for (const finalSetup of finalCandidates) {
            if (deadlineReached(deadlineTs)) break;
            const l2e = findL2E(finalSetup.state, model, deadlineTs);
            if (!l2e) {
              diagnostics.l2eFailures += 1;
              continue;
            }

            const seedMoves = seed.path.flatMap((actionIndex) =>
              splitAlgorithm(model.seedActions[actionIndex].algorithm));
            const seedCount = bitCount(seedMask);
            const firstCount = bitCount(firstThree.mask);
            const secondCount = bitCount(nextTwo.mask);
            const finalSetupCount = bitCount(finalSetup.mask);
            const segments = [
              buildSegment("edge323Bank", `Edge Bank ${seedCount}/12`, seedMoves, 1, seedCount),
              buildSegment("edge323First3", "3-2-3 · First 3", firstThree.moves, seedCount + 1, firstCount),
              buildSegment("edge323Next2", "3-2-3 · Next 2", nextTwo.moves, firstCount + 1, secondCount),
            ];
            if (finalSetup.moves.length) {
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

            const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");
            const verifiedPattern = solution ? pattern.applyAlg(solution) : pattern;
            const verifiedState = compactStateFromPattern(verifiedPattern);
            if (
              bitCount(pairedSlotMask(verifiedState)) !== 12 ||
              !centersSolved(verifiedState, model.solvedCompact.centerPieces)
            ) {
              diagnostics.verificationFailures += 1;
              continue;
            }

            return {
              ok: true,
              reason: null,
              solution,
              moveCount: splitAlgorithm(solution).length,
              segments,
              method: "3-2-3",
              meta: {
                seedFrameIndex: frameIndex,
                seedFrameRotation: seedFamily.rotation || "identity",
                firstFrameRotation: firstThree.frameRotation,
                firstWorkingSlice: firstThree.workingSlice,
                nextFrameRotation: nextTwo.frameRotation,
                nextWorkingSlice: nextTwo.workingSlice,
                finalFrameRotation: finalSetup.frameRotation,
                finalWorkingSlice: finalSetup.workingSlice,
                seedCandidateIndex: seedIndex,
                firstCandidateIndex: firstIndex,
                nextCandidateIndex: nextIndex,
                seedPairCount: seedCount,
                afterFirstThree: firstCount,
                afterNextTwo: secondCount,
                beforeL2E: finalSetupCount,
                diagnostics,
              },
            };
          }
        }
      }
    }
  }

  const timedOut = deadlineReached(deadlineTs);'''
s, count = solve_re.subn(solve_new, s, count=1)
if count != 1:
    raise SystemExit(f'outer 3-2-3 planner replacement count {count}')

p.write_text(s)
