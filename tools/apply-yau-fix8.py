from pathlib import Path

p = Path("solver/edgePairing444.js")
s = p.read_text()
s = s.replace("const YAU_TARGET_BEAM_WIDTH = 1800;", "const YAU_TARGET_BEAM_WIDTH = 3600;", 1)
p.write_text(s)

p = Path("solver/solver444.js")
s = p.read_text()
old = '''      targetCount: 3,
      deadlineTs,
      maxMacros: 6,
      postSequence: remainingCenters,'''
new = '''      targetCount: 3,
      deadlineTs,
      maxMacros: 8,
      postSequence: remainingCenters,'''
assert old in s, "missing Yau Cross3 search options"
s = s.replace(old, new, 1)
p.write_text(s)

print("Yau Cross3 search broadened for non-D cross frames")
