from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v7.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

anchor = '''export async function solveYauLastEight323444(publicScramble, publicYauSetup, options = {}) {
'''
helper = '''function searchYauLastThreeAligned444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
) {
  const setups = [[], ["U"], ["U'"], ["U2"]];
  for (const setup of setups) {
    if (deadlineReached(deadlineTs)) return null;
    const setupState = applyMovePath(initialState, setup, model);
    const cycle = searchYauLastEightCycle444(
      setupState,
      targetRemainingCount,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      7,
      false,
      false,
    );
    if (!cycle) continue;
    const undo = setup.slice().reverse().map(invertMoveToken);
    const finalState = applyMovePath(cycle.state, undo, model);
    if (!yauBoundaryOkay444(finalState, model, crossMask, targetRemainingCount)) continue;
    return {
      state: finalState,
      mask: pairedEdgeTypeMask(finalState),
      moves: [...setup, ...cycle.moves, ...undo],
    };
  }
  return null;
}

'''
if anchor not in s:
    raise SystemExit('solveYauLastEight anchor missing')
s = s.replace(anchor, helper + anchor, 1)

old = '''    const makeTen = searchYauLastEightCycle444(
      state,
      6,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      7,
      false,
      false,
    );
'''
new = '''    const makeTen = searchYauLastThreeAligned444(
      state,
      6,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
    );
'''
if old not in s:
    raise SystemExit('v7 flexible Last3 call missing')
s = s.replace(old, new, 1)
p.write_text(s)
print('added U/U-prime/U2 cross-down alignment for Yau Last 3 special cases')
