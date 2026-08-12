from pathlib import Path
import runpy

runpy.run_path('tools/rewrite-yau-last-eight-v13.py', run_name='__main__')

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Explicit 3-2-3 position model in the base frame. The existing base bank is
# the U-layer cross slots. The four FR/FL/BR/BL slots are the middle layer;
# the opposite D layer is the remaining outer layer. Each slice family rotates
# all three masks together.
old = '''const EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);
const EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_FRAME_ROTATIONS = Object.freeze(["", "x", "x2", "x'", "z", "z'"]);
'''
new = '''const EDGE_323_BANK_SLOTS = Object.freeze([0, 7, 10, 11]);
const EDGE_323_BANK_MASK = EDGE_323_BANK_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_MIDDLE_SLOTS = Object.freeze([1, 2, 8, 9]); // FR FL BL BR
const EDGE_323_MIDDLE_MASK = EDGE_323_MIDDLE_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_OPPOSITE_SLOTS = Object.freeze([3, 4, 5, 6]); // DF DR DL DB
const EDGE_323_OPPOSITE_MASK = EDGE_323_OPPOSITE_SLOTS.reduce((mask, slot) => mask | (1 << slot), 0);
const EDGE_323_FRAME_ROTATIONS = Object.freeze(["", "x", "x2", "x'", "z", "z'"]);
'''
if old not in s:
    raise SystemExit('323 base mask constants anchor missing')
s = s.replace(old, new, 1)

old = '''      return {
        rotation,
        bankMask: EDGE_323_BANK_MASK,
        openMoves: ["Dw", "Dw'"],
      };
'''
new = '''      return {
        rotation,
        bankMask: EDGE_323_BANK_MASK,
        middleMask: EDGE_323_MIDDLE_MASK,
        lastLayerMask: EDGE_323_OPPOSITE_MASK,
        openMoves: ["Dw", "Dw'"],
      };
'''
if old not in s:
    raise SystemExit('identity slice family anchor missing')
s = s.replace(old, new, 1)

old = '''    const bankMask = transformSlotMask(EDGE_323_BANK_MASK, rotationAction);
    const conjugatedOpen = actionFor(`${rotation} Dw ${inverseRotation}`);
'''
new = '''    const bankMask = transformSlotMask(EDGE_323_BANK_MASK, rotationAction);
    const middleMask = transformSlotMask(EDGE_323_MIDDLE_MASK, rotationAction);
    const lastLayerMask = transformSlotMask(EDGE_323_OPPOSITE_MASK, rotationAction);
    const conjugatedOpen = actionFor(`${rotation} Dw ${inverseRotation}`);
'''
if old not in s:
    raise SystemExit('rotated slice family mask anchor missing')
s = s.replace(old, new, 1)

old = '''    return {
      rotation,
      bankMask,
      openMoves: [openMove, invertMoveToken(openMove)],
    };
'''
new = '''    return {
      rotation,
      bankMask,
      middleMask,
      lastLayerMask,
      openMoves: [openMove, invertMoveToken(openMove)],
    };
'''
if old not in s:
    raise SystemExit('rotated slice family return anchor missing')
s = s.replace(old, new, 1)

# Extend the Yau cycle collector with physical slot goals, not just pair count.
old = '''  goalLimit = 10,
  minimumOuterDepth = 0,
) {
  const goals = new Map();
'''
new = '''  goalLimit = 10,
  minimumOuterDepth = 0,
  targetSlotMask = 0,
  targetSlotCount = 0,
) {
  const goals = new Map();
'''
if old not in s:
    raise SystemExit('cycle collector signature anchor missing')
s = s.replace(old, new, 1)

old = '''        const remaining = bitCount(closedMask & targetTypeMask);
        if (
          depth >= minimumOuterDepth &&
          remaining >= targetRemainingCount &&
'''
new = '''        const remaining = bitCount(closedMask & targetTypeMask);
        const targetSlotsPaired = targetSlotMask
          ? bitCount(pairedSlotMask(closedState) & targetSlotMask)
          : 0;
        if (
          depth >= minimumOuterDepth &&
          remaining >= targetRemainingCount &&
          (!targetSlotCount || targetSlotsPaired >= targetSlotCount) &&
'''
if old not in s:
    raise SystemExit('cycle collector goal anchor missing')
s = s.replace(old, new, 1)

old = '''          const score = bitCount(candidateMask & targetTypeMask) * 520
            + bitCount(candidateMask & lockedMask) * 360
            + bitCount(candidateMask) * 80
'''
new = '''          const targetSlotScore = targetSlotMask
            ? bitCount(pairedSlotMask(closedCandidate) & targetSlotMask) * 900
            : 0;
          const score = targetSlotScore
            + bitCount(candidateMask & targetTypeMask) * 520
            + bitCount(candidateMask & lockedMask) * 360
            + bitCount(candidateMask) * 80
'''
if old not in s:
    raise SystemExit('cycle collector score anchor missing')
s = s.replace(old, new, 1)

# First 3 is now a positional ML goal. Do not skip it merely because three
# unrelated pairs happened to exist elsewhere.
old = '''  let first3Candidates = initialRemainingCount >= 3
    ? [{ state, mask: pairedEdgeTypeMask(state), moves: [] }]
    : collectYauCycleGoals444(
        state,
        3,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        crossMask,
        7,
        6,
      );
'''
new = '''  const initialMiddlePaired = bitCount(pairedSlotMask(state) & sliceFamily.middleMask);
  let first3Candidates = initialMiddlePaired >= 3
    ? [{ state, mask: pairedEdgeTypeMask(state), moves: [] }]
    : collectYauCycleGoals444(
        state,
        0,
        sliceFamily,
        model,
        edgeStageDeadline,
        crossMask,
        crossMask,
        7,
        6,
        0,
        sliceFamily.middleMask,
        3,
      );
'''
if old not in s:
    raise SystemExit('First3 candidate block missing')
s = s.replace(old, new, 1)

# The second First-3 tier must use the same ML goal.
old = '''      7,
      6,
      shortestOuterDepth + 1,
    );
'''
new = '''      7,
      6,
      shortestOuterDepth + 1,
      sliceFamily.middleMask,
      3,
    );
'''
if old not in s:
    raise SystemExit('second First3 tier call tail missing')
s = s.replace(old, new, 1)

# Boundary condition for First3 should explicitly verify the physical middle
# storage pattern required by 3-2-3.
old = '''      if (!yauBoundaryOkay444(first.state, model, crossMask, 3)) continue;

      const next2Candidates = collectYauNextTwoCandidates444(
'''
new = '''      if (!yauBoundaryOkay444(first.state, model, crossMask)) continue;
      if (bitCount(pairedSlotMask(first.state) & sliceFamily.middleMask) < 3) continue;

      const next2Candidates = collectYauNextTwoCandidates444(
'''
if old not in s:
    raise SystemExit('First3 boundary anchor missing')
s = s.replace(old, new, 1)

old = '''    firstTier: chosenPipeline.tier,
    firstCandidates: chosenPipeline.firstCandidateCount,
'''
new = '''    firstTier: chosenPipeline.tier,
    firstMiddlePaired: bitCount(pairedSlotMask(chosenPipeline.first.state) & sliceFamily.middleMask),
    firstCandidates: chosenPipeline.firstCandidateCount,
'''
if old not in s:
    raise SystemExit('diagnostic first tier anchor missing')
s = s.replace(old, new, 1)

p.write_text(s)
print('modeled First 3 as three paired dedges stored in the physical middle layer')
