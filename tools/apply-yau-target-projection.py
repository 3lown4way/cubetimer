from pathlib import Path

path = Path('solver/edgePairing444.js')
s = path.read_text()

anchor = '''function searchTargetEdgeTypes444(
'''
helper = '''function targetEdgeProjectionKey444(state, targetTypeMask, includeCenters = false) {
  // Cross search only cares about the eight wing pieces belonging to the four
  // target dedges. Their future positions/orientations under a move are fully
  // determined by their own current positions/orientations; the identities of
  // the other sixteen wings are irrelevant. Collapsing on this exact
  // projection removes a huge amount of duplicate search work.
  const positionByPiece = new Uint8Array(24);
  for (let position = 0; position < 24; position += 1) {
    positionByPiece[state.edgePieces[position]] = position;
  }
  const values = [];
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (!(targetTypeMask & (1 << edgeType))) continue;
    const [firstPiece, secondPiece] = EDGE_SLOT_PAIRS_444[edgeType];
    const firstPosition = positionByPiece[firstPiece];
    const secondPosition = positionByPiece[secondPiece];
    values.push(
      firstPosition,
      state.edgeOrientation[firstPosition],
      secondPosition,
      state.edgeOrientation[secondPosition],
    );
  }
  if (includeCenters) values.push(...state.centerPieces, ...state.centerOrientation);
  return String.fromCharCode(...values);
}

function searchTargetEdgeTypes444(
'''
if anchor not in s:
    raise SystemExit('missing target search anchor')
s = s.replace(anchor, helper, 1)

old_key = '''        const key = compactStateKey(nextState, centerAwareKey);'''
new_key = '''        const key = targetEdgeProjectionKey444(nextState, targetTypeMask, centerAwareKey);'''
if old_key not in s:
    raise SystemExit('missing target search key anchor')
s = s.replace(old_key, new_key, 1)

old_score = '''        + targetPaired * 100000
        + bitCount(pairedMask) * 1000
        - node.path.length,'''
new_score = '''        + targetPaired * 100000
        - node.path.length,'''
if old_score not in s:
    raise SystemExit('missing target score anchor')
s = s.replace(old_score, new_score, 1)

path.write_text(s)
print('patched exact target-wing projection for Yau cross search')
