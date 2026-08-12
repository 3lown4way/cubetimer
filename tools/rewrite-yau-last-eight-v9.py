from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v8.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

anchor = '''function searchYauLastThreeAligned444(
'''
helper = r'''function collectYauCycleGoals444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  lockedMask,
  maxOuterMoves = 7,
  goalLimit = 10,
) {
  const goals = new Map();
  const targetTypeMask = 0x0fff ^ crossMask;
  for (const openMove of sliceFamily.openMoves) {
    if (deadlineReached(deadlineTs)) break;
    const closeMove = invertMoveToken(openMove);
    const openAction = model.actionFor(openMove);
    const closeAction = model.actionFor(closeMove);
    const openedState = applyCompactAction(initialState, openAction, true);
    if (!maskContains(pairedEdgeTypeMask(openedState), crossMask)) continue;

    let beam = [{ state: openedState, path: [], lastFace: "", score: 0 }];
    for (let depth = 0; depth <= maxOuterMoves; depth += 1) {
      if (deadlineReached(deadlineTs)) break;
      const seen = new Map();
      for (const node of beam) {
        const closedState = applyCompactAction(node.state, closeAction, true);
        const closedMask = pairedEdgeTypeMask(closedState);
        const remaining = bitCount(closedMask & targetTypeMask);
        if (
          remaining === targetRemainingCount &&
          maskContains(closedMask, lockedMask) &&
          maskContains(solvedEdgeTypeMask(closedState), crossMask) &&
          centersSolved(closedState, model.solvedCompact.centerPieces)
        ) {
          const key = compactStateKey(closedState, true);
          const moves = [openMove, ...node.path, closeMove];
          const previous = goals.get(key);
          if (!previous || moves.length < previous.moves.length) {
            goals.set(key, { state: closedState, mask: closedMask, moves });
          }
        }
        if (depth === maxOuterMoves) continue;

        for (const move of OUTER_MOVES_444) {
          if (node.lastFace && move[0] === node.lastFace) continue;
          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          if (!maskContains(pairedEdgeTypeMask(nextState), crossMask)) continue;
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
          const candidateMask = pairedEdgeTypeMask(closedCandidate);
          const pairDistance = edgePairDistanceHeuristic444(
            nextState,
            lockedMask,
            targetRemainingCount,
            closeMove,
            model,
            targetTypeMask,
          );
          const score = bitCount(candidateMask & targetTypeMask) * 520
            + bitCount(candidateMask & lockedMask) * 360
            + bitCount(candidateMask) * 80
            - pairDistance * 95
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
      if (goals.size >= goalLimit) break;
      beam = [...seen.values()]
        .sort((left, right) => right.score - left.score)
        .slice(0, SLICE_BEAM_WIDTH);
    }
  }
  return [...goals.values()]
    .sort((left, right) => left.moves.length - right.moves.length)
    .slice(0, goalLimit);
}

function finishYauLastThree444(initialState, sliceFamily, model, deadlineTs, crossMask) {
  let state = initialState;
  const moves = [];
  let remaining = bitCount(yauRemainingPairedMask444(state, crossMask));
  if (remaining < 6) {
    const makeTen = searchYauLastThreeAligned444(
      state,
      6,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
    );
    if (!makeTen) return null;
    state = makeTen.state;
    moves.push(...makeTen.moves);
    remaining = bitCount(yauRemainingPairedMask444(state, crossMask));
  }
  if (remaining < 8) {
    const l2e = findL2E(state, model, deadlineTs, crossMask, null, crossMask);
    if (!l2e) return null;
    state = l2e.state;
    moves.push(...l2e.moves);
  }
  if (!yauBoundaryOkay444(state, model, crossMask, 8)) return null;
  return { state, moves };
}

'''
if anchor not in s:
    raise SystemExit('Last3 aligned helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

pattern = re.compile(r'''  // 2: prefer pairing the next two in one cycle\.[\s\S]*?  if \(!yauBoundaryOkay444\(state, model, crossMask, 8\)\) \{\n    return \{ ok: false, reason: "444_YAU_LAST8_LAST3_BOUNDARY_FAILED", solution: "", segments: \[\] \};\n  \}\n  segmentMoves\.push\(\{ id: "yau323Last3", name: "3-2-3 · Last 3", moves: last3Moves, pairStart: 10, pairEnd: 12 \}\);\n''')
replacement = r'''  // 2 + 3: keep a small human 3-2-3 frontier. A speedsolver does not commit
  // to the first legal Next-2 arrangement if it creates a bad Last-3 case;
  // look one stage ahead and choose a clean continuation instead.
  let next2Moves = [];
  let last3Moves = [];
  let remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  let next2Candidates = [];

  if (remainingCount >= 5) {
    next2Candidates = [{ state, mask: pairedEdgeTypeMask(state), moves: [] }];
  } else {
    const next2LockedMask = yauLockedMask444(state, crossMask);
    next2Candidates = collectYauCycleGoals444(
      state,
      5,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      next2LockedMask,
      7,
      10,
    );

    // Rarely, two short cycles are more natural than forcing +2 in one cycle.
    if (!next2Candidates.length && remainingCount < 4 && !deadlineReached(deadlineTs)) {
      const firstStep = collectYauCycleGoals444(
        state,
        4,
        sliceFamily,
        model,
        deadlineTs,
        crossMask,
        next2LockedMask,
        6,
        5,
      );
      for (const first of firstStep) {
        const secondStep = collectYauCycleGoals444(
          first.state,
          5,
          sliceFamily,
          model,
          deadlineTs,
          crossMask,
          yauLockedMask444(first.state, crossMask),
          6,
          4,
        );
        for (const second of secondStep) {
          next2Candidates.push({
            state: second.state,
            mask: second.mask,
            moves: [...first.moves, ...second.moves],
          });
          if (next2Candidates.length >= 10) break;
        }
        if (next2Candidates.length >= 10) break;
      }
    }
  }

  if (!next2Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_NEXT2_FAILED", solution: "", segments: [] };
  }

  let chosen = null;
  for (let candidateIndex = 0; candidateIndex < next2Candidates.length; candidateIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const candidate = next2Candidates[candidateIndex];
    if (!yauBoundaryOkay444(candidate.state, model, crossMask, 5)) continue;
    // Bad Last-3 arrangements should be rejected quickly so the next legal
    // Next-2 arrangement can be tried. Successful human cases are normally
    // found in a few hundred milliseconds in this planner.
    const localDeadline = deadlineTs > 0
      ? Math.min(deadlineTs, Date.now() + 1800)
      : Date.now() + 1800;
    const finish = finishYauLastThree444(
      candidate.state,
      sliceFamily,
      model,
      localDeadline,
      crossMask,
    );
    if (!finish) continue;
    chosen = { candidate, finish, candidateIndex };
    break;
  }

  if (!chosen) {
    return {
      ok: false,
      reason: "444_YAU_LAST8_LOOKAHEAD_FAILED",
      detail: JSON.stringify({ candidates: next2Candidates.length, remaining: remainingCount }),
      solution: "",
      segments: [],
    };
  }

  state = chosen.finish.state;
  next2Moves = chosen.candidate.moves;
  last3Moves = chosen.finish.moves;
  console.error("YAU_LAST8_DIAG", JSON.stringify({
    crossMask,
    stage: "lookahead-chosen",
    elapsedMs: Date.now() - startedAt,
    next2Candidates: next2Candidates.length,
    chosenIndex: chosen.candidateIndex,
    workingSlice: sliceFamily.openMoves[0],
  }));

  if (!yauBoundaryOkay444(chosen.candidate.state, model, crossMask, 5)) {
    return { ok: false, reason: "444_YAU_LAST8_NEXT2_BOUNDARY_FAILED", solution: "", segments: [] };
  }
  segmentMoves.push({ id: "yau323Next2", name: "3-2-3 · Next 2", moves: next2Moves, pairStart: 8, pairEnd: 9 });
  if (!yauBoundaryOkay444(state, model, crossMask, 8)) {
    return { ok: false, reason: "444_YAU_LAST8_LAST3_BOUNDARY_FAILED", solution: "", segments: [] };
  }
  segmentMoves.push({ id: "yau323Last3", name: "3-2-3 · Last 3", moves: last3Moves, pairStart: 10, pairEnd: 12 });
'''
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Next2/Last3 replacement count {n}')

p.write_text(s)
print('added Next-2 frontier with Last-3 lookahead for true Yau 3-2-3')
