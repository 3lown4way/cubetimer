from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v3.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

search_fn = r'''function searchYauLastEightCycle444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
  exactTargetCount = true,
  preserveExisting = true,
) {
  return searchSliceCycle(
    initialState,
    preserveExisting ? yauLockedMask444(initialState, crossMask) : crossMask,
    targetRemainingCount,
    sliceFamily,
    model,
    deadlineTs,
    maxOuterMoves,
    crossMask,
    {
      targetTypeMask: 0x0fff ^ crossMask,
      exactTargetCount,
      requireAllCenters: true,
      requiredPairedEveryMoveMask: crossMask,
    },
  );
}

'''
pattern = r'function searchYauLastEightCycle444\([\s\S]*?\n\}\n\n(?=function advanceYauRemainingCount444)'
s, n = re.subn(pattern, lambda _: search_fn, s, count=1)
if n != 1:
    raise SystemExit(f'searchYauLastEightCycle replacement count {n}')

advance_fn = r'''function advanceYauRemainingCount444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
  preserveExisting = true,
) {
  const currentCount = bitCount(yauRemainingPairedMask444(initialState, crossMask));
  if (currentCount >= targetRemainingCount) {
    return { state: initialState, mask: pairedEdgeTypeMask(initialState), moves: [] };
  }

  let result = searchYauLastEightCycle444(
    initialState,
    targetRemainingCount,
    sliceFamily,
    model,
    deadlineTs,
    crossMask,
    maxOuterMoves,
    true,
    preserveExisting,
  );
  if (!result && !deadlineReached(deadlineTs)) {
    result = searchYauLastEightCycle444(
      initialState,
      targetRemainingCount,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      maxOuterMoves,
      false,
      preserveExisting,
    );
  }
  return result;
}

'''
pattern = r'function advanceYauRemainingCount444\([\s\S]*?\n\}\n\n(?=export async function solveYauLastEight323444)'
s, n = re.subn(pattern, lambda _: advance_fn, s, count=1)
if n != 1:
    raise SystemExit(f'advanceYauRemainingCount replacement count {n}')

old = '''    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7,
    );
'''
new = '''    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7, false,
    );
'''
if old not in s:
    raise SystemExit('Last3 makeTen call not found')
s = s.replace(old, new, 1)

p.write_text(s)
print('Yau Last 3 now reuses non-cross paired edges while hard-locking only the four cross dedges')
