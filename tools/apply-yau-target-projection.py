from pathlib import Path

path = Path('solver/edgePairing444.js')
s = path.read_text()

anchor = '''function searchTargetEdgeTypes444(
'''
helper = '''function targetEdgeProjectionKey444(state, targetTypeMask, includeCenters = false) {
  // Exact projection for frame probes: only the eight wings belonging to the
  // four target dedges influence whether those dedges can be paired and survive
  // the fixed remaining-center action.
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

old_sig = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
) {'''
new_sig = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
) {'''
if old_sig not in s:
    raise SystemExit('missing projected signature anchor')
s = s.replace(old_sig, new_sig, 1)

old_key = '''        const key = compactStateKey(nextState, centerAwareKey);'''
new_key = '''        const key = projectTargetState
          ? targetEdgeProjectionKey444(nextState, targetTypeMask, centerAwareKey)
          : compactStateKey(nextState, centerAwareKey);'''
if old_key not in s:
    raise SystemExit('missing target search key anchor')
s = s.replace(old_key, new_key, 1)

old_primary = '''    maxMacros,
    postAction,
  );'''
new_primary = '''    maxMacros,
    postAction,
    0,
    YAU_TARGET_BEAM_WIDTH,
    false,
    options?.projectTargetState === true,
  );'''
if old_primary not in s:
    raise SystemExit('missing primary target call anchor')
s = s.replace(old_primary, new_primary, 1)

old_rescue_tail = '''      YAU_TARGET_RESCUE_BEAM_WIDTH,
      true,
    );'''
new_rescue_tail = '''      YAU_TARGET_RESCUE_BEAM_WIDTH,
      true,
      false,
    );'''
if old_rescue_tail not in s:
    raise SystemExit('missing rescue target call anchor')
s = s.replace(old_rescue_tail, new_rescue_tail, 1)

path.write_text(s)
print('patched probe-only target-wing projection for Yau cross search')
