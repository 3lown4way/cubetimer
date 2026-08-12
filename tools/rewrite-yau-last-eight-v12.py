from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v11.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Helper for the middle "2" stage. It preserves the completed First-3 set,
# but can use one or two genuine slice cycles rather than generic commutators.
anchor = '''function finishYauLastThree444(initialState, sliceFamily, model, deadlineTs, crossMask) {
'''
helper = r'''function collectYauNextTwoCandidates444(
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
  const locked = yauLockedMask444(firstState, crossMask);
  let candidates = collectYauCycleGoals444(
    firstState, 5, sliceFamily, model, deadlineTs, crossMask, locked, 7, limit,
  );
  if (candidates.length || currentCount >= 4 || deadlineReached(deadlineTs)) return candidates;

  // Some 3->5 cases are naturally two short slice cycles.
  const middle = collectYauCycleGoals444(
    firstState, 4, sliceFamily, model, deadlineTs, crossMask, locked, 6, 4,
  );
  const combined = [];
  for (const first of middle) {
    if (deadlineReached(deadlineTs)) break;
    const second = collectYauCycleGoals444(
      first.state,
      5,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      yauLockedMask444(first.state, crossMask),
      6,
      3,
    );
    for (const candidate of second) {
      combined.push({
        state: candidate.state,
        mask: candidate.mask,
        moves: [...first.moves, ...candidate.moves],
      });
      if (combined.length >= limit) return combined;
    }
  }
  return combined;
}

'''
if anchor not in s:
    raise SystemExit('finish helper anchor missing')
s = s.replace(anchor, helper + anchor, 1)

# Replace the whole staged body after setup with a real 3 -> 2 -> 3 frontier.
pattern = re.compile(r'''  const initialRemainingCount = bitCount\(yauRemainingPairedMask444\(state, crossMask\)\);[\s\S]*?(?=  const segments = segmentMoves\.map)''')
replacement = r'''  const initialRemainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  const edgeStageDeadline = deadlineTs > 0
    ? Math.min(deadlineTs, startedAt + 7000)
    : startedAt + 7000;

  // FIRST 3: only the completed cross is sacred. Incidental non-cross pairs
  // are not locked; a human Yau solver may let those move while forming the
  // three stored pairs.
  let first3Candidates = initialRemainingCount >= 3
    ? [{ state, mask: pairedEdgeTypeMask(state), moves: [] }]
    : collectYauCycleGoals444(
        state,
        3,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        crossMask,
        7,
        6,
      );
  if (!first3Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }

  let chosenPipeline = null;
  for (let firstIndex = 0; firstIndex < first3Candidates.length; firstIndex += 1) {
    if (deadlineReached(edgeStageDeadline)) break;
    const first = first3Candidates[firstIndex];
    if (!yauBoundaryOkay444(first.state, model, crossMask, 3)) continue;

    const next2Candidates = collectYauNextTwoCandidates444(
      first.state,
      sliceFamily,
      model,
      edgeStageDeadline,
      crossMask,
      5,
    );
    for (let nextIndex = 0; nextIndex < next2Candidates.length; nextIndex += 1) {
      if (deadlineReached(edgeStageDeadline)) break;
      const next = next2Candidates[nextIndex];
      if (!yauBoundaryOkay444(next.state, model, crossMask, 5)) continue;

      const candidateDeadline = Math.min(edgeStageDeadline, Date.now() + 1800);
      const finish = finishYauLastThree444(
        next.state,
        sliceFamily,
        model,
        candidateDeadline,
        crossMask,
      );
      if (!finish) continue;

      chosenPipeline = {
        first,
        next,
        finish,
        firstIndex,
        nextIndex,
        firstCandidateCount: first3Candidates.length,
        nextCandidateCount: next2Candidates.length,
      };
      break;
    }
    if (chosenPipeline) break;
  }

  if (!chosenPipeline) {
    return {
      ok: false,
      reason: deadlineReached(edgeStageDeadline)
        ? "444_YAU_LAST8_LOCAL_DEADLINE"
        : "444_YAU_LAST8_LOOKAHEAD_FAILED",
      detail: JSON.stringify({ firstCandidates: first3Candidates.length }),
      solution: "",
      segments: [],
    };
  }

  state = chosenPipeline.finish.state;
  const segmentMoves = [
    {
      id: "yau323First3",
      name: "3-2-3 · First 3",
      moves: chosenPipeline.first.moves,
      pairStart: 5,
      pairEnd: 7,
    },
    {
      id: "yau323Next2",
      name: "3-2-3 · Next 2",
      moves: chosenPipeline.next.moves,
      pairStart: 8,
      pairEnd: 9,
    },
    {
      id: "yau323Last3",
      name: "3-2-3 · Last 3",
      moves: chosenPipeline.finish.moves,
      pairStart: 10,
      pairEnd: 12,
    },
  ];

  console.error("YAU_LAST8_DIAG", JSON.stringify({
    crossMask,
    stage: "pipeline-chosen",
    elapsedMs: Date.now() - startedAt,
    firstCandidates: chosenPipeline.firstCandidateCount,
    firstIndex: chosenPipeline.firstIndex,
    nextCandidates: chosenPipeline.nextCandidateCount,
    nextIndex: chosenPipeline.nextIndex,
    workingSlice: sliceFamily.openMoves[0],
  }));

'''
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'full staged body replacement count {n}')

p.write_text(s)
print('rewrote Yau 3-2-3 as First3 -> Next2 -> Last3 staged lookahead')
