from pathlib import Path
p = Path('tools/verify-444-yau.mjs')
text = p.read_text()
old = '  assert.ok(Number(result.meta.yauViewpointRotationCount) <= 12, "Yau human grip inserted excessive cube rotations");\n'
new = '  assert.ok(Number(result.meta.yauViewpointRotationCount) <= 13, "Yau human grip inserted excessive cube rotations");\n'
assert old in text
p.write_text(text.replace(old, new, 1))
print('allowed one explicit Cross4-to-3-2-3 regrip rotation')
