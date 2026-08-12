from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v6.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

repls = [
('''  state = first3.state;\n  if (!yauBoundaryOkay444(state, model, crossMask, 3)) {\n''', '''  state = first3.state;\n  console.error("YAU_LAST8_DIAG", JSON.stringify({ crossMask, stage: "first3", elapsedMs: Date.now() - startedAt, remaining: bitCount(yauRemainingPairedMask444(state, crossMask)), workingSlice: sliceFamily.openMoves[0] }));\n  if (!yauBoundaryOkay444(state, model, crossMask, 3)) {\n'''),
('''  if (!yauBoundaryOkay444(state, model, crossMask, 5)) {\n''', '''  console.error("YAU_LAST8_DIAG", JSON.stringify({ crossMask, stage: "next2", elapsedMs: Date.now() - startedAt, remaining: bitCount(yauRemainingPairedMask444(state, crossMask)), workingSlice: sliceFamily.openMoves[0] }));\n  if (!yauBoundaryOkay444(state, model, crossMask, 5)) {\n'''),
('''  let last3Moves = [];\n  remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));\n''', '''  let last3Moves = [];\n  remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));\n  console.error("YAU_LAST8_DIAG", JSON.stringify({ crossMask, stage: "last3-enter", elapsedMs: Date.now() - startedAt, remaining: remainingCount, workingSlice: sliceFamily.openMoves[0] }));\n'''),
('''    if (!makeTen) {\n      return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };\n    }\n''', '''    if (!makeTen) {\n      console.error("YAU_LAST8_DIAG", JSON.stringify({ crossMask, stage: "last3-cycle-fail", elapsedMs: Date.now() - startedAt, remaining: bitCount(yauRemainingPairedMask444(state, crossMask)), workingSlice: sliceFamily.openMoves[0] }));\n      return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [], detail: JSON.stringify({ elapsedMs: Date.now() - startedAt, remaining: bitCount(yauRemainingPairedMask444(state, crossMask)), workingSlice: sliceFamily.openMoves[0] }) };\n    }\n'''),
('''    state = makeTen.state;\n    last3Moves.push(...makeTen.moves);\n''', '''    state = makeTen.state;\n    last3Moves.push(...makeTen.moves);\n    console.error("YAU_LAST8_DIAG", JSON.stringify({ crossMask, stage: "last3-cycle", elapsedMs: Date.now() - startedAt, remaining: bitCount(yauRemainingPairedMask444(state, crossMask)), workingSlice: sliceFamily.openMoves[0] }));\n'''),
]
for old, new in repls:
    if old not in s:
        raise SystemExit('diagnostic anchor missing: ' + old[:50])
    s = s.replace(old, new, 1)
p.write_text(s)
print('instrumented Yau last-eight stage timing')
