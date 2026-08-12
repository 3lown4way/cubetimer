from pathlib import Path
p = Path('solver/solver444.js')
text = p.read_text()
old = '''    let bestYau = null;\n    for (const edgeGrip of crossDownCandidates) {\n'''
new = '''    let bestYau = null;\n    for (const rightGrip of crossRightCandidates) {\n      for (const edgeGrip of crossDownCandidates) {\n'''
assert old in text
text = text.replace(old, new, 1)
old = '''        if (parent === 0) candidateSets.push(firstCenterCandidates);\n        else if (parent === 1) candidateSets.push(oppositeCenterCandidates);\n        else candidateSets.push(crossRightCandidates);\n'''
new = '''        if (parent === 0) candidateSets.push(firstCenterCandidates);\n        else if (parent === 1) candidateSets.push(oppositeCenterCandidates);\n        else if (parent === 2) candidateSets.push(crossRightCandidates);\n        else candidateSets.push([rightGrip]);\n'''
assert old in text
text = text.replace(old, new, 1)
old = '''      if (!bestYau || score < bestYau.score) bestYau = { ...human, score };\n    }\n    if (!bestYau) return fallback();\n'''
new = '''      if (!bestYau || score < bestYau.score) bestYau = { ...human, score };\n      }\n    }\n    if (!bestYau) return fallback();\n'''
assert old in text
text = text.replace(old, new, 1)
p.write_text(text)
print('locked Remaining Centers and Cross4 to one R-face grip')
