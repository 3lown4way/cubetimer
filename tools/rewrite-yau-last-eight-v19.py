from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v17.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

anchor = '''function collectYauNextTwoCandidates444(
'''
helper = r'''function buildYauPreInsertionCandidates444(
  initialState,
  sliceFamily,
  model,
  crossMask,
  targetRemainingCount,
) {
  const uAdjustments = ["U", "U'", "U2"];
  const triggers = YAU_FIRST3_F2L_MACROS_444.filter((algorithm) => !/^U(?:2|')?$/.test(algorithm));
  const algorithms = [""];
  algorithms.push(...YAU_FIRST3_F2L_MACROS_444);
  for (const u of uAdjustments) {
    for (const trigger of triggers) {
      algorithms.push(`${u} ${trigger}`);
      algorithms.push(`${trigger} ${u}`);
    }
  }

  const seenAlgorithms = new Set();
  const seenStates = new Map();
  const targetTypeMask = 0x0fff ^ crossMask;
  for (const raw of algorithms) {
    const algorithm = String(raw || "").trim();
    if (seenAlgorithms.has(algorithm)) continue;
    seenAlgorithms.add(algorithm);
    const moves = splitAlgorithm(algorithm);
    const state = moves.length ? applyMovePath(initialState, moves, model) : initialState;
    if (!maskContains(pairedEdgeTypeMask(state), crossMask)) continue;
    if (!maskContains(solvedEdgeTypeMask(state), crossMask)) continue;
    if (!centersSolved(state, model.solvedCompact.centerPieces)) continue;

    let bestDistance = Number.POSITIVE_INFINITY;
    let bestProjected = 0;
    for (const openMove of sliceFamily.openMoves) {
      const opened = applyCompactAction(state, model.actionFor(openMove), true);
      if (!maskContains(pairedEdgeTypeMask(opened), crossMask)) continue;
      const closeMove = invertMoveToken(openMove);
      bestDistance = Math.min(
        bestDistance,
        edgePairDistanceHeuristic444(
          opened,
          crossMask,
          targetRemainingCount,
          closeMove,
          model,
          targetTypeMask,
        ),
      );
      const closedAgain = applyCompactAction(opened, model.actionFor(closeMove), true);
      bestProjected = Math.max(
        bestProjected,
        bitCount(pairedEdgeTypeMask(closedAgain) & targetTypeMask),
      );
    }
    if (!Number.isFinite(bestDistance)) continue;
    const score = bestProjected * 5000 - bestDistance * 200 - moves.length;
    const key = compactStateKey(state, true);
    const previous = seenStates.get(key);
    if (!previous || previous.score < score) {
      seenStates.set(key, { state, moves, score });
    }
  }
  return [...seenStates.values()]
    .sort((a, b) => b.score - a.score || a.moves.length - b.moves.length)
    .slice(0, 18);
}

function searchYauTwoInsertionCycle444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  goalLimit = 5,
) {
  const goals = [];
  const preCandidates = buildYauPreInsertionCandidates444(
    initialState,
    sliceFamily,
    model,
    crossMask,
    targetRemainingCount,
  );

  for (let index = 0; index < preCandidates.length; index += 1) {
    if (deadlineReached(deadlineTs)) break;
    const pre = preCandidates[index];
    const localDeadline = deadlineTs > 0
      ? Math.min(deadlineTs, Date.now() + 420)
      : Date.now() + 420;
    const cycle = searchSliceCycle(
      pre.state,
      crossMask,
      targetRemainingCount,
      sliceFamily,
      model,
      localDeadline,
      7,
      crossMask,
      {
        targetTypeMask: 0x0fff ^ crossMask,
        exactTargetCount: false,
        requireAllCenters: true,
        requiredPairedEveryMoveMask: crossMask,
      },
    );
    if (!cycle) continue;
    const finalState = cycle.state;
    if (!yauBoundaryOkay444(finalState, model, crossMask, targetRemainingCount)) continue;
    goals.push({
      state: finalState,
      mask: pairedEdgeTypeMask(finalState),
      moves: [...pre.moves, ...cycle.moves],
    });
    if (goals.length >= goalLimit) break;
  }
  return goals;
}

'''
if anchor not in s:
    raise SystemExit('collectNextTwo anchor missing')
s = s.replace(anchor, helper + anchor, 1)

pattern = re.compile(r'''function collectYauNextTwoCandidates444\([\s\S]*?\n\}\n\n(?=function finishYauLastThree444)''')
replacement = r'''function collectYauNextTwoCandidates444(
  firstState,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  limit = 5,
) {
  const currentCount = bitCount(yauRemainingPairedMask444(firstState, crossMask));
  if (currentCount >= 5) {
    return [{ state: firstState, mask: pairedEdgeTypeMask(firstState), moves: [] }];
  }
  // Standard 3-2-3 "2": insert the first counterpart with outer/F2L moves,
  // slice, insert the second counterpart, then slice back. The three First-3
  // dedges are working buffers here; only the completed D cross is protected.
  return searchYauTwoInsertionCycle444(
    firstState,
    5,
    sliceFamily,
    model,
    deadlineTs,
    crossMask,
    limit,
  );
}

'''
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'collectNextTwo replacement count {n}')

pattern = re.compile(r'''function finishYauLastThree444\([\s\S]*?\n\}\n\n(?=function searchYauLastThreeAligned444)''')
replacement = r'''function finishYauLastThree444(initialState, sliceFamily, model, deadlineTs, crossMask) {
  const initialCount = bitCount(yauRemainingPairedMask444(initialState, crossMask));
  if (initialCount >= 8) return { state: initialState, moves: [] };

  // If exactly the final two remain, use the standard L2E case first.
  if (initialCount >= 6) {
    const l2e = findL2E(initialState, model, deadlineTs, crossMask, null, crossMask);
    if (l2e && yauBoundaryOkay444(l2e.state, model, crossMask, 8)) {
      return { state: l2e.state, moves: l2e.moves };
    }
  }

  // Standard Last-3 repeats the same two-insertion cycle. Pairing two of the
  // final three forces the last dedge as the slice is restored.
  const direct = searchYauTwoInsertionCycle444(
    initialState,
    8,
    sliceFamily,
    model,
    deadlineTs,
    crossMask,
    4,
  );
  if (direct.length) return { state: direct[0].state, moves: direct[0].moves };

  // Special case: make at least the 10th dedge with the same human cycle and
  // leave only a genuine L2E case. Never fall back to generic seed macros.
  const toSix = searchYauTwoInsertionCycle444(
    initialState,
    6,
    sliceFamily,
    model,
    deadlineTs,
    crossMask,
    4,
  );
  for (const candidate of toSix) {
    if (deadlineReached(deadlineTs)) break;
    if (bitCount(yauRemainingPairedMask444(candidate.state, crossMask)) >= 8) {
      return { state: candidate.state, moves: candidate.moves };
    }
    const l2e = findL2E(candidate.state, model, deadlineTs, crossMask, null, crossMask);
    if (!l2e || !yauBoundaryOkay444(l2e.state, model, crossMask, 8)) continue;
    return { state: l2e.state, moves: [...candidate.moves, ...l2e.moves] };
  }
  return null;
}

'''
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'finishLastThree replacement count {n}')

p.write_text(s)
print('implemented genuine pre-insert -> slice -> insert -> slice-back cycles for Next2 and Last3')
