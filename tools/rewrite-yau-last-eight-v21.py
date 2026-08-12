from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v20.py', run_name='__main__')

# Remove temporary timing diagnostics from the verified implementation.
p = Path('solver/edgePairing444.js')
s = p.read_text()
s, count = re.subn(
    r'\n\s*console\.error\("YAU_LAST8_DIAG", JSON\.stringify\(\{[\s\S]*?\}\)\);\n',
    '\n',
    s,
)
# The final chain should contain exactly the staged-pipeline diagnostic. Keep
# this tolerant to earlier rewrites, but ensure no debug marker reaches prod.
if 'YAU_LAST8_DIAG' in s or 'YAU_F2L_DIAG' in s or 'YAU_FIRST3_POSITION_DIAG' in s:
    raise SystemExit('Yau diagnostic logging remained after cleanup')
p.write_text(s)
print(f'cleaned {count} temporary Yau diagnostic block(s)')
