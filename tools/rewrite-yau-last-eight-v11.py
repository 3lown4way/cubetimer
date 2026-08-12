from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v10.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Let the cycle collector skip trivial depth-0 open/close when it is being
# used as a Last-3 special-case reconfiguration.
old = '''  maxOuterMoves = 7,
  goalLimit = 10,
) {
'''
new = '''  maxOuterMoves = 7,
  goalLimit = 10,
  minimumOuterDepth = 0,
) {
'''
if old not in s:
    raise SystemExit('collector signature anchor missing')
s = s.replace(old, new, 1)

old = '''          remaining >= targetRemainingCount &&
          maskContains(closedMask, lockedMask) &&
'''
new = '''          depth >= minimumOuterDepth &&
          remaining >= targetRemainingCount &&
          maskContains(closedMask, lockedMask) &&
'''
if old not in s:
    raise SystemExit('collector depth goal anchor missing')
s = s.replace(old, new, 1)

pattern = re.compile(r'''function finishYauLastThree444\([\s\S]*?\n\}\n\n(?=function searchYauLastThreeAligned444)''')
replacement = r'''function finishYauLastThree444(initialState, sliceFamily, model, deadlineTs, crossMask) {
  let state = initialState;
  const moves = [];
  let remaining = bitCount(yauRemainingPairedMask444(state, crossMask));

  if (remaining < 6) {
    // First try the normal Last-3 insertion directly.
    const directDeadline = deadlineTs > 0
      ? Math.min(deadlineTs, Date.now() + 850)
      : Date.now() + 850;
    let makeTen = searchYauLastThreeAligned444(
      state, 6, sliceFamily, model, directDeadline, crossMask,
    );

    // Real 3-2-3 has Last-3 special cases. If the direct insertion is bad,
    // perform one short cross-safe slice cycle purely to reconfigure the
    // remaining edges, then retry. Previously paired non-cross edges may be
    // reused as buffers; the completed cross itself is never released.
    if (!makeTen && !deadlineReached(deadlineTs)) {
      const reframeDeadline = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + 1100)
        : Date.now() + 1100;
      const reframes = collectYauCycleGoals444(
        state,
        5,
        sliceFamily,
        model,
        reframeDeadline,
        crossMask,
        crossMask,
        5,
        5,
        1,
      );
      const initialKey = compactStateKey(state, true);
      for (const reframe of reframes) {
        if (compactStateKey(reframe.state, true) === initialKey) continue;
        const afterReframeCount = bitCount(yauRemainingPairedMask444(reframe.state, crossMask));
        if (afterReframeCount >= 6) {
          makeTen = reframe;
          break;
        }
        const retryDeadline = deadlineTs > 0
          ? Math.min(deadlineTs, Date.now() + 850)
          : Date.now() + 850;
        const retry = searchYauLastThreeAligned444(
          reframe.state, 6, sliceFamily, model, retryDeadline, crossMask,
        );
        if (!retry) continue;
        makeTen = {
          state: retry.state,
          mask: pairedEdgeTypeMask(retry.state),
          moves: [...reframe.moves, ...retry.moves],
        };
        break;
      }
    }

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
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'finishYauLastThree replacement count {n}')

p.write_text(s)
print('added a single human-style Last-3 special-case reconfiguration cycle')
