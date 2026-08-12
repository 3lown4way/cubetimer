from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v14.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
old = '''  if (!first3Candidates.length) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }
'''
new = '''  if (!first3Candidates.length) {
    console.error("YAU_FIRST3_POSITION_DIAG", JSON.stringify({
      crossMask,
      pairedSlotMask: pairedSlotMask(state),
      middleMask: sliceFamily.middleMask,
      lastLayerMask: sliceFamily.lastLayerMask,
      initialMiddlePaired,
      middlePairedMask: pairedSlotMask(state) & sliceFamily.middleMask,
      lastLayerPairedMask: pairedSlotMask(state) & sliceFamily.lastLayerMask,
      initialRemainingCount,
      workingSlice: sliceFamily.openMoves[0],
    }));
    return {
      ok: false,
      reason: "444_YAU_LAST8_FIRST3_FAILED",
      detail: JSON.stringify({
        initialMiddlePaired,
        middlePairedMask: pairedSlotMask(state) & sliceFamily.middleMask,
        lastLayerPairedMask: pairedSlotMask(state) & sliceFamily.lastLayerMask,
        pairedSlotMask: pairedSlotMask(state),
      }),
      solution: "",
      segments: [],
    };
  }
'''
if old not in s:
    raise SystemExit('First3 failure anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)
print('instrumented positional First3 exception state')
