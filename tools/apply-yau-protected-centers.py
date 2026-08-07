from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


# --- Rust edge helpers -----------------------------------------------------
p = Path("solver444-wasm/src/edges.rs")
s = p.read_text()
anchor = '''fn edge_home_paired(inventory: &WingInventory, edge_type: usize) -> bool {
    let [first, second] = EDGE_SLOTS[edge_type];
    inventory.edge_type[first as usize] == edge_type as u8
        && inventory.edge_type[second as usize] == edge_type as u8
        && inventory.orientation[first as usize] == inventory.orientation[second as usize]
}
'''
insert = anchor + '''
pub(crate) fn paired_edge_type_mask(state: &Cube444) -> Result<u16, EdgeSolveError> {
    let inventory = wing_inventory(state)?;
    let mut mask = 0u16;
    for &[first, second] in &EDGE_SLOTS {
        let first_type = inventory.edge_type[first as usize];
        let second_type = inventory.edge_type[second as usize];
        if first_type == second_type
            && first_type != u8::MAX
            && inventory.orientation[first as usize] == inventory.orientation[second as usize]
        {
            mask |= 1u16 << first_type;
        }
    }
    Ok(mask)
}

pub(crate) fn paired_cross_edge_type_mask(
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
s = replace_once(s, anchor, insert, "edge mask helpers")
p.write_text(s)


# --- Rust Yau remaining-center search ------------------------------------
p = Path("solver444-wasm/src/centers.rs")
s = p.read_text()
s = replace_once(
    s,
    'use crate::geometry::{move_permutation, sticker_geometry, FACELET_COUNT};\nuse crate::{Cube444, Move444};',
    'use crate::edges::paired_cross_edge_type_mask;\nuse crate::geometry::{move_permutation, sticker_geometry, FACELET_COUNT};\nuse crate::{Cube444, Move444};',
    "center imports",
)
marker = '''#[cfg(test)]
mod tests {'''
code = r'''const YAU_CENTER_PHASE3_EXTRA_DEPTH: u8 = 6;
const YAU_CENTER_PHASE4_EXTRA_DEPTH: u8 = 6;

struct YauCenterSearch<'a> {
    tables: &'a CenterTables,
    cross_color: u8,
    protected_cross_mask: u16,
    deadline_ts: f64,
    nodes: usize,
}

impl YauCenterSearch<'_> {
    fn tick(&mut self) -> Result<(), CenterSolveError> {
        self.nodes += 1;
        if self.nodes & 0x03ff == 0 {
            check_deadline(self.deadline_ts)?;
        }
        Ok(())
    }

    fn preserves_cross(&self, state: &Cube444) -> bool {
        paired_cross_edge_type_mask(state, self.cross_color)
            .map(|mask| mask & self.protected_cross_mask == self.protected_cross_mask)
            .unwrap_or(false)
    }

    fn phase3_distance(&self, state: &Cube444) -> Result<u8, CenterSolveError> {
        let frame = &self.tables.frame;
        let mask = center_color_mask(state, &[frame.side_a_color, frame.side_a_opposite_color]);
        let rank = coordinate_rank(mask, &frame.side_positions, 8);
        let distance = self.tables.phase3_distance[rank];
        if distance == UNVISITED {
            Err(CenterSolveError::CoordinateNotReachable("yau-phase3"))
        } else {
            Ok(distance)
        }
    }

    fn phase4_distance(&self, state: &Cube444) -> Result<u8, CenterSolveError> {
        let frame = &self.tables.frame;
        let first = center_color_mask(state, &[frame.side_a_color]);
        let second = center_color_mask(state, &[frame.side_b_color]);
        let rank = coordinate_rank(first, &frame.side_a_pair_positions, 4) * PAIR_FACE_STATE_COUNT
            + coordinate_rank(second, &frame.side_b_pair_positions, 4);
        let distance = self.tables.phase4_distance[rank];
        if distance == UNVISITED {
            Err(CenterSolveError::CoordinateNotReachable("yau-phase4"))
        } else {
            Ok(distance)
        }
    }

    fn same_layer(previous: Option<Move444>, mv: Move444) -> bool {
        previous
            .map(|last| last.face() == mv.face() && last.is_wide() == mv.is_wide())
            .unwrap_or(false)
    }

    fn dfs_phase4(
        &mut self,
        state: &mut Cube444,
        path: &mut Vec<Move444>,
        remaining: u8,
        previous: Option<Move444>,
    ) -> Result<bool, CenterSolveError> {
        self.tick()?;
        let distance = self.phase4_distance(state)?;
        if distance > remaining {
            return Ok(false);
        }
        if distance == 0 {
            return Ok(state.centers_solved() && self.preserves_cross(state));
        }
        if remaining == 0 {
            return Ok(false);
        }

        let mut candidates = Vec::with_capacity(self.tables.phase4_moves.len());
        for index in 0..self.tables.phase4_moves.len() {
            let mv = self.tables.phase4_moves[index].mv;
            if Self::same_layer(previous, mv) {
                continue;
            }
            state.apply_move(mv);
            if self.preserves_cross(state) {
                let next_distance = self.phase4_distance(state)?;
                if next_distance <= remaining - 1 {
                    candidates.push((next_distance, mv));
                }
            }
            state.apply_move(mv.inverse());
        }
        candidates.sort_unstable_by_key(|&(distance, mv)| (distance, mv));

        for (_, mv) in candidates {
            state.apply_move(mv);
            path.push(mv);
            if self.dfs_phase4(state, path, remaining - 1, Some(mv))? {
                return Ok(true);
            }
            path.pop();
            state.apply_move(mv.inverse());
        }
        Ok(false)
    }

    fn search_phase4(
        &mut self,
        state: &mut Cube444,
    ) -> Result<Option<Vec<Move444>>, CenterSolveError> {
        let initial = self.phase4_distance(state)?;
        let max_bound = initial.saturating_add(YAU_CENTER_PHASE4_EXTRA_DEPTH);
        for bound in initial..=max_bound {
            check_deadline(self.deadline_ts)?;
            let mut path = Vec::with_capacity(bound as usize);
            if self.dfs_phase4(state, &mut path, bound, None)? {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    fn dfs_phase3(
        &mut self,
        state: &mut Cube444,
        path: &mut Vec<Move444>,
        remaining: u8,
        previous: Option<Move444>,
    ) -> Result<Option<usize>, CenterSolveError> {
        self.tick()?;
        let distance = self.phase3_distance(state)?;
        if distance > remaining {
            return Ok(None);
        }
        if distance == 0 {
            if let Some(phase4) = self.search_phase4(state)? {
                let phase3_len = path.len();
                path.extend(phase4);
                return Ok(Some(phase3_len));
            }
        }
        if remaining == 0 {
            return Ok(None);
        }

        let mut candidates = Vec::with_capacity(self.tables.phase3_moves.len());
        for index in 0..self.tables.phase3_moves.len() {
            let mv = self.tables.phase3_moves[index].mv;
            if Self::same_layer(previous, mv) {
                continue;
            }
            state.apply_move(mv);
            if self.preserves_cross(state) {
                let next_distance = self.phase3_distance(state)?;
                if next_distance <= remaining - 1 {
                    candidates.push((next_distance, mv));
                }
            }
            state.apply_move(mv.inverse());
        }
        candidates.sort_unstable_by_key(|&(distance, mv)| (distance, mv));

        for (_, mv) in candidates {
            state.apply_move(mv);
            path.push(mv);
            if let Some(phase3_len) = self.dfs_phase3(state, path, remaining - 1, Some(mv))? {
                return Ok(Some(phase3_len));
            }
            path.pop();
            state.apply_move(mv.inverse());
        }
        Ok(None)
    }
}

pub fn solve_remaining_centers_for_yau(
    state: &Cube444,
    deadline_ts: f64,
    cross_color: u8,
) -> Result<CenterSolveResult, CenterSolveError> {
    check_deadline(deadline_ts)?;
    let tables_were_ready = cross_color < 6 && CENTER_TABLES[cross_color as usize].get().is_some();
    let tables = get_tables(cross_color, deadline_ts)?;
    let frame = &tables.frame;

    if center_color_mask(state, &[frame.cross_color]) != frame.goal_cross
        || center_color_mask(state, &[frame.opposite_color]) != frame.goal_opposite
    {
        return Err(CenterSolveError::CoordinateNotReachable("yau-first-two-centers"));
    }

    let protected_cross_mask = paired_cross_edge_type_mask(state, cross_color)
        .map_err(|_| CenterSolveError::CoordinateNotReachable("yau-cross-wings"))?;
    if protected_cross_mask.count_ones() < 3 {
        return Err(CenterSolveError::CoordinateNotReachable("yau-cross3"));
    }

    let search_started = now_ms();
    let initial_distance = {
        let mask = center_color_mask(state, &[frame.side_a_color, frame.side_a_opposite_color]);
        let rank = coordinate_rank(mask, &frame.side_positions, 8);
        tables.phase3_distance[rank]
    };
    if initial_distance == UNVISITED {
        return Err(CenterSolveError::CoordinateNotReachable("yau-phase3"));
    }

    let max_bound = initial_distance.saturating_add(YAU_CENTER_PHASE3_EXTRA_DEPTH);
    for bound in initial_distance..=max_bound {
        check_deadline(deadline_ts)?;
        let mut working = state.clone();
        let mut path = Vec::with_capacity((bound as usize) + 12);
        let mut search = YauCenterSearch {
            tables,
            cross_color,
            protected_cross_mask,
            deadline_ts,
            nodes: 0,
        };
        if let Some(phase3_len) = search.dfs_phase3(&mut working, &mut path, bound, None)? {
            check_deadline(deadline_ts)?;
            let protected_after = paired_cross_edge_type_mask(&working, cross_color)
                .map_err(|_| CenterSolveError::VerificationFailed)?;
            if !working.centers_solved()
                || protected_after & protected_cross_mask != protected_cross_mask
                || working.validate().is_err()
            {
                return Err(CenterSolveError::VerificationFailed);
            }
            let phase4_len = path.len() - phase3_len;
            return Ok(CenterSolveResult {
                moves: path,
                phase_move_counts: [0, 0, phase3_len, phase4_len],
                table_build_ms: if tables_were_ready { 0.0 } else { tables.build_ms },
                search_ms: (now_ms() - search_started).max(0.0),
            });
        }
    }

    Err(CenterSolveError::NoDescendingMove("yau-remaining-centers"))
}

'''
s = replace_once(s, marker, code + marker, "Yau center search insertion")
p.write_text(s)


# --- WASM API -------------------------------------------------------------
p = Path("solver444-wasm/src/api.rs")
s = p.read_text()
s = replace_once(
    s,
    '''    normalize_parity, parse_alg444, solve_centers_for_cross, solve_edges, CenterSolveError,
    Cube444, EdgeSolveError, ReductionError, Virtual333State,''',
    '''    normalize_parity, parse_alg444, solve_centers_for_cross, solve_edges,
    solve_remaining_centers_for_yau, CenterSolveError, Cube444, EdgeSolveError, ReductionError,
    Virtual333State,''',
    "API imports",
)
marker = '''#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Verify444Request {'''
code = r'''#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct YauRemainingCentersResponse {
    ok: bool,
    status: &'static str,
    reason: Option<String>,
    solution: String,
    move_count: usize,
    verified: bool,
    protected_cross_pair_count: u32,
    phase_move_counts: [usize; 4],
    table_build_ms: f64,
    search_ms: f64,
}

fn serialize_yau_remaining(value: &YauRemainingCentersResponse) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| {
        r#"{"ok":false,"status":"error","reason":"444_YAU_CENTER_SERIALIZATION_FAILED","solution":"","moveCount":0,"verified":false,"protectedCrossPairCount":0,"phaseMoveCounts":[0,0,0,0],"tableBuildMs":0,"searchMs":0}"#.to_string()
    })
}

fn yau_remaining_error(status: &'static str, reason: String, protected_count: u32) -> String {
    serialize_yau_remaining(&YauRemainingCentersResponse {
        ok: false,
        status,
        reason: Some(reason),
        solution: String::new(),
        move_count: 0,
        verified: false,
        protected_cross_pair_count: protected_count,
        phase_move_counts: [0; 4],
        table_build_ms: 0.0,
        search_ms: 0.0,
    })
}

pub fn solve_444_yau_remaining_centers_boundary(request_json: &str) -> String {
    let request: Solve444Request = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(error) => {
            return yau_remaining_error(
                "invalid",
                format!("444_YAU_CENTER_INVALID_REQUEST:{error}"),
                0,
            );
        }
    };
    if deadline_reached(request.deadline_ts) {
        return yau_remaining_error("timeout", "444_DEADLINE_REACHED".to_string(), 0);
    }
    let moves = match parse_alg444(&request.scramble) {
        Ok(moves) => moves,
        Err(error) => {
            return yau_remaining_error(
                "invalid",
                format!("444_YAU_CENTER_INVALID_SCRAMBLE:{error}"),
                0,
            );
        }
    };
    let cross_color = match parse_cross_color(&request.cross_color) {
        Some(color) => color,
        None => {
            return yau_remaining_error(
                "invalid",
                "444_YAU_CENTER_INVALID_CROSS_COLOR".to_string(),
                0,
            );
        }
    };
    let mut state = Cube444::solved();
    state.apply_moves(&moves);
    if state.validate().is_err() {
        return yau_remaining_error(
            "invalid",
            "444_YAU_CENTER_STATE_INVALID".to_string(),
            0,
        );
    }
    let protected_before = crate::edges::paired_cross_edge_type_mask(&state, cross_color)
        .unwrap_or(0);
    let protected_count = protected_before.count_ones();
    let result = match solve_remaining_centers_for_yau(&state, request.deadline_ts, cross_color) {
        Ok(result) => result,
        Err(CenterSolveError::DeadlineReached) => {
            return yau_remaining_error(
                "timeout",
                "444_DEADLINE_REACHED".to_string(),
                protected_count,
            );
        }
        Err(error) => {
            return yau_remaining_error(
                "partial",
                format!("444_YAU_CENTER_SEARCH_FAILED:{error}"),
                protected_count,
            );
        }
    };
    let mut verified_state = state;
    verified_state.apply_moves(&result.moves);
    let protected_after = crate::edges::paired_cross_edge_type_mask(&verified_state, cross_color)
        .unwrap_or(0);
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
    })
}

#[wasm_bindgen]
pub fn solve_444_yau_remaining_centers_json(request_json: &str) -> String {
    solve_444_yau_remaining_centers_boundary(request_json)
}

'''
s = replace_once(s, marker, code + marker, "Yau API insertion")
p.write_text(s)

p = Path("solver444-wasm/src/lib.rs")
s = p.read_text()
s = replace_once(
    s,
    '''    solve_444_boundary, solve_444_json, solver_444_api_version, verify_444_solution_boundary,
    verify_444_solution_json,''',
    '''    solve_444_boundary, solve_444_json, solve_444_yau_remaining_centers_boundary,
    solve_444_yau_remaining_centers_json, solver_444_api_version, verify_444_solution_boundary,
    verify_444_solution_json,''',
    "lib API export",
)
s = replace_once(
    s,
    'pub use centers::{solve_centers, solve_centers_for_cross, CenterSolveError, CenterSolveResult};',
    '''pub use centers::{
    solve_centers, solve_centers_for_cross, solve_remaining_centers_for_yau, CenterSolveError,
    CenterSolveResult,
};''',
    "lib center export",
)
p.write_text(s)


# --- JS natural Cross 3 planner ------------------------------------------
p = Path("solver/edgePairing444.js")
s = p.read_text()
s = replace_once(
    s,
    '''  return {
    kpuzzle,
    solved,
    solvedCompact,
    actionFor,
    seedActions,
    outerActions,
    l2eActions,
    sliceFamilies,
  };''',
    '''  const centerPositionsByFace = {};
  for (const face of "URFDLB") {
    const action = actionFor(face);
    centerPositionsByFace[face] = [];
    for (let position = 0; position < 24; position += 1) {
      if (action.centerPermutation[position] !== position) centerPositionsByFace[face].push(position);
    }
  }

  return {
    kpuzzle,
    solved,
    solvedCompact,
    actionFor,
    seedActions,
    outerActions,
    l2eActions,
    sliceFamilies,
    centerPositionsByFace,
  };''',
    "planner model center positions",
)
s = replace_once(
    s,
    '''function edgePairDistanceHeuristic444(state, lockedTypeMask, targetCount, closeMove, model) {
  const needed = Math.max(0, targetCount - bitCount(lockedTypeMask));''',
    '''function edgePairDistanceHeuristic444(state, lockedTypeMask, targetCount, closeMove, model, targetTypeMask = 0x0fff) {
  const needed = Math.max(0, targetCount - bitCount(lockedTypeMask & targetTypeMask));''',
    "targeted pair heuristic signature",
)
s = replace_once(
    s,
    '''  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (lockedTypeMask & (1 << edgeType)) continue;
    const signature = edgeTypeSignature444(state, edgeType);''',
    '''  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (!(targetTypeMask & (1 << edgeType))) continue;
    if (lockedTypeMask & (1 << edgeType)) continue;
    const signature = edgeTypeSignature444(state, edgeType);''',
    "targeted pair heuristic loop",
)
s = replace_once(
    s,
    '''function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES, requiredSolvedTypeMask = 0) {
  const solvedCenters = model.solvedCompact;
  const openMoves = sliceFamily.openMoves;''',
    '''function protectedCenterFacesSolved444(state, model, faces) {
  for (const face of faces) {
    const positions = model.centerPositionsByFace[face] || [];
    if (positions.length !== 4) return false;
    for (const position of positions) {
      if (state.centerPieces[position] !== model.solvedCompact.centerPieces[position]) return false;
    }
  }
  return true;
}

function searchSliceCycle(initialState, lockedMask, targetCount, sliceFamily, model, deadlineTs, maxOuterMoves = SLICE_MAX_OUTER_MOVES, requiredSolvedTypeMask = 0, options = {}) {
  const solvedCenters = model.solvedCompact;
  const openMoves = sliceFamily.openMoves;
  const targetTypeMask = (Number(options?.targetTypeMask) >>> 0) || 0x0fff;
  const exactTargetCount = options?.exactTargetCount === true;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const centersOkay = (state) => requireAllCenters
    ? centersSolved(state, solvedCenters.centerPieces)
    : protectedCenterFacesSolved444(state, model, protectedCenterFaces);''',
    "slice options",
)
s = replace_once(
    s,
    '''        if (
          maskContains(closedMask, lockedMask) &&
          bitCount(closedMask) >= targetCount &&
          (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(closedState), requiredSolvedTypeMask)) &&
          centersSolved(closedState, solvedCenters.centerPieces)
        ) {''',
    '''        const targetPairedCount = bitCount(closedMask & targetTypeMask);
        if (
          maskContains(closedMask, lockedMask) &&
          (exactTargetCount ? targetPairedCount === targetCount : targetPairedCount >= targetCount) &&
          (!requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(closedState), requiredSolvedTypeMask)) &&
          centersOkay(closedState)
        ) {''',
    "slice targeted goal",
)
s = replace_once(
    s,
    '''          const pairDistance = edgePairDistanceHeuristic444(
            nextState,
            lockedMask,
            targetCount,
            closeMove,
            model,
          );
          const score = bitCount(candidateMask) * 220
            + bitCount(candidateMask & lockedMask) * 260''',
    '''          const pairDistance = edgePairDistanceHeuristic444(
            nextState, lockedMask, targetCount, closeMove, model, targetTypeMask,
          );
          const score = bitCount(candidateMask & targetTypeMask) * 520
            + bitCount(candidateMask) * 80
            + bitCount(candidateMask & lockedMask) * 360''',
    "slice targeted score",
)
marker = '''function buildSegment(id, name, moves, pairStart, pairEnd) {'''
insert = '''export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(150, Math.min(2500, Number(options?.timeBudgetMs) || 1200));
  const startedAt = Date.now();
  const localDeadlineTs = globalDeadlineTs > 0 ? Math.min(globalDeadlineTs, startedAt + budgetMs) : startedAt + budgetMs;
  const model = await getPlannerModel();
  let pattern = model.solved;
  if (publicScramble) pattern = pattern.applyAlg(String(publicScramble));
  if (publicSetupSolution) pattern = pattern.applyAlg(String(publicSetupSolution));
  let state = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : ["D", "U"];
  if (!protectedCenterFacesSolved444(state, model, protectedCenterFaces)) return { ok: false, reason: "444_YAU_NATURAL_CROSS3_CENTERS_NOT_READY" };
  let lockedMask = pairedEdgeTypeMask(state) & targetMask;
  let count = bitCount(lockedMask);
  if (count > 3) return { ok: false, reason: "444_YAU_NATURAL_CROSS3_OVERSHOOT_START" };
  const moves = [];
  const cycles = [];
  while (count < 3 && !deadlineReached(localDeadlineTs)) {
    const nextTarget = count + 1;
    let best = null;
    for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
      if (deadlineReached(localDeadlineTs)) break;
      const found = searchSliceCycle(
        state, lockedMask, nextTarget, model.sliceFamilies[frameIndex], model, localDeadlineTs, 4, 0,
        { targetTypeMask: targetMask, exactTargetCount: true, protectedCenterFaces, requireAllCenters: false },
      );
      if (!found) continue;
      if (!best || found.moves.length < best.moves.length) best = { ...found, frameIndex };
      if (found.moves.length <= 4) break;
    }
    if (!best) return {
      ok: false,
      reason: deadlineReached(localDeadlineTs) ? "444_YAU_NATURAL_CROSS3_TIMEOUT" : "444_YAU_NATURAL_CROSS3_NO_CYCLE",
      moveCount: moves.length, pairCount: count, elapsedMs: Date.now() - startedAt,
    };
    state = best.state;
    lockedMask = pairedEdgeTypeMask(state) & targetMask;
    count = bitCount(lockedMask);
    moves.push(...best.moves);
    cycles.push({ frameIndex: best.frameIndex, workingSlice: best.moves[0], moveCount: best.moves.length, pairCount: count });
  }
  const simplified = simplifyOuterSequence(moves);
  const solution = simplified.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedMask = pairedEdgeTypeMask(verifiedState) & targetMask;
  if (bitCount(verifiedMask) !== 3 || !protectedCenterFacesSolved444(verifiedState, model, protectedCenterFaces)) {
    return { ok: false, reason: "444_YAU_NATURAL_CROSS3_VERIFY_FAILED" };
  }
  return {
    ok: true, reason: null, solution, moveCount: simplified.length,
    lockedTypeMask: verifiedMask, pairedTargetMask: verifiedMask, cycleCount: cycles.length, cycles,
    elapsedMs: Date.now() - startedAt, method: "Yau Natural Slice Cross 3/4",
  };
}

''' + marker
s = replace_once(s, marker, insert, "natural Cross 3 export")
p.write_text(s)


# --- solver444 wiring -----------------------------------------------------
p = Path("solver/solver444.js")
s = p.read_text()
s = replace_once(
    s,
    '''    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
    },
    verify(request) {''',
    '''    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
    },
    solveYauRemainingCenters(request) {
      return typeof mod.solve_444_yau_remaining_centers_json === "function"
        ? mod.solve_444_yau_remaining_centers_json(JSON.stringify(request))
        : null;
    },
    verify(request) {''',
    "solver module API",
)
old = '''  const targetTypeMask = edgeModule.crossEdgeTypeMask444(crossColor);

  const cross3 = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    firstTwoCenters,
    targetTypeMask,
    {
      targetCount: 3,
      deadlineTs,
      maxMacros: 8,
      postSequence: remainingCenters,
      enableRescue: options?.__yauFastFrameProbe !== true,
      projectTargetState: options?.__yauFastFrameProbe === true,
    },
  );
  if (!cross3?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS3_FAILED", cross3?.reason || cross3?.detail, deadlineTs);
  }

  const beforeCross4 = [firstTwoCenters, cross3.solution, remainingCenters]'''
new = '''  const targetTypeMask = edgeModule.crossEdgeTypeMask444(crossColor);

  let cross3 = null;
  let effectiveRemainingCenters = remainingCenters;
  let naturalCross3Applied = false;
  let remainingCentersRecomputed = false;
  let naturalCross3FallbackReason = null;
  let recomputedCenterPhaseMoveCounts = null;
  let protectedCenterSearchMs = 0;

  if (
    !deadlineReached(deadlineTs) &&
    typeof edgeModule.solveYauCross3Natural444 === "function" &&
    typeof api.solveYauRemainingCenters === "function"
  ) {
    const natural = await edgeModule.solveYauCross3Natural444(
      publicScramble, firstTwoCenters, targetTypeMask,
      {
        deadlineTs,
        timeBudgetMs: options?.__yauFastFrameProbe === true ? 650 : 1400,
        protectedCenterFaces: [crossColor, OPPOSITE_FACE_444[crossColor]],
      },
    );
    if (natural?.ok) {
      const stateBeforeRemainingCenters = [firstTwoCenters, natural.solution]
        .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
      const protectedCenterScramble = [internalScramble, translate444MoveConvention(stateBeforeRemainingCenters)]
        .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200))
        : Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200);
      let protectedResult = null;
      try {
        const rawProtected = api.solveYauRemainingCenters({
          scramble: protectedCenterScramble,
          crossColor,
          deadlineTs: protectedDeadlineTs,
        });
        protectedResult = typeof rawProtected === "string" ? JSON.parse(rawProtected) : rawProtected;
      } catch (error) {
        naturalCross3FallbackReason = `PROTECTED_CENTER_CALL:${String(error?.message || error)}`;
      }
      if (protectedResult?.ok === true && protectedResult?.verified === true) {
        const candidateRemainingCenters = translate444MoveConvention(protectedResult.solution || "");
        const verifySetup = [stateBeforeRemainingCenters, candidateRemainingCenters]
          .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
        const preserved = await edgeModule.solveTargetEdgeTypes444(
          publicScramble, verifySetup, targetTypeMask,
          {
            targetCount: 3, requiredTypeMask: natural.lockedTypeMask, deadlineTs,
            maxMacros: 0, enableRescue: false,
          },
        );
        if (preserved?.ok) {
          cross3 = natural;
          effectiveRemainingCenters = candidateRemainingCenters;
          naturalCross3Applied = true;
          remainingCentersRecomputed = true;
          recomputedCenterPhaseMoveCounts = Array.isArray(protectedResult.phaseMoveCounts)
            ? [...protectedResult.phaseMoveCounts]
            : null;
          protectedCenterSearchMs = Number(protectedResult.searchMs) || 0;
        } else {
          naturalCross3FallbackReason = preserved?.reason || "PROTECTED_CENTER_JS_VERIFY_FAILED";
        }
      } else if (!naturalCross3FallbackReason) {
        naturalCross3FallbackReason = protectedResult?.reason || "PROTECTED_CENTER_SEARCH_FAILED";
      }
    } else {
      naturalCross3FallbackReason = natural?.reason || "NATURAL_CROSS3_NOT_FOUND";
    }
  }

  if (!cross3) {
    cross3 = await edgeModule.solveTargetEdgeTypes444(
      publicScramble, firstTwoCenters, targetTypeMask,
      {
        targetCount: 3, deadlineTs, maxMacros: 8, postSequence: remainingCenters,
        enableRescue: options?.__yauFastFrameProbe !== true,
        projectTargetState: options?.__yauFastFrameProbe === true,
      },
    );
  }
  if (!cross3?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS3_FAILED", cross3?.reason || cross3?.detail, deadlineTs);
  }

  const beforeCross4 = [firstTwoCenters, cross3.solution, effectiveRemainingCenters]'''
s = replace_once(s, old, new, "Yau Cross 3 integration")
s = replace_once(
    s,
    '    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", remainingCenters),',
    '''    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", effectiveRemainingCenters, {
      recomputedAfterCross3: remainingCentersRecomputed,
    }),''',
    "Yau remaining center segment",
)
s = replace_once(
    s,
    '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3SearchRescueUsed: cross3.searchRescueUsed === true,''',
    '''      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3Method: String(cross3.method || "Yau Cross Edges"),
      yauNaturalCross3Applied: naturalCross3Applied,
      yauNaturalCross3FallbackReason: naturalCross3FallbackReason,
      yauRemainingCentersRecomputed: remainingCentersRecomputed,
      yauRecomputedCenterPhaseMoveCounts: recomputedCenterPhaseMoveCounts,
      yauProtectedCenterSearchMs: protectedCenterSearchMs,
      yauCross3SearchRescueUsed: cross3.searchRescueUsed === true,''',
    "Yau natural meta",
)
s = replace_once(
    s,
    '      yauRemainingCenterMoveCount: splitAlgorithm(remainingCenters).length,',
    '      yauRemainingCenterMoveCount: splitAlgorithm(effectiveRemainingCenters).length,',
    "Yau remaining center count",
)
p.write_text(s)


# --- Regression expectations ---------------------------------------------
p = Path("tools/verify-444-yau.mjs")
s = p.read_text()
s = replace_once(
    s,
    'async function verifyCase(scramble, crossColor) {',
    'async function verifyCase(scramble, crossColor, { expectNatural = false } = {}) {',
    "verifyCase signature",
)
marker = '  assert.equal(result.meta.yauFallbackReason, null);\n'
extra = marker + '''  if (expectNatural) {
    assert.equal(result.meta.yauNaturalCross3Applied, true, `natural Cross 3/4 was not used for ${crossColor}: ${result.meta.yauNaturalCross3FallbackReason}`);
    assert.equal(result.meta.yauRemainingCentersRecomputed, true);
    assert.equal(result.meta.yauCross3Method, "Yau Natural Slice Cross 3/4");
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 14);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);
  }
'''
s = replace_once(s, marker, extra, "natural Yau assertions")
s = replace_once(
    s,
    'await verifyCase("Rw U2 F\' Lw D B2", "D");',
    'await verifyCase("Rw U2 F\' Lw D B2", "D", { expectNatural: true });',
    "D natural case",
)
s = replace_once(
    s,
    'await verifyCase("Uw2 Rw F2 Dw\' L B\' Rw2 U Fw\' D2 Lw B2", "F");',
    'await verifyCase("Uw2 Rw F2 Dw\' L B\' Rw2 U Fw\' D2 Lw B2", "F", { expectNatural: true });',
    "F natural case",
)
p.write_text(s)

print("Yau protected-center patch applied")
