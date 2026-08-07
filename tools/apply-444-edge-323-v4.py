from pathlib import Path

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Runs after v2 + v3. Keep seed and First3 at the normal depth. Only the later
# 3-2-3 groups get a slightly deeper outer-setup budget; diagnostics show the
# difficult regression reaches First3 exactly once and then stalls at Next2.
s = s.replace(
    'function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs) {',
    'function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES) {',
    1,
)
s = s.replace('for (let depth = 0; depth <= SLICE_MAX_OUTER_MOVES; depth += 1) {', 'for (let depth = 0; depth <= maxOuterMoves; depth += 1) {', 1)
s = s.replace('if (depth === SLICE_MAX_OUTER_MOVES) continue;', 'if (depth === maxOuterMoves) continue;', 1)

old_sig = '''function searchSliceCycleAcrossFrames(\n  initialState,\n  lockedTypeMask,\n  targetCount,\n  preferredFamily,\n  model,\n  deadlineTs,\n) {'''
new_sig = '''function searchSliceCycleAcrossFrames(\n  initialState,\n  lockedTypeMask,\n  targetCount,\n  preferredFamily,\n  model,\n  deadlineTs,\n  maxOuterMoves = SLICE_MAX_OUTER_MOVES,\n) {'''
if old_sig not in s:
    raise SystemExit('searchSliceCycleAcrossFrames signature missing')
s = s.replace(old_sig, new_sig, 1)

old_call = '''      sliceFamily,\n      model,\n      deadlineTs,\n    );'''
new_call = '''      sliceFamily,\n      model,\n      deadlineTs,\n      maxOuterMoves,\n    );'''
# Only the call inside searchSliceCycleAcrossFrames has this exact indentation
# before the later planner calls after the v3 patch.
idx = s.find('function searchSliceCycleAcrossFrames(')
call_idx = s.find(old_call, idx)
if call_idx < 0:
    raise SystemExit('searchSliceCycleAcrossFrames inner call missing')
s = s[:call_idx] + s[call_idx:].replace(old_call, new_call, 1)

# Targeted deeper budget for Next2 and optional Last3 only.
needle = '''        sliceFamily,\n        model,\n        deadlineTs,\n      );\n      if (!nextTwo) {'''
replacement = '''        sliceFamily,\n        model,\n        deadlineTs,\n        7,\n      );\n      if (!nextTwo) {'''
if needle not in s:
    raise SystemExit('Next2 across-frame call missing')
s = s.replace(needle, replacement, 1)

needle = '''          nextTwo.sliceFamily || sliceFamily,\n          model,\n          deadlineTs,\n        );\n        if (!finalSetup) {'''
replacement = '''          nextTwo.sliceFamily || sliceFamily,\n          model,\n          deadlineTs,\n          7,\n        );\n        if (!finalSetup) {'''
if needle not in s:
    raise SystemExit('Last3 across-frame call missing')
s = s.replace(needle, replacement, 1)

p.write_text(s)
