from pathlib import Path

solver = Path('solver/solver444.js')
text = solver.read_text()

old = '''  // Human Yau grip sequence:\n  // 1) build the first center on U,\n  // 2) flip so the first center is D while building its opposite on U,\n  // 3) hold the cross center on the visible R face for Cross 3/4 and the last four centers,\n  // 4) put the cross on D before Cross 4/4 and the remaining edge stage.\n'''
new = '''  // Human Yau grip sequence:\n  // 1) build the first center on U,\n  // 2) flip so the first center is D while building its opposite on U,\n  // 3) hold the cross center on the visible R face for Cross 3/4, the last four centers, and Cross 4/4,\n  // 4) only after Cross 4/4, regrip the completed cross to D for 3-2-3.\n'''
assert old in text
text = text.replace(old, new, 1)

old = '''  const candidateSets = segments.map((_, index) => {\n    if (index === 0) return firstCenterCandidates;\n    if (index === 1) return oppositeCenterCandidates;\n    if (index === 2 || index === 3) return crossRightCandidates;\n    return crossDownCandidates;\n  });\n'''
new = '''  const candidateSets = segments.map((_, index) => {\n    if (index === 0) return firstCenterCandidates;\n    if (index === 1) return oppositeCenterCandidates;\n    return crossRightCandidates;\n  });\n'''
assert old in text
text = text.replace(old, new, 1)

old = '''    // One continuous human grip path for the entire Yau solve:\n    //   first center              -> cross color U\n    //   opposite center           -> cross color D\n    //   Cross 3/4 + last centers  -> cross color visible R\n    //   Cross 4/4                 -> cross color D\n    //   complete 3-2-3            -> keep the SAME cross-down grip\n    //   CFOP                       -> remain cross-down; yaw changes are allowed\n'''
new = '''    // One continuous human grip path for the entire Yau solve:\n    //   first center                         -> cross color U\n    //   opposite center                      -> cross color D\n    //   Cross 3/4 + last centers + Cross 4/4 -> cross color visible R\n    //   enter 3-2-3                          -> regrip the completed cross to D\n    //   complete 3-2-3                       -> keep the SAME cross-down grip\n    //   CFOP                                  -> remain cross-down; yaw changes are allowed\n'''
assert old in text
text = text.replace(old, new, 1)

old = '''        if (parent === 0) candidateSets.push(firstCenterCandidates);\n        else if (parent === 1) candidateSets.push(oppositeCenterCandidates);\n        else if (parent === 2 || parent === 3) candidateSets.push(crossRightCandidates);\n        else candidateSets.push([edgeGrip]);\n'''
new = '''        if (parent === 0) candidateSets.push(firstCenterCandidates);\n        else if (parent === 1) candidateSets.push(oppositeCenterCandidates);\n        else candidateSets.push(crossRightCandidates);\n'''
assert old in text
text = text.replace(old, new, 1)

solver.write_text(text)

verify = Path('tools/verify-444-yau.mjs')
v = verify.read_text()

old = '''  assert.ok(Number(setup.segments[4].viewpointRotations) >= 1, "Yau Cross 4/4 did not return the cross to the bottom");\n'''
new = '''  assert.equal(centerFaceForColor(solved.applyAlg(scramble).applyAlg(setup.solution), crossColor), "R", "Yau setup must finish Cross 4/4 with the cross still on R");\n'''
assert old in v
v = v.replace(old, new, 1)

old = '''  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;\n  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau Cross 4/4 must return the cross center to the D face before 3-2-3");\n  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");\n  assert.equal(\n    pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,\n    targetMask,\n    "Yau Cross 4/4 is not a complete cross around the D-face cross center",\n  );\n\n  const edge = result.stages[1];\n'''
new = '''  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;\n  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau Cross 4/4 must finish with the completed cross still on R");\n  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");\n  assert.equal(\n    pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,\n    targetMask,\n    "Yau Cross 4/4 is not a complete cross around the R-face cross center",\n  );\n\n  const edge = result.stages[1];\n'''
assert old in v
v = v.replace(old, new, 1)

old = '''  assert.equal(edge.segments.at(-1).pairEnd, 12);\n  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true);\n'''
new = '''  assert.equal(edge.segments.at(-1).pairEnd, 12);\n  assert.ok(Number(edge.segments[0].viewpointRotations) >= 1, "Yau 3-2-3 must begin by regripping the completed cross from R to D");\n  const first323Tokens = String(edge.segments[0].solution || "").trim().split(/\\s+/).filter(Boolean);\n  let first323TurnIndex = 0;\n  while (first323TurnIndex < first323Tokens.length && /^[xyz](?:2|')?$/.test(first323Tokens[first323TurnIndex])) {\n    pattern = pattern.applyAlg(first323Tokens[first323TurnIndex]);\n    first323TurnIndex += 1;\n  }\n  assert.ok(first323TurnIndex >= 1, "Yau 3-2-3 did not expose a leading cross-down regrip");\n  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau 3-2-3 must put the cross on D before its first pairing turn");\n  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true);\n'''
assert old in v
v = v.replace(old, new, 1)

old = '''  for (const segment of edge.segments) {\n    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);\n    for (const token of tokens) {\n      pattern = pattern.applyAlg(token);\n'''
new = '''  for (let segmentIndex = 0; segmentIndex < edge.segments.length; segmentIndex += 1) {\n    const segment = edge.segments[segmentIndex];\n    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);\n    const startIndex = segmentIndex === 0 ? first323TurnIndex : 0;\n    for (const token of tokens.slice(startIndex)) {\n      pattern = pattern.applyAlg(token);\n'''
assert old in v
v = v.replace(old, new, 1)

v = v.replace(
    'console.log("4x4 true Yau last-eight 3-2-3, D-cross boundaries, LL parity, and final verification passed");',
    'console.log("4x4 true Yau R-face Cross 4/4, explicit cross-down 3-2-3 regrip, LL parity, and final verification passed");'
)
verify.write_text(v)
print('patched Yau Cross4->3-2-3 grip boundary')
