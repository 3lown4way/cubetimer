from pathlib import Path
p = Path("solver/solver444.js")
s = p.read_text()
old = '      diagnostics: remainingEdges?.meta?.diagnostics || null,\n'
new = '      diagnostics: remainingEdges?.meta || remainingEdges?.detail || null,\n'
assert old in s
p.write_text(s.replace(old, new, 1))
print("full Yau edge diagnostics enabled")
