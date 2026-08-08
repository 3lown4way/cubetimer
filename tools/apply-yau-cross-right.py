from pathlib import Path

solver = Path("solver/solver444.js")
s = solver.read_text()
old = '''  const crossLeftCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.L === normalizedCross && entry.map.R === opposite,
  );'''
new = '''  const crossRightCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.R === normalizedCross && entry.map.L === opposite,
  );'''
if old not in s:
    raise SystemExit("missing cross-left Yau presentation anchor")
s = s.replace(old, new, 1)
old = '''    if (index === 2 || index === 3) return crossLeftCandidates;'''
new = '''    if (index === 2 || index === 3) return crossRightCandidates;'''
if old not in s:
    raise SystemExit("missing Yau cross-left candidate use")
s = s.replace(old, new, 1)
solver.write_text(s)

verify = Path("tools/verify-444-yau.mjs")
v = verify.read_text()
old = '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");'''
new = '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "human-view Cross 3/4 must keep the cross center on the R face");'''
if old not in v:
    raise SystemExit("missing Cross 3/4 verification anchor")
v = v.replace(old, new, 1)
old = '''  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;'''
new = '''  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau remaining centers must keep the 3-cross on the R face");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;
  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau Cross 4/4 must return the cross center to the D face before 3-2-3");'''
if old not in v:
    raise SystemExit("missing Remaining Centers verification anchor")
v = v.replace(old, new, 1)
verify.write_text(v)
