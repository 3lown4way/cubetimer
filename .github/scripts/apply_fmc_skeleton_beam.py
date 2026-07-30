from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new, 1)


fmc_path = Path("solver-wasm/src/fmc_search.rs")
text = fmc_path.read_text()

text = replace_once(
    text,
    "const FMC_DR_SLACK: usize = 3;\n",
    '''const FMC_DR_SLACK: usize = 3;

/// Maximum skeleton candidates returned for the next insertion stage.
const FMC_SKELETON_BEAM_LIMIT: usize = 24;

/// Preserve up to this many candidates per (kind, source, axis) bucket before
/// filling the remaining global beam slots.
const FMC_SKELETON_PER_BUCKET: usize = 2;
''',
    "constants",
)

text = replace_once(
    text,
    '''// --- Result Types ---

#[derive(Clone, Debug)]
pub struct FmcCandidate {
''',
    '''#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FmcSkeletonKind {
    Corner3,
    Edge3,
}

impl FmcSkeletonKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Corner3 => "corner3",
            Self::Edge3 => "edge3",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Corner3 => 0,
            Self::Edge3 => 1,
        }
    }
}

#[derive(Clone, Debug)]
struct AxisSkeletonPrefix {
    moves: Vec<u8>,
    eo_len: u8,
    dr_len: u8,
    p2_len: u8,
}

fn classify_three_cycle(state: &CubeState) -> Option<(FmcSkeletonKind, [u8; 3])> {
    if state.co.iter().any(|&v| v != 0) || state.eo.iter().any(|&v| v != 0) {
        return None;
    }

    let corner_misplaced: Vec<u8> = state
        .cp
        .iter()
        .enumerate()
        .filter_map(|(i, &piece)| (piece as usize != i).then_some(i as u8))
        .collect();
    let edge_misplaced: Vec<u8> = state
        .ep
        .iter()
        .enumerate()
        .filter_map(|(i, &piece)| (piece as usize != i).then_some(i as u8))
        .collect();

    if corner_misplaced.len() == 3 && edge_misplaced.is_empty() {
        return Some((
            FmcSkeletonKind::Corner3,
            [corner_misplaced[0], corner_misplaced[1], corner_misplaced[2]],
        ));
    }
    if edge_misplaced.len() == 3 && corner_misplaced.is_empty() {
        return Some((
            FmcSkeletonKind::Edge3,
            [edge_misplaced[0], edge_misplaced[1], edge_misplaced[2]],
        ));
    }
    None
}

fn collect_axis_skeleton_prefixes(
    state_after_dr: &CubeState,
    eo_moves: &[u8],
    dr_moves: &[u8],
    p2_moves: &[u8],
    tables: &TwophaseTables,
) -> Vec<AxisSkeletonPrefix> {
    let mut prefixes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut state = *state_after_dr;
    let mut moves = Vec::with_capacity(eo_moves.len() + dr_moves.len() + p2_moves.len());
    moves.extend_from_slice(eo_moves);
    moves.extend_from_slice(dr_moves);

    for p2_len in 0..=p2_moves.len() {
        if let Some((kind, defect_positions)) = classify_three_cycle(&state) {
            let simplified = simplify_moves(&moves);
            if !simplified.is_empty()
                && seen.insert((kind, defect_positions, simplified.clone()))
            {
                prefixes.push(AxisSkeletonPrefix {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_len as u8,
                });
            }
        }

        if let Some(&next_move) = p2_moves.get(p2_len) {
            state = state.apply_move(next_move as usize, &tables.move_data);
            moves.push(next_move);
        }
    }

    prefixes
}

// --- Result Types ---

#[derive(Clone, Debug)]
pub struct FmcCandidate {
''',
    "skeleton helpers",
)

text = replace_once(
    text,
    '''#[derive(Clone, Debug)]
pub struct FmcResult {
    pub ok: bool,
    pub candidates: Vec<FmcCandidate>,
}
''',
    '''#[derive(Clone, Debug)]
pub struct FmcSkeletonCandidate {
    pub moves: Vec<u8>,
    pub kind: FmcSkeletonKind,
    pub defect_positions: [u8; 3],
    pub eo_len: u8,
    pub dr_len: u8,
    pub p2_len: u8,
    pub axis: u8,
    pub source_tag: u8,
    pub premove_moves: Vec<u8>,
    pub rzp_used: bool,
}

#[derive(Clone, Debug)]
pub struct FmcResult {
    pub ok: bool,
    pub candidates: Vec<FmcCandidate>,
    pub skeletons: Vec<FmcSkeletonCandidate>,
}
''',
    "result types",
)

text = replace_once(
    text,
    ''') -> Vec<(Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, bool)> {
''',
    ''') -> Vec<(
    Vec<u8>,
    Vec<u8>,
    Vec<u8>,
    Vec<u8>,
    bool,
    Vec<AxisSkeletonPrefix>,
)> {
''',
    "single-axis return type",
)

text = replace_once(
    text,
    '''            results.push((
                simplified,
                eo_seq.clone(),
                dr_moves.clone(),
                p2_global.clone(),
                dr_route.rzp_setup_len > 0,
            ));
''',
    '''            let skeleton_prefixes = collect_axis_skeleton_prefixes(
                &state_after_dr,
                eo_seq,
                dr_moves,
                &p2_global,
                tables,
            );
            results.push((
                simplified,
                eo_seq.clone(),
                dr_moves.clone(),
                p2_global.clone(),
                dr_route.rzp_setup_len > 0,
                skeleton_prefixes,
            ));
''',
    "single-axis result push",
)

helpers = '''fn build_skeleton_candidate(
    scramble_state: &CubeState,
    moves: Vec<u8>,
    tables: &TwophaseTables,
    prefix: &AxisSkeletonPrefix,
    axis: u8,
    source_tag: u8,
    premove_moves: &[u8],
    rzp_used: bool,
) -> Option<FmcSkeletonCandidate> {
    let simplified = simplify_moves(&moves);
    if simplified.is_empty() {
        return None;
    }
    let final_state = scramble_state.apply_moves(&simplified, &tables.move_data);
    let (kind, defect_positions) = classify_three_cycle(&final_state)?;
    Some(FmcSkeletonCandidate {
        moves: simplified,
        kind,
        defect_positions,
        eo_len: prefix.eo_len,
        dr_len: prefix.dr_len,
        p2_len: prefix.p2_len,
        axis,
        source_tag,
        premove_moves: premove_moves.to_vec(),
        rzp_used,
    })
}

fn finalize_skeleton_beam(
    mut candidates: Vec<FmcSkeletonCandidate>,
) -> Vec<FmcSkeletonCandidate> {
    candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.kind.rank(),
            candidate.source_tag,
            candidate.axis,
            candidate.p2_len,
        )
    });

    let mut dedup = std::collections::HashSet::new();
    candidates.retain(|candidate| {
        dedup.insert((
            candidate.kind,
            candidate.defect_positions,
            candidate.moves.clone(),
        ))
    });

    let mut selected = Vec::new();
    let mut selected_keys = std::collections::HashSet::new();
    let mut bucket_counts =
        std::collections::HashMap::<(FmcSkeletonKind, u8, u8), usize>::new();

    for quota in 1..=FMC_SKELETON_PER_BUCKET {
        for (index, candidate) in candidates.iter().enumerate() {
            if selected.len() >= FMC_SKELETON_BEAM_LIMIT {
                break;
            }
            if selected_keys.contains(&index) {
                continue;
            }
            let bucket = (candidate.kind, candidate.source_tag, candidate.axis);
            let count = *bucket_counts.get(&bucket).unwrap_or(&0);
            if count >= quota {
                continue;
            }
            selected.push(candidate.clone());
            selected_keys.insert(index);
            bucket_counts.insert(bucket, count + 1);
        }
    }

    if selected.len() < FMC_SKELETON_BEAM_LIMIT {
        for (index, candidate) in candidates.into_iter().enumerate() {
            if selected.len() >= FMC_SKELETON_BEAM_LIMIT {
                break;
            }
            if selected_keys.insert(index) {
                selected.push(candidate);
            }
        }
    }

    selected.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.kind.rank(),
            candidate.source_tag,
            candidate.axis,
        )
    });
    selected
}

'''
text = replace_once(text, '// --- Full FMC Solver ---\n', helpers + '// --- Full FMC Solver ---\n', "full solver helpers")

text = replace_once(
    text,
    '''            return FmcResult {
                ok: false,
                candidates: vec![],
            }
''',
    '''            return FmcResult {
                ok: false,
                candidates: vec![],
                skeletons: vec![],
            }
''',
    "parse error result",
)

text = replace_once(
    text,
    '''    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut best_count = 40usize;
''',
    '''    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut all_skeletons: Vec<FmcSkeletonCandidate> = Vec::new();
    let original_scramble_state =
        CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
    let mut best_count = 40usize;
''',
    "solver collections",
)

text = text.replace(
    'for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used) in results {',
    'for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used, skeleton_prefixes) in results {',
)
text = text.replace(
    'for (moves_in_axis, eo_raw, dr_raw, p2_raw, rzp_used) in results {',
    'for (moves_in_axis, eo_raw, dr_raw, p2_raw, rzp_used, skeleton_prefixes) in results {',
)
text = text.replace('let cvt = |v: &Vec<u8>| -> Vec<u8> {', 'let cvt = |v: &[u8]| -> Vec<u8> {')

direct_anchor = '''            if !simplified.is_empty() && simplified.len() <= best_count {
                best_count = simplified.len();
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_raw.len() as u8,
                    dr_len: dr_raw.len() as u8,
                    p2_len: p2_raw.len() as u8,
                    eo_moves: cvt(&eo_raw),
                    dr_moves: cvt(&dr_raw),
                    finish_moves: cvt(&p2_raw),
                    axis,
                    source_tag: 0,
                    premove_moves: vec![],
                    rzp_used,
                });
            }
'''
text = replace_once(
    text,
    direct_anchor,
    direct_anchor + '''
            for prefix in skeleton_prefixes {
                let original_prefix = cvt(&prefix.moves);
                if let Some(candidate) = build_skeleton_candidate(
                    &original_scramble_state,
                    original_prefix,
                    tables,
                    &prefix,
                    axis,
                    0,
                    &[],
                    rzp_used,
                ) {
                    all_skeletons.push(candidate);
                }
            }
''',
    "direct skeleton collection",
)

niss_anchor = '''            if !simplified.is_empty() && simplified.len() <= best_count {
                best_count = simplified.len();
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_raw.len() as u8,
                    dr_len: dr_raw.len() as u8,
                    p2_len: p2_raw.len() as u8,
                    // NISS: store original (pre-inversion) segments from inverse solve
                    eo_moves: cvt(&eo_raw),
                    dr_moves: cvt(&dr_raw),
                    finish_moves: cvt(&p2_raw),
                    axis,
                    source_tag: 1,
                    premove_moves: vec![],
                    rzp_used,
                });
            }
'''
text = replace_once(
    text,
    niss_anchor,
    niss_anchor + '''
            for prefix in skeleton_prefixes {
                let inverse_prefix = invert_moves(&cvt(&prefix.moves));
                if let Some(candidate) = build_skeleton_candidate(
                    &original_scramble_state,
                    inverse_prefix,
                    tables,
                    &prefix,
                    axis,
                    1,
                    &[],
                    rzp_used,
                ) {
                    all_skeletons.push(candidate);
                }
            }
''',
    "niss skeleton collection",
)

pm_direct_anchor = '''                    if !simplified.is_empty() && simplified.len() <= best_count {
                        best_count = simplified.len();
                        all_candidates.push(FmcCandidate {
                            moves: simplified,
                            eo_len: eo_raw.len() as u8,
                            dr_len: dr_raw.len() as u8,
                            p2_len: p2_raw.len() as u8,
                            eo_moves: cvt(&eo_raw),
                            dr_moves: cvt(&dr_raw),
                            finish_moves: cvt(&p2_raw),
                            axis,
                            source_tag: 2,
                            premove_moves: pm_set.clone(),
                            rzp_used,
                        });
                    }
'''
text = replace_once(
    text,
    pm_direct_anchor,
    pm_direct_anchor + '''
                    for prefix in skeleton_prefixes {
                        let mut full_prefix = pm_set.clone();
                        full_prefix.extend_from_slice(&cvt(&prefix.moves));
                        if let Some(candidate) = build_skeleton_candidate(
                            &original_scramble_state,
                            full_prefix,
                            tables,
                            &prefix,
                            axis,
                            2,
                            pm_set,
                            rzp_used,
                        ) {
                            all_skeletons.push(candidate);
                        }
                    }
''',
    "premove direct skeleton collection",
)

pm_niss_anchor = '''                    if !simplified.is_empty() && simplified.len() <= best_count {
                        best_count = simplified.len();
                        all_candidates.push(FmcCandidate {
                            moves: simplified,
                            eo_len: eo_raw.len() as u8,
                            dr_len: dr_raw.len() as u8,
                            p2_len: p2_raw.len() as u8,
                            // NISS: store original (pre-inversion) segments
                            eo_moves: cvt(&eo_raw),
                            dr_moves: cvt(&dr_raw),
                            finish_moves: cvt(&p2_raw),
                            axis,
                            source_tag: 3,
                            premove_moves: pm_set.clone(),
                            rzp_used,
                        });
                    }
'''
text = replace_once(
    text,
    pm_niss_anchor,
    pm_niss_anchor + '''
                    for prefix in skeleton_prefixes {
                        let mut full_prefix = invert_moves(&cvt(&prefix.moves));
                        full_prefix.extend_from_slice(&invert_moves(pm_set));
                        if let Some(candidate) = build_skeleton_candidate(
                            &original_scramble_state,
                            full_prefix,
                            tables,
                            &prefix,
                            axis,
                            3,
                            pm_set,
                            rzp_used,
                        ) {
                            all_skeletons.push(candidate);
                        }
                    }
''',
    "premove niss skeleton collection",
)

text = replace_once(
    text,
    '''    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
    }
}
''',
    '''    let skeletons = finalize_skeleton_beam(all_skeletons);

    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
    }
}
''',
    "final result",
)

text += '''

pub fn skeleton_to_json(
    skeleton: &FmcSkeletonCandidate,
    tables: &TwophaseTables,
) -> serde_json::Value {
    let solution = solution_string_from_path(&skeleton.moves, &tables.move_data);
    let premove_str = if skeleton.premove_moves.is_empty() {
        String::new()
    } else {
        solution_string_from_path(&skeleton.premove_moves, &tables.move_data)
    };
    let source = match skeleton.source_tag {
        0 => format!("FMC_EO_{}", AXIS_NAMES[skeleton.axis as usize]),
        1 => format!("FMC_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        2 => format!("FMC_PREMOVE_{}", AXIS_NAMES[skeleton.axis as usize]),
        3 => format!("FMC_PREMOVE_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        _ => "FMC_UNKNOWN".into(),
    };

    serde_json::json!({
        "kind": skeleton.kind.as_str(),
        "solution": solution,
        "moveCount": skeleton.moves.len(),
        "estimatedInsertionCost": 8,
        "estimatedFinalMoveCount": skeleton.moves.len() + 8,
        "defectPositions": skeleton.defect_positions,
        "eoLength": skeleton.eo_len,
        "drLength": skeleton.dr_len,
        "p2PrefixLength": skeleton.p2_len,
        "axisName": AXIS_NAMES[skeleton.axis as usize],
        "source": source,
        "premoves": premove_str,
        "rzpUsed": skeleton.rzp_used,
    })
}

#[cfg(test)]
mod skeleton_tests {
    use super::*;

    #[test]
    fn classifies_pure_corner_three_cycle() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 2;
        state.cp[2] = 0;
        assert_eq!(
            classify_three_cycle(&state),
            Some((FmcSkeletonKind::Corner3, [0, 1, 2]))
        );
    }

    #[test]
    fn classifies_pure_edge_three_cycle() {
        let mut state = CubeState::solved();
        state.ep[4] = 5;
        state.ep[5] = 6;
        state.ep[6] = 4;
        assert_eq!(
            classify_three_cycle(&state),
            Some((FmcSkeletonKind::Edge3, [4, 5, 6]))
        );
    }

    #[test]
    fn rejects_mixed_or_oriented_defects() {
        let mut mixed = CubeState::solved();
        mixed.cp[0] = 1;
        mixed.cp[1] = 2;
        mixed.cp[2] = 0;
        mixed.ep[0] = 1;
        mixed.ep[1] = 2;
        mixed.ep[2] = 0;
        assert_eq!(classify_three_cycle(&mixed), None);

        let mut oriented = CubeState::solved();
        oriented.cp[0] = 1;
        oriented.cp[1] = 2;
        oriented.cp[2] = 0;
        oriented.co[0] = 1;
        assert_eq!(classify_three_cycle(&oriented), None);
    }
}
'''

fmc_path.write_text(text)

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    'use fmc_search::{build_fmc_tables, candidate_to_json, solve_fmc, FmcTables};',
    'use fmc_search::{build_fmc_tables, candidate_to_json, skeleton_to_json, solve_fmc, FmcTables};',
    "lib import",
)
lib = replace_once(
    lib,
    '''    let best = &result.candidates[0];
    let best_solution = minmove_core::solution_string_from_path(&best.moves, &tables.move_data);

    serde_json::json!({
        "ok": true,
        "solution": best_solution,
        "moveCount": best.moves.len(),
        "candidates": candidates_json,
    })
''',
    '''    let skeletons_json: Vec<serde_json::Value> = result
        .skeletons
        .iter()
        .map(|s| skeleton_to_json(s, tables))
        .collect();

    let best = &result.candidates[0];
    let best_solution = minmove_core::solution_string_from_path(&best.moves, &tables.move_data);

    serde_json::json!({
        "ok": true,
        "solution": best_solution,
        "moveCount": best.moves.len(),
        "candidates": candidates_json,
        "skeletonCount": skeletons_json.len(),
        "skeletons": skeletons_json,
    })
''',
    "lib result json",
)
lib_path.write_text(lib)
