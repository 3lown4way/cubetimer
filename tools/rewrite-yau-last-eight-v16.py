from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v15.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
# Give the true First-3 insertion enough room for three F2L-style insertions.
old = '''        crossMask,
        crossMask,
        7,
        6,
        0,
        sliceFamily.middleMask,
        3,
      );
'''
new = '''        crossMask,
        crossMask,
        11,
        6,
        0,
        sliceFamily.middleMask,
        3,
      );
'''
if old not in s:
    raise SystemExit('positional First3 depth anchor missing')
s = s.replace(old, new, 1)
# Diagnostic edge budget only; production value will be tuned after measuring.
s = s.replace('''    ? Math.min(deadlineTs, startedAt + 7000)
    : startedAt + 7000;
''', '''    ? Math.min(deadlineTs, startedAt + 12000)
    : startedAt + 12000;
''', 1)
p.write_text(s)
print('extended positional First3 to 11 outer moves for F-only measurement')
