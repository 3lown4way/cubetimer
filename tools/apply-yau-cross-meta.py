from pathlib import Path

path = Path('solver/solver444.js')
s = path.read_text()
old = '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,'''
new = '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3SearchRescueUsed: cross3.searchRescueUsed === true,
      yauCross3SearchMaxMacros: Number(cross3.searchMaxMacros) || 0,
      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCross4SearchRescueUsed: cross4.searchRescueUsed === true,
      yauCross4SearchMaxMacros: Number(cross4.searchMaxMacros) || 0,
      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauCrossAlignmentRescueUsed: cross4.alignmentRescueUsed === true,
      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,'''
if old not in s:
    raise SystemExit('missing Yau meta anchor')
path.write_text(s.replace(old, new, 1))
print('patched Yau cross diagnostics meta')
