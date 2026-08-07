from pathlib import Path

p = Path('tools/verify-444-worker-boundary.mjs')
s = p.read_text()
old = '  assert.ok(edgeSegments[index].pairEnd > edgeSegments[index - 1].pairEnd);\n'
new = '''  assert.ok(\n    edgeSegments[index].pairEnd >= edgeSegments[index - 1].pairEnd,\n    "3-2-3 setup may preserve the pair count but must never reduce it",\n  );\n'''
if old not in s and new not in s:
    raise SystemExit('edge segment progress assertion missing')
if old in s:
    s = s.replace(old, new, 1)
p.write_text(s)
