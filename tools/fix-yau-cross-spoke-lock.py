from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)

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
    // A Yau cross spoke is stricter than a paired dedge near the cross center:
    // both wing stickers of the selected cross color must actually face the
    // cross-center face. This prevents the remaining-center search from
    // accepting a paired-but-flipped edge as if the visible 3-cross survived.
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
s = replace_once(s, old, new, "visible cross-spoke sticker invariant")
p.write_text(s)
print("Yau visible cross-spoke sticker lock applied")
