from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

# Rust edge invariant: a protected cross edge must stay paired AND physically
# attached to the face that carries the cross center.  Pairing somewhere else
# on the cube is not a Yau cross.
p = Path("solver444-wasm/src/edges.rs")
s = p.read_text()
anchor = '''pub(crate) fn paired_cross_edge_type_mask(
    state: &Cube444,
    cross_color: u8,
) -> Result<u16, EdgeSolveError> {
    let paired = paired_edge_type_mask(state)?;
    let mut cross_mask = 0u16;
    for (edge_type, colors) in EDGE_COLOR_PAIRS.iter().enumerate() {
        if colors.contains(&cross_color) {
            cross_mask |= 1u16 << edge_type;
        }
    }
    Ok(paired & cross_mask)
}
'''
insert = anchor + '''
/// Returns cross-color dedges that are visibly present as spokes around the
/// selected cross center.  Unlike `paired_cross_edge_type_mask`, this rejects
/// a pair that wandered to a non-cross slot while remaining internally paired.
pub(crate) fn cross_spoke_edge_type_mask(
    state: &Cube444,
    cross_color: u8,
) -> Result<u16, EdgeSolveError> {
    if cross_color >= 6 {
        return Err(EdgeSolveError::InvalidWingInventory);
    }
    let inventory = wing_inventory(state)?;
    let facelets = wing_facelets();
    let mut mask = 0u16;

    for (slot, &[first, second]) in EDGE_SLOTS.iter().enumerate() {
        // Only the four edge slots geometrically adjacent to the cross-center
        // face can count as visible Yau cross spokes.
        if !EDGE_COLOR_PAIRS[slot].contains(&cross_color) {
            continue;
        }
        let first_type = inventory.edge_type[first as usize];
        let second_type = inventory.edge_type[second as usize];
        if first_type == u8::MAX
            || first_type != second_type
            || !EDGE_COLOR_PAIRS[first_type as usize].contains(&cross_color)
            || inventory.orientation[first as usize] != inventory.orientation[second as usize]
        {
            continue;
        }

        // Both wings must actually show the selected cross color on the cross
        // face; a paired-but-flipped dedge is not a visible cross spoke.
        let cross_sticker_faces_cross = |wing: u8| {
            facelets[wing as usize].iter().any(|&facelet| {
                facelet / 16 == cross_color as usize && state.stickers()[facelet] == cross_color
            })
        };
        if cross_sticker_faces_cross(first) && cross_sticker_faces_cross(second) {
            mask |= 1u16 << first_type;
        }
    }
    Ok(mask)
}
'''
s = replace_once(s, anchor, insert, "cross-spoke helper")
p.write_text(s)

# The Yau remaining-center search must use the visual cross-spoke invariant at
# every node, not the weaker 'paired anywhere' invariant.
p = Path("solver444-wasm/src/centers.rs")
s = p.read_text()
s = s.replace(
    "use crate::edges::paired_cross_edge_type_mask;",
    "use crate::edges::cross_spoke_edge_type_mask;",
)
s = s.replace("paired_cross_edge_type_mask", "cross_spoke_edge_type_mask")
p.write_text(s)

# Keep the WASM boundary verification consistent with the solver itself.
p = Path("solver444-wasm/src/api.rs")
s = p.read_text()
s = s.replace(
    "crate::edges::paired_cross_edge_type_mask",
    "crate::edges::cross_spoke_edge_type_mask",
)
p.write_text(s)

# Permanent JS regression: replay every single move in Remaining 4 Centers and
# assert that all three protected cross dedges stay on the face carrying the
# cross center.  This catches the exact visual breakage reported in the UI.
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
    "Yau Cross 3/4 was not visibly attached to the cross center before remaining centers",
  );
  const remainingCenterTokens = String(setup.segments[3].solution || "").trim().split(/\\s+/).filter(Boolean);
  for (const token of remainingCenterTokens) {
    pattern = pattern.applyAlg(token);
    assert.equal(
      crossSpokePairedTypeMask(pattern, crossColor) & protectedCross3Mask,
      protectedCross3Mask,
      `Yau remaining centers broke the visible 3-cross after ${token}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
'''
s = replace_once(s, old, new, "per-move cross-spoke regression")
p.write_text(s)

print("Yau cross-spoke hard lock patch applied")
