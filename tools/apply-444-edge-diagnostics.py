from pathlib import Path

p = Path('solver/solver444.js')
s = p.read_text()
s = s.replace(
    'edge323FallbackReason: human?.reason || human?.detail || "444_323_NO_PLAN",',
    'edge323FallbackReason: human?.detail || human?.reason || "444_323_NO_PLAN",',
)
p.write_text(s)

p = Path('tools/verify-444-edge-323.mjs')
s = p.read_text()
old = '  assert.equal(edgeStage.method, "3-2-3", `expected human 3-2-3 edge method for ${scramble}`);\n'
new = '''  assert.equal(\n    edgeStage.method,\n    "3-2-3",\n    `expected human 3-2-3 edge method for ${scramble}; fallback=${result.meta?.edge323FallbackReason || "none"}`,\n  );\n'''
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit('3-2-3 assertion marker missing')
p.write_text(s)
