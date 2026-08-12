from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v12.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

old = '''  let chosenPipeline = null;
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
'''
new = '''  let chosenPipeline = null;
  const tryFirstTier = (candidates, tier) => {
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      if (deadlineReached(edgeStageDeadline)) break;
      const first = candidates[firstIndex];
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

        const candidateDeadline = Math.min(edgeStageDeadline, Date.now() + 1500);
        const finish = finishYauLastThree444(
          next.state,
          sliceFamily,
          model,
          candidateDeadline,
          crossMask,
        );
        if (!finish) continue;

        return {
          first,
          next,
          finish,
          tier,
          firstIndex,
          nextIndex,
          firstCandidateCount: candidates.length,
          nextCandidateCount: next2Candidates.length,
        };
      }
    }
    return null;
  };

  chosenPipeline = tryFirstTier(first3Candidates, 1);

  // If every shortest First-3 arrangement creates a bad continuation, look
  // exactly one outer-depth deeper before giving up. This is still a genuine
  // Yau slice cycle; it is just one-move lookahead rather than a generic
  // reduction fallback.
  if (!chosenPipeline && initialRemainingCount < 3 && !deadlineReached(edgeStageDeadline)) {
    const shortestOuterDepth = first3Candidates.length
      ? Math.max(0, first3Candidates[0].moves.length - 2)
      : 0;
    const secondTierDeadline = Math.min(edgeStageDeadline, Date.now() + 2200);
    const secondTier = collectYauCycleGoals444(
      state,
      3,
      sliceFamily,
      model,
      secondTierDeadline,
      crossMask,
      crossMask,
      7,
      6,
      shortestOuterDepth + 1,
    );
    if (secondTier.length) chosenPipeline = tryFirstTier(secondTier, 2);
  }

  if (!chosenPipeline) {
'''
if old not in s:
    raise SystemExit('v12 pipeline selection block not found')
s = s.replace(old, new, 1)

old = '''    firstCandidates: chosenPipeline.firstCandidateCount,
    firstIndex: chosenPipeline.firstIndex,
'''
new = '''    firstTier: chosenPipeline.tier,
    firstCandidates: chosenPipeline.firstCandidateCount,
    firstIndex: chosenPipeline.firstIndex,
'''
if old not in s:
    raise SystemExit('pipeline diagnostic anchor not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('added second-shortest First-3 tier when shortest Yau continuation is bad')
