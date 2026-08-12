from pathlib import Path
import re
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v5.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
pattern = re.compile(r'''        if \(yauBank\) \{\n          const multiCycle = searchTargetEdgeTypes444\(.*?\n          finalSetup = multiCycle\n            \? \{.*?\n              \}\n            : null;\n        \} else \{''', re.S)
replacement = '''        if (yauBank) {
          const multiCycle = searchSliceCycle(
            nextTwo.state,
            secondLockedMask,
            10,
            sliceFamily,
            model,
            deadlineTs,
            7,
            requiredSolvedTypeMask,
            { requiredPairedEveryMoveMask: requiredTypeMask },
          );
          finalSetup = multiCycle
            ? {
                ...multiCycle,
                sliceFamily,
                frameRotation: sliceFamily.rotation,
                workingSlice: sliceFamily.openMoves[0][0],
              }
            : null;
        } else {'''
s2, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Yau Last 3 setup replacement count={n}')
p.write_text(s2)
print('installed true Yau protected Last 3 setup slice cycle')
