from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v2.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

first_old = '''          2,
          null,
          7,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );'''
first_new = '''          4,
          null,
          7,
          YAU_TARGET_RESCUE_BEAM_WIDTH,
          true,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );'''
if first_old not in s:
    raise SystemExit('protected Next 2 first search anchor not found')
s = s.replace(first_old, first_new, 1)

second_old = '''          2,
          null,
          8,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );'''
second_new = '''          4,
          null,
          8,
          YAU_TARGET_RESCUE_BEAM_WIDTH,
          true,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );'''
if second_old not in s:
    raise SystemExit('protected Next 2 second search anchor not found')
s = s.replace(second_old, second_new, 1)

p.write_text(s)
print('widened protected Yau Next 2 search')
