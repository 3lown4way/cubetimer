from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()

start = s.find("function searchTargetEdgeTypes444(")
assert start >= 0, "missing Yau target search"
end = s.find("function searchOuterCrossAlignment444(", start)
assert end > start, "missing Yau target search end"
block = s[start:end]
old = "const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, false);"
new = "const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);"
assert old in block, "missing Yau target action application"
block = block.replace(old, new, 1)
s = s[:start] + block + s[end:]

p.write_text(s)
print("Yau target search now tracks actual center permutations at every macro endpoint")
