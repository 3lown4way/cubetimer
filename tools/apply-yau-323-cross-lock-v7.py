from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v6.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()
old = '''          const multiCycle = searchSliceCycle(
            nextTwo.state,
            secondLockedMask,
            10,
'''
new = '''          const multiCycle = searchSliceCycle(
            nextTwo.state,
            requiredTypeMask,
            10,
'''
if old not in s:
    raise SystemExit('Last 3 protected mask anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
print('Last 3 now protects only the four Yau cross dedges')
