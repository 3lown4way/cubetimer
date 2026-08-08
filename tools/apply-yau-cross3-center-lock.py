from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Rust edge invariant for Yau centers.
#
# "Keep the 3-cross" means the same three selected cross dedges stay paired
# in three of the four edge slots touching the selected cross-center face.
# Their order around that face may rotate/permutate; they are NOT frozen to
# their final color-home slots during center work.
# ---------------------------------------------------------------------------
p = Path("solver444-wasm/src/edges.rs")
s = p.read_text()
old = '''pub(crate) fn paired_cross_edge_type_mask(
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
}'''
new = '''pub(crate) fn paired_cross_edge_type_mask(
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
}'''
s = replace_once(s, old, new, "cross-face parked dedge invariant")
p.write_text(s)


# ---------------------------------------------------------------------------
# Rust Yau center search. The existing search already calls preserves_cross()
# after EVERY atomic center move. With the strengthened edge helper above,
# that predicate now means the same three dedges remain paired around the
# cross-center face, while allowing them to rotate among its four slots.
# ---------------------------------------------------------------------------
p = Path("solver444-wasm/src/centers.rs")
s = p.read_text()
s = replace_once(
    s,
    '''    if protected_cross_mask.count_ones() < 3 {
        return Err(CenterSolveError::CoordinateNotReachable("yau-cross3"));
    }''',
    '''    if protected_cross_mask.count_ones() != 3 {
        return Err(CenterSolveError::CoordinateNotReachable(
            "yau-cross3-cross-face",
        ));
    }''',
    "require exactly three parked cross dedges",
)
p.write_text(s)


# ---------------------------------------------------------------------------
# WASM boundary independently replays the returned remaining-center solution
# move by move. A result is accepted only if those same three cross dedges are
# still parked around the cross center after every atomic move.
# ---------------------------------------------------------------------------
p = Path("solver444-wasm/src/api.rs")
s = p.read_text()
s = replace_once(
    s,
    '''    protected_cross_pair_count: u32,
    phase_move_counts: [usize; 4],''',
    '''    protected_cross_pair_count: u32,
    cross_locked_every_move: bool,
    phase_move_counts: [usize; 4],''',
    "Yau response cross lock field",
)
s = replace_once(
    s,
    '''        r#"{\"ok\":false,\"status\":\"error\",\"reason\":\"444_YAU_CENTER_SERIALIZATION_FAILED\",\"solution\":\"\",\"moveCount\":0,\"verified\":false,\"protectedCrossPairCount\":0,\"phaseMoveCounts\":[0,0,0,0],\"tableBuildMs\":0,\"searchMs\":0}"#.to_string()''',
    '''        r#"{\"ok\":false,\"status\":\"error\",\"reason\":\"444_YAU_CENTER_SERIALIZATION_FAILED\",\"solution\":\"\",\"moveCount\":0,\"verified\":false,\"protectedCrossPairCount\":0,\"crossLockedEveryMove\":false,\"phaseMoveCounts\":[0,0,0,0],\"tableBuildMs\":0,\"searchMs\":0}"#.to_string()''',
    "Yau serialization fallback",
)
s = replace_once(
    s,
    '''        protected_cross_pair_count: protected_count,
        phase_move_counts: [0; 4],''',
    '''        protected_cross_pair_count: protected_count,
        cross_locked_every_move: false,
        phase_move_counts: [0; 4],''',
    "Yau error cross lock field",
)
old_verify = '''    let mut verified_state = state;
    verified_state.apply_moves(&result.moves);
    let protected_after =
        crate::edges::paired_cross_edge_type_mask(&verified_state, cross_color).unwrap_or(0);
    let verified = verified_state.centers_solved()
        && verified_state.validate().is_ok()
        && protected_after & protected_before == protected_before;
    if !verified {
        return yau_remaining_error(
            "error",
            "444_YAU_CENTER_VERIFICATION_FAILED".to_string(),
            protected_count,
        );
    }
    serialize_yau_remaining(&YauRemainingCentersResponse {
        ok: true,
        status: "ok",
        reason: None,
        solution: format_moves(&result.moves),
        move_count: result.moves.len(),
        verified: true,
        protected_cross_pair_count: protected_count,
        phase_move_counts: result.phase_move_counts,
        table_build_ms: result.table_build_ms,
        search_ms: result.search_ms,
    })'''
new_verify = '''    let mut verified_state = state;
    let mut cross_locked_every_move = protected_count == 3;
    for mv in &result.moves {
        verified_state.apply_move(*mv);
        let protected_step =
            crate::edges::paired_cross_edge_type_mask(&verified_state, cross_color).unwrap_or(0);
        if protected_step & protected_before != protected_before {
            cross_locked_every_move = false;
            break;
        }
    }
    let protected_after =
        crate::edges::paired_cross_edge_type_mask(&verified_state, cross_color).unwrap_or(0);
    let verified = cross_locked_every_move
        && verified_state.centers_solved()
        && verified_state.validate().is_ok()
        && protected_after & protected_before == protected_before;
    if !verified {
        return yau_remaining_error(
            "error",
            "444_YAU_CENTER_CROSS_FACE_LOCK_FAILED".to_string(),
            protected_count,
        );
    }
    serialize_yau_remaining(&YauRemainingCentersResponse {
        ok: true,
        status: "ok",
        reason: None,
        solution: format_moves(&result.moves),
        move_count: result.moves.len(),
        verified: true,
        protected_cross_pair_count: protected_count,
        cross_locked_every_move,
        phase_move_counts: result.phase_move_counts,
        table_build_ms: result.table_build_ms,
        search_ms: result.search_ms,
    })'''
s = replace_once(s, old_verify, new_verify, "Yau per-move cross-face verification")
p.write_text(s)


# ---------------------------------------------------------------------------
# JS orchestration requires the WASM hard-lock proof and exposes it publicly.
# ---------------------------------------------------------------------------
p = Path("solver/solver444.js")
s = p.read_text()
s = replace_once(
    s,
    '''  let protectedCenterSearchMs = 0;''',
    '''  let protectedCenterSearchMs = 0;
  let remainingCentersCrossLockedEveryMove = false;''',
    "Yau cross lock state",
)
s = replace_once(
    s,
    '''      if (protectedResult?.ok === true && protectedResult?.verified === true) {''',
    '''      if (
        protectedResult?.ok === true &&
        protectedResult?.verified === true &&
        protectedResult?.crossLockedEveryMove === true &&
        Number(protectedResult?.protectedCrossPairCount) === 3
      ) {''',
    "require Yau per-move cross lock",
)
s = replace_once(
    s,
    '''          protectedCenterSearchMs = Number(protectedResult.searchMs) || 0;''',
    '''          protectedCenterSearchMs = Number(protectedResult.searchMs) || 0;
          remainingCentersCrossLockedEveryMove = true;''',
    "record Yau cross lock",
)
s = replace_once(
    s,
    '''    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", effectiveRemainingCenters, {
      recomputedAfterCross3: remainingCentersRecomputed,
    }),''',
    '''    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", effectiveRemainingCenters, {
      recomputedAfterCross3: remainingCentersRecomputed,
      crossLockedEveryMove: remainingCentersCrossLockedEveryMove,
    }),''',
    "Yau remaining centers segment diagnostic",
)
s = replace_once(
    s,
    '''      yauProtectedCenterSearchMs: protectedCenterSearchMs,''',
    '''      yauProtectedCenterSearchMs: protectedCenterSearchMs,
      yauRemainingCentersCrossLockedEveryMove: remainingCentersCrossLockedEveryMove,''',
    "Yau cross lock meta",
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Permanent regression: replay Remaining 4 Centers token-by-token in the
# displayed human viewpoint. The same three selected cross dedges must stay
# paired in the four edge slots adjacent to wherever the cross center is now.
# ---------------------------------------------------------------------------
p = Path("tools/verify-444-yau.mjs")
s = p.read_text()
s = replace_once(
    s,
    '''function centerColorGroupedSomewhere(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  return FACES.some((face) => CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
  ));
}

function allCentersGrouped(pattern) {''',
    '''function centerColorGroupedSomewhere(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  return FACES.some((face) => CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
  ));
}

function centerFaceForColor(pattern, color) {
  const centers = pattern.patternData.CENTERS;
  return FACES.find((face) => CENTER_POSITIONS_BY_FACE[face].every(
    (position) => CENTER_FACE_BY_PIECE.get(Number(centers.pieces[position])) === color,
  )) || null;
}

function pairedCrossTypesAdjacentToCenter(pattern, crossColor) {
  const crossFace = centerFaceForColor(pattern, crossColor);
  if (!crossFace) return 0;
  const edges = pattern.patternData.EDGES;
  let mask = 0;
  for (let slot = 0; slot < EDGE_SLOT_PAIRS.length; slot += 1) {
    const slotFacePair = EDGE_NAMES_333[EDGE_SLOT_TO_333[slot]];
    if (!slotFacePair.includes(crossFace)) continue;
    const [a, b] = EDGE_SLOT_PAIRS[slot];
    const ta = EDGE_TYPE_BY_WING[Number(edges.pieces[a])];
    const tb = EDGE_TYPE_BY_WING[Number(edges.pieces[b])];
    if (
      ta !== 255 && ta === tb &&
      (crossTypeMask(crossColor) & (1 << ta)) !== 0 &&
      Number(edges.orientation[a]) === Number(edges.orientation[b])
    ) {
      mask |= 1 << ta;
    }
  }
  return mask;
}

function allCentersGrouped(pattern) {''',
    "rotation-aware displayed cross checker",
)
s = replace_once(
    s,
    '''    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);''',
    '''    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);
    assert.equal(result.meta.yauRemainingCentersCrossLockedEveryMove, true);''',
    "meta per-move lock assertion",
)
s = replace_once(
    s,
    '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");
  pattern = setup.segments[3].solution ? pattern.applyAlg(setup.segments[3].solution) : pattern;
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");''',
    '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");
  const displayedCross3Mask = pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask;
  assert.equal(bitCount(displayedCross3Mask), 3, "displayed Yau Cross 3/4 is not attached to the cross center");
  assert.equal(setup.segments[3].crossLockedEveryMove, true);
  const remainingCenterTokens = String(setup.segments[3].solution || "").trim().split(/\\s+/).filter(Boolean);
  for (const token of remainingCenterTokens) {
    pattern = pattern.applyAlg(token);
    assert.equal(
      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & displayedCross3Mask,
      displayedCross3Mask,
      `Yau remaining centers broke the 3-cross after move ${token}`,
    );
  }
  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");''',
    "per-displayed-move cross lock assertion",
)
p.write_text(s)

print("Yau remaining-center cross-face 3-cross lock patch applied")
