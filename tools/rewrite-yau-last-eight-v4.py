from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v3.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

old = '''function searchYauLastEightCycle444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
  exactTargetCount = true,
) {
  return searchSliceCycle(
    initialState,
    yauLockedMask444(initialState, crossMask),
'''
new = '''function searchYauLastEightCycle444(
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
'''
if old not in s:
    raise SystemExit('searchYauLastEightCycle signature anchor missing')
s = s.replace(old, new, 1)

old = '''function advanceYauRemainingCount444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
) {
'''
new = '''function advanceYauRemainingCount444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
  preserveExisting = true,
) {
'''
if old not in s:
    raise SystemExit('advance signature anchor missing')
s = s.replace(old, new, 1)

old = '''    maxOuterMoves,
    true,
  );
'''
new = '''    maxOuterMoves,
    true,
    preserveExisting,
  );
'''
# Two occurrences in advance: exact and overshoot. Replace first two after function start.
pos = s.index('function advanceYauRemainingCount444(')
head, tail = s[:pos], s[pos:]
if tail.count(old) < 2:
    raise SystemExit('advance search calls missing')
tail = tail.replace(old, new, 2)
s = head + tail

old = '''    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7,
    );
'''
new = '''    const makeTen = advanceYauRemainingCount444(
      state, 6, sliceFamily, model, deadlineTs, crossMask, 7, false,
    );
'''
if old not in s:
    raise SystemExit('Last3 makeTen call missing')
s = s.replace(old, new, 1)
p.write_text(s)
print('allowed Last 3 to reuse non-cross paired edges while hard-locking only the cross')
