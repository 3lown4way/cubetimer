from pathlib import Path

p = Path("solver/solver444.js")
s = p.read_text()

old = '''  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );'''
new = '''  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
  );'''
if old not in s:
    raise SystemExit("missing primary Yau 3-2-3 call")
s = s.replace(old, new, 1)

old = '''      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        { deadlineTs },
      );'''
new = '''      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        {
          deadlineTs,
          requiredSolvedTypeMask: targetTypeMask,
        },
      );'''
if old not in s:
    raise SystemExit("missing Yau 3-2-3 rescue call")
s = s.replace(old, new, 1)

old = '''      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
new = '''      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauEdge323CrossDownRequired: true,
      yauPureCenterMoveCount: publicCenterMoves.length,'''
if old not in s:
    raise SystemExit("missing Yau 3-2-3 metadata anchor")
s = s.replace(old, new, 1)

p.write_text(s)
