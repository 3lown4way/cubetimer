from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v17.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

old = '''  if (!first3Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }

  let chosenPipeline = null;
'''
new = '''  console.error("YAU_F2L_DIAG", JSON.stringify({
    crossMask,
    stage: "first3-candidates",
    elapsedMs: Date.now() - startedAt,
    candidates: first3Candidates.length,
    lengths: first3Candidates.map((candidate) => candidate.moves.length),
    workingSlice: sliceFamily.openMoves[0],
  }));
  if (!first3Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }

  let chosenPipeline = null;
'''
if old not in s:
    raise SystemExit('first3 diagnostic anchor missing')
s = s.replace(old, new, 1)

old = '''      const next2Candidates = collectYauNextTwoCandidates444(
        first.state,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        5,
      );
'''
new = '''      const next2StartedAt = Date.now();
      const next2Candidates = collectYauNextTwoCandidates444(
        first.state,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        5,
      );
      console.error("YAU_F2L_DIAG", JSON.stringify({
        crossMask,
        stage: "next2-candidates",
        elapsedMs: Date.now() - startedAt,
        stageMs: Date.now() - next2StartedAt,
        firstIndex,
        candidates: next2Candidates.length,
        lengths: next2Candidates.map((candidate) => candidate.moves.length),
      }));
'''
if old not in s:
    raise SystemExit('next2 diagnostic anchor missing')
s = s.replace(old, new, 1)

old = '''        const finish = finishYauLastThree444(
          next.state,
          sliceFamily,
          model,
          candidateDeadline,
          crossMask,
        );
        if (!finish) continue;
'''
new = '''        const last3StartedAt = Date.now();
        const finish = finishYauLastThree444(
          next.state,
          sliceFamily,
          model,
          candidateDeadline,
          crossMask,
        );
        console.error("YAU_F2L_DIAG", JSON.stringify({
          crossMask,
          stage: "last3-attempt",
          elapsedMs: Date.now() - startedAt,
          stageMs: Date.now() - last3StartedAt,
          firstIndex,
          nextIndex,
          success: !!finish,
          moveCount: finish?.moves?.length || 0,
        }));
        if (!finish) continue;
'''
if old not in s:
    raise SystemExit('last3 diagnostic anchor missing')
s = s.replace(old, new, 1)

p.write_text(s)
print('instrumented F2L-trigger Yau stage timing')
