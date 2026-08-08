from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Strengthen the existing Yau cross mask. It already requires the pair to sit
# in one of the four slots adjacent to the selected cross-center face, but it
# still accepted a paired/flipped dedge whose cross-color stickers faced away
# from the cross center. That looks like the 3-cross being broken in replay.
p = Path("solver444-wasm/src/edges.rs")
s = p.read_text()
old = '''pub(crate) fn paired_cross_edge_type_mask(
    state: &Cube444,
    cross_color: u8,
) -> Result<u16, EdgeSolveError> {
    // Keep paired_edge_type_mask in the contract as an independent inventory
    // check, then additionally require the pair to occupy one of the four
    // physical edge slots adjacent to the selected cross-center face.
    let paired_anywhere = paired_edge_type_mask(state)?;
    let inventory = wing_inventory(state)?;
    let mut parked_on_cross_face = 0u16;

    for (slot, &[first, second]) in EDGE_SLOTS.iter().enumerate() {
        if !EDGE_COLOR_PAIRS[slot].contains(&cross_color) {
            continue;
        }
        let first_type = inventory.edge_type[first as usize];
        let second_type = inventory.edge_type[second as usize];
        if first_type == u8::MAX
            || first_type != second_type
            || inventory.orientation[first as usize] != inventory.orientation[second as usize]
        {
            continue;
        }
        if EDGE_COLOR_PAIRS[first_type as usize].contains(&cross_color) {
            parked_on_cross_face |= 1u16 << first_type;
        }
    }

    Ok(parked_on_cross_face & paired_anywhere)
}
'''
new = '''pub(crate) fn paired_cross_edge_type_mask(
    state: &Cube444,
    cross_color: u8,
) -> Result<u16, EdgeSolveError> {
    if cross_color >= 6 {
        return Err(EdgeSolveError::InvalidWingInventory);
    }
    // A Yau cross edge must satisfy all three conditions simultaneously:
    // 1) its two wings are paired,
    // 2) that pair occupies one of the four slots around the cross center,
    // 3) the selected cross-color sticker on BOTH wings actually faces the
    //    cross-center face. A paired-but-flipped dedge is not a visible spoke.
    let paired_anywhere = paired_edge_type_mask(state)?;
    let inventory = wing_inventory(state)?;
    let facelets = wing_facelets();
    let mut visible_cross_spokes = 0u16;

    for (slot, &[first, second]) in EDGE_SLOTS.iter().enumerate() {
        if !EDGE_COLOR_PAIRS[slot].contains(&cross_color) {
            continue;
        }
        let first_type = inventory.edge_type[first as usize];
        let second_type = inventory.edge_type[second as usize];
        if first_type == u8::MAX
            || first_type != second_type
            || inventory.orientation[first as usize] != inventory.orientation[second as usize]
            || !EDGE_COLOR_PAIRS[first_type as usize].contains(&cross_color)
        {
            continue;
        }

        let cross_sticker_faces_cross = |wing: u8| {
            facelets[wing as usize].iter().any(|&facelet| {
                facelet / 16 == cross_color as usize && state.stickers()[facelet] == cross_color
            })
        };
        if cross_sticker_faces_cross(first) && cross_sticker_faces_cross(second) {
            visible_cross_spokes |= 1u16 << first_type;
        }
    }

    Ok(visible_cross_spokes & paired_anywhere)
}
'''
s = replace_once(s, old, new, "visible cross-spoke invariant")
p.write_text(s)

# Permanent JS regression: replay every single move in Remaining 4 Centers and
# assert that the same three protected cross dedges remain in slots adjacent to
# the face currently carrying the cross center. This is deliberately per-move,
# not merely a start/end check.
p = Path("tools/verify-444-yau.mjs")
s = p.read_text()
helper_anchor = '''function pairedTypeMask(pattern) {
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (const [a, b] of EDGE_SLOT_PAIRS) {
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (ta !== 255 && ta === tb && Number(edges.orientation[a]) === Number(edges.orientation[b])) {
      mask |= 1 << ta;
    }
  }
  return mask;
}
'''
helper_insert = helper_anchor + '''
function faceHoldingCenterColor(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  for (const face of FACES) {
    if (CENTER_POSITIONS_BY_FACE[face].every(
      (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
    )) return face;
  }
  return null;
}

function crossSpokePairedTypeMask(pattern, crossColor) {
  const crossFace = faceHoldingCenterColor(pattern, crossColor);
  if (!crossFace) return 0;
  const edges = pattern.patternData.EDGES;
  const targetMask = crossTypeMask(crossColor);
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    const cubieName = EDGE_NAMES_333[EDGE_SLOT_TO_333[slot]];
    if (!cubieName.includes(crossFace)) continue;
    const [a, b] = EDGE_SLOT_PAIRS[slot];
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (
      ta !== 255 && ta === tb &&
      (targetMask & (1 << ta)) !== 0 &&
      Number(edges.orientation[a]) === Number(edges.orientation[b])
    ) mask |= 1 << ta;
  }
  return mask;
}
'''
s = replace_once(s, helper_anchor, helper_insert, "JS cross-spoke helper")
old = '''  pattern = setup.segments[3].solution ? pattern.applyAlg(setup.segments[3].solution) : pattern;
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
'''
new = '''  const protectedCross3Mask = cross3Mask;
  assert.equal(
    crossSpokePairedTypeMask(pattern, crossColor) & protectedCross3Mask,
    protectedCross3Mask,
    "Yau Cross 3/4 was not attached to the cross center before remaining centers",
  );
  const remainingCenterTokens = String(setup.segments[3].solution || "").trim().split(/\\s+/).filter(Boolean);
  for (const token of remainingCenterTokens) {
    pattern = pattern.applyAlg(token);
    assert.equal(
      crossSpokePairedTypeMask(pattern, crossColor) & protectedCross3Mask,
      protectedCross3Mask,
      `Yau remaining centers broke the 3-cross after ${token}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
'''
s = replace_once(s, old, new, "per-move cross-spoke regression")
p.write_text(s)

print("Yau visible cross-spoke hard lock patch applied")
