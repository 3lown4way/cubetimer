from pathlib import Path
import runpy

runpy.run_path('tools/apply-yau-323-cross-lock-v8.py', run_name='__main__')

# The invariant during 3-2-3 is the four cross DEDGES staying paired.
# Their exact solved slots may move under outer setup turns; align them with
# outer turns only after all 12 dedges are paired.
p = Path('solver/solver444.js')
s = p.read_text()
old = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
'''
new = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
'''
if old not in s:
    raise SystemExit('solver444 requiredSolved option anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

# Regression: require atomic pair preservation. Exact D-slot position only
# needs to be restored before the reduced 3x3 stage; outer-only alignment is safe.
p = Path('tools/verify-444-yau.mjs')
v = p.read_text()
old = '''  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau 3-2-3 must never fall back to a free bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  assert.equal(Number(result.meta.yauCrossRestoreMoveCount), 0, "Yau edge pairing must not need Cross Restore");
  assert.equal(result.meta.yauEdge323?.protectedCrossPairedEveryMove, true);
'''
new = '''  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau 3-2-3 must never fall back to a free bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  assert.equal(result.meta.yauEdge323?.protectedCrossPairedEveryMove, true);
'''
if old not in v:
    raise SystemExit('verifier restore-count assertion anchor not found')
v = v.replace(old, new, 1)
old = '''    assert.equal(
      solvedTypeMask(pattern) & targetMask,
      targetMask,
      `Yau 3-2-3 did not restore the solved cross after ${segment.name}`,
    );
  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
'''
new = '''  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
'''
if old not in v:
    raise SystemExit('verifier per-segment solved assertion anchor not found')
v = v.replace(old, new, 1)

# If an explicit final cross alignment is present, it must be outer-turn only.
needle = '''  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
replacement = '''  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 did not finish with the cross aligned");
  const crossRestore = edge.segments.find((segment) => segment.id === "yauCrossRestore");
  if (crossRestore?.solution) {
    const restoreTokens = String(crossRestore.solution).trim().split(/\\s+/).filter(Boolean);
    assert.ok(
      restoreTokens.every((token) => /^[URFDLB](?:2|')?$/.test(token)),
      `Yau final cross alignment must be outer-turn only: ${crossRestore.solution}`,
    );
  }
'''
if needle not in v:
    raise SystemExit('verifier final cross assertion anchor not found')
v = v.replace(needle, replacement, 1)
p.write_text(v)
print('Yau 3-2-3 now preserves cross dedge pairs; final alignment is outer-turn only')
