from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Rust edge helpers: distinguish "paired somewhere" from "paired in its home
# cross slot".  Yau remaining-center work must keep the first three cross
# dedges attached to the cross center, not merely re-pair them later.
# ---------------------------------------------------------------------------
p = Path("solver444-wasm/src/edges.rs")
s = p.read_text()
anchor = '''fn edge_home_paired(inventory: &WingInventory, edge_type: usize) -> bool {
    let [first, second] = EDGE_SLOTS[edge_type];
    inventory.edge_type[first as usize] == edge_type as u8
        && inventory.edge_type[second as usize] == edge_type as u8
        && inventory.orientation[first as usize] == inventory.orientation[second as usize]
}

pub(crate) fn paired_edge_type_mask(state: &Cube444) -> Result<u16, EdgeSolveError> {'''
replacement = '''fn edge_home_paired(inventory: &WingInventory, edge_type: usize) -> bool {
    let [first, second] = EDGE_SLOTS[edge_type];
    inventory.edge_type[first as usize] == edge_type as u8
        && inventory.edge_type[second as usize] == edge_type as u8
        && inventory.orientation[first as usize] == inventory.orientation[second as usize]
}

pub(crate) fn home_paired_edge_type_mask(state: &Cube444) -> Result<u16, EdgeSolveError> {
    let inventory = wing_inventory(state)?;
    let mut mask = 0u16;
    for edge_type in 0..EDGE_TYPE_COUNT {
        if edge_home_paired(&inventory, edge_type) {
            mask |= 1u16 << edge_type;
        }
    }
    Ok(mask)
}

pub(crate) fn home_paired_cross_edge_type_mask(
    state: &Cube444,
    cross_color: u8,
) -> Result<u16, EdgeSolveError> {
    let home_paired = home_paired_edge_type_mask(state)?;
    let mut cross_mask = 0u16;
    for (edge_type, colors) in EDGE_COLOR_PAIRS.iter().enumerate() {
        if colors.contains(&cross_color) {
            cross_mask |= 1u16 << edge_type;
        }
    }
    Ok(home_paired & cross_mask)
}

pub(crate) fn paired_edge_type_mask(state: &Cube444) -> Result<u16, EdgeSolveError> {'''
s = replace_once(s, anchor, replacement, "home-paired edge helpers")
p.write_text(s)


# ---------------------------------------------------------------------------
# Rust Yau center search: hard-lock the three home cross slots after EVERY
# atomic center move.  The previous predicate only required the dedges to stay
# paired somewhere on the cube, which is not a human Yau 3-cross invariant.
# ---------------------------------------------------------------------------
p = Path("solver444-wasm/src/centers.rs")
s = p.read_text()
s = replace_once(
    s,
    'use crate::edges::paired_cross_edge_type_mask;',
    'use crate::edges::home_paired_cross_edge_type_mask;',
    "center edge import",
)
s = replace_once(
    s,
    '''        paired_cross_edge_type_mask(state, self.cross_color)
            .map(|mask| mask & self.protected_cross_mask == self.protected_cross_mask)
            .unwrap_or(false)''',
    '''        home_paired_cross_edge_type_mask(state, self.cross_color)
            .map(|mask| mask & self.protected_cross_mask == self.protected_cross_mask)
            .unwrap_or(false)''',
    "per-move Yau cross predicate",
)
s = replace_once(
    s,
    '''    let protected_cross_mask = paired_cross_edge_type_mask(state, cross_color)
        .map_err(|_| CenterSolveError::CoordinateNotReachable("yau-cross-wings"))?;
    if protected_cross_mask.count_ones() < 3 {
        return Err(CenterSolveError::CoordinateNotReachable("yau-cross3"));
    }''',
    '''    let protected_cross_mask = home_paired_cross_edge_type_mask(state, cross_color)
        .map_err(|_| CenterSolveError::CoordinateNotReachable("yau-cross-wings"))?;
    if protected_cross_mask.count_ones() != 3 {
        return Err(CenterSolveError::CoordinateNotReachable("yau-cross3-home-slots"));
    }''',
    "initial Yau cross hard lock",
)
s = replace_once(
    s,
    '''            let protected_after = paired_cross_edge_type_mask(&working, cross_color)
                .map_err(|_| CenterSolveError::VerificationFailed)?;''',
    '''            let protected_after = home_paired_cross_edge_type_mask(&working, cross_color)
                .map_err(|_| CenterSolveError::VerificationFailed)?;''',
    "final Yau cross hard lock",
)
p.write_text(s)


# ---------------------------------------------------------------------------
# WASM boundary: independently replay the remaining-center solution one move at
# a time and fail if any move ejects one of the three cross dedges from its
# home cross slot.  This guards against future search regressions.
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
s = replace_once(
    s,
    '''    let protected_before =
        crate::edges::paired_cross_edge_type_mask(&state, cross_color).unwrap_or(0);''',
    '''    let protected_before =
        crate::edges::home_paired_cross_edge_type_mask(&state, cross_color).unwrap_or(0);''',
    "Yau initial home cross mask",
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
        let protected_step = crate::edges::home_paired_cross_edge_type_mask(
            &verified_state,
            cross_color,
        )
        .unwrap_or(0);
        if protected_step & protected_before != protected_before {
            cross_locked_every_move = false;
            break;
        }
    }
    let protected_after = crate::edges::home_paired_cross_edge_type_mask(
        &verified_state,
        cross_color,
    )
    .unwrap_or(0);
    let verified = cross_locked_every_move
        && verified_state.centers_solved()
        && verified_state.validate().is_ok()
        && protected_after & protected_before == protected_before;
    if !verified {
        return yau_remaining_error(
            "error",
            "444_YAU_CENTER_CROSS_LOCK_VERIFICATION_FAILED".to_string(),
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
s = replace_once(s, old_verify, new_verify, "Yau per-move boundary verification")
p.write_text(s)


# ---------------------------------------------------------------------------
# JS orchestrator: require the new hard-lock boundary contract and surface it
# in the stage/meta diagnostics.
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
# Permanent JS regression: during every displayed Remaining 4 Centers token,
# the same three cross dedges must remain paired AND adjacent to the currently
# displayed cross center. This directly catches the visual breakage reported.
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
    const cubieName = EDGE_NAMES_333[EDGE_SLOT_TO_333[slot]];
    if (!cubieName.includes(crossFace)) continue;
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
    "per-display-move cross lock assertion",
)
p.write_text(s)

print("Yau remaining-center 3-cross hard lock patch applied")
