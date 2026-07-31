from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEARCH = ROOT / "solver-wasm" / "src" / "fmc_search.rs"
LIB = ROOT / "solver-wasm" / "src" / "lib.rs"
WRAPPER = ROOT / "solver" / "wasmSolver.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


s = SEARCH.read_text()

s = replace_once(
    s,
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;\n",
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;\n\n"
    "/// Stage-boundary NISS keeps one EO and one DR boundary per axis/side.\n"
    "const FMC_MULTI_NISS_BOUNDARY_EO_LIMIT: usize = 3;\n"
    "const FMC_MULTI_NISS_CONTINUATION_EO_LIMIT: usize = 2;\n"
    "const FMC_MULTI_NISS_CONTINUATION_P2_NODE_LIMIT: u64 = 500_000;\n"
    "const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;\n",
    "multi-switch constants",
)

s = replace_once(
    s,
    "    /// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss\n    pub source_tag: u8,",
    "    /// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS.\n    pub source_tag: u8,",
    "source tag comment",
)

s = replace_once(
    s,
    "    pub slice_insertion_candidate_count: usize,\n    pub eo_fallback_used: bool,",
    "    pub slice_insertion_candidate_count: usize,\n"
    "    pub multi_switch_niss_candidate_count: usize,\n"
    "    pub eo_fallback_used: bool,",
    "result diagnostic field",
)

boundary_code = r'''
#[derive(Clone, Debug)]
struct FmcNissBoundary {
    prefix_moves: Vec<u8>,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    /// 0 = EO→DR boundary, 1 = DR→P2 boundary.
    stage_tag: u8,
}

#[derive(Clone, Debug)]
struct FmcBoundaryNissResult {
    moves: Vec<u8>,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    finish_moves: Vec<u8>,
    stage_tag: u8,
    rzp_used: bool,
}

fn retain_shorter_boundary(slot: &mut Option<FmcNissBoundary>, candidate: FmcNissBoundary) {
    let replace = slot.as_ref().is_none_or(|current| {
        (candidate.prefix_moves.len(), candidate.prefix_moves.clone())
            < (current.prefix_moves.len(), current.prefix_moves.clone())
    });
    if replace {
        *slot = Some(candidate);
    }
}

/// Collect a deliberately narrow beam of legal switch points. One shortest EO
/// boundary and one shortest DR boundary are retained for each axis and side.
fn collect_multi_switch_niss_boundaries(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    current_best: usize,
    force_rzp: bool,
) -> Vec<FmcNissBoundary> {
    let eo_idx = encode_eo(&state.eo);
    let eo_sequences = find_eo_sequences(
        eo_idx,
        tables,
        fmc_tables,
        max_eo_depth,
        FMC_MULTI_NISS_BOUNDARY_EO_LIMIT,
    );
    let mut best_eo = None;
    let mut best_dr = None;

    for eo_moves in eo_sequences {
        if eo_moves.is_empty() || eo_moves.len() >= current_best {
            continue;
        }
        retain_shorter_boundary(
            &mut best_eo,
            FmcNissBoundary {
                prefix_moves: eo_moves.clone(),
                eo_moves: eo_moves.clone(),
                dr_moves: Vec::new(),
                stage_tag: 0,
            },
        );

        let state_after_eo = state.apply_moves(&eo_moves, &tables.move_data);
        let dr_cap = current_best
            .saturating_sub(eo_moves.len())
            .min(FMC_MAX_DR_DEPTH as usize) as u8;
        if dr_cap == 0 {
            continue;
        }
        let last_face_before_dr = last_face_of_moves(&eo_moves, tables);
        let dr_routes = solve_dr_routes_via_rzp(
            &state_after_eo,
            fmc_tables,
            tables,
            dr_cap,
            last_face_before_dr,
            force_rzp,
        );
        if let Some(route) = dr_routes.into_iter().next() {
            let mut prefix_moves = eo_moves.clone();
            prefix_moves.extend_from_slice(&route.moves);
            let prefix_moves = simplify_moves(&prefix_moves);
            if !prefix_moves.is_empty() && prefix_moves.len() < current_best {
                retain_shorter_boundary(
                    &mut best_dr,
                    FmcNissBoundary {
                        prefix_moves,
                        eo_moves: eo_moves.clone(),
                        dr_moves: route.moves,
                        stage_tag: 1,
                    },
                );
            }
        }
    }

    [best_eo, best_dr].into_iter().flatten().collect()
}

/// Switch to the inverse side at a stage boundary. If T = S·A is the state at
/// the boundary and Q solves T⁻¹, then A·Q⁻¹ solves S. Every flattened result is
/// independently replayed on S before it is admitted.
fn solve_multi_switch_niss_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    force_rzp: bool,
) -> Vec<FmcBoundaryNissResult> {
    let boundaries = collect_multi_switch_niss_boundaries(
        state,
        tables,
        fmc_tables,
        max_eo_depth,
        *current_best,
        force_rzp,
    );
    let mut output = Vec::new();

    for boundary in boundaries {
        let boundary_state = state.apply_moves(&boundary.prefix_moves, &tables.move_data);
        let switched_state = invert_state(&boundary_state);
        // Permit a small cancellation margin across the switch boundary.
        let mut continuation_best = current_best
            .saturating_add(3)
            .saturating_sub(boundary.prefix_moves.len())
            .max(1);
        let continuations = solve_fmc_single_axis(
            &switched_state,
            tables,
            fmc_tables,
            max_eo_depth,
            FMC_MULTI_NISS_CONTINUATION_EO_LIMIT,
            FMC_MAX_DR_DEPTH,
            FMC_MAX_P2_DEPTH,
            FMC_MULTI_NISS_CONTINUATION_P2_NODE_LIMIT,
            p2_cache,
            &mut continuation_best,
            force_rzp,
            false,
        );

        for (continuation, _, _, _, continuation_rzp, _, _) in continuations {
            let inverse_continuation = invert_moves(&continuation);
            let mut flattened = boundary.prefix_moves.clone();
            flattened.extend_from_slice(&inverse_continuation);
            let flattened = simplify_moves(&flattened);
            if flattened.is_empty() || flattened.len() > *current_best {
                continue;
            }
            if !state
                .apply_moves(&flattened, &tables.move_data)
                .is_solved()
            {
                continue;
            }
            if flattened.len() < *current_best {
                *current_best = flattened.len();
            }
            output.push(FmcBoundaryNissResult {
                moves: flattened,
                eo_moves: boundary.eo_moves.clone(),
                dr_moves: boundary.dr_moves.clone(),
                finish_moves: inverse_continuation,
                stage_tag: boundary.stage_tag,
                rzp_used: continuation_rzp,
            });
        }
    }

    output.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.stage_tag,
            candidate.moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    output.retain(|candidate| seen.insert(candidate.moves.clone()));
    output.truncate(FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS);
    output
}

'''

s = replace_once(
    s,
    "// --- Single-Axis EO→DR→P2 Pipeline ---\n",
    boundary_code + "// --- Single-Axis EO→DR→P2 Pipeline ---\n",
    "boundary NISS helpers",
)

s = replace_once(
    s,
    "    enable_htr_skeletons: bool,\n    enable_slice_insertion: bool,\n    max_eo_depth: u8,",
    "    enable_htr_skeletons: bool,\n"
    "    enable_slice_insertion: bool,\n"
    "    enable_multi_switch_niss: bool,\n"
    "    max_eo_depth: u8,",
    "internal solver option",
)

s = s.replace(
    "                slice_insertion_candidate_count: 0,\n                eo_fallback_used: false,",
    "                slice_insertion_candidate_count: 0,\n"
    "                multi_switch_niss_candidate_count: 0,\n"
    "                eo_fallback_used: false,",
)

phase_anchor = "    // --- Phase 3: Premove sweep ---\n"
phase_code = r'''    // --- Phase 2b: stage-boundary multi-switch NISS ---
    if enable_multi_switch_niss {
        for axis in 0..3u8 {
            let cvt = |v: &[u8]| -> Vec<u8> {
                v.iter()
                    .map(|&m| fmc_tables.axis_solution_move_map[axis as usize][m as usize])
                    .collect()
            };

            let direct_results = solve_multi_switch_niss_single_axis(
                &direct_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                force_rzp,
            );
            for result in direct_results {
                let simplified = simplify_moves(&cvt(&result.moves));
                if simplified.is_empty()
                    || simplified.len() > best_count
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                if simplified.len() < best_count {
                    best_count = simplified.len();
                }
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 8 } else { 9 },
                    premove_moves: vec![],
                    rzp_used: result.rzp_used,
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }

            let inverse_results = solve_multi_switch_niss_single_axis(
                &inverse_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                force_rzp,
            );
            for result in inverse_results {
                let effective_inverse_solution = cvt(&result.moves);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > best_count
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                if simplified.len() < best_count {
                    best_count = simplified.len();
                }
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 10 } else { 11 },
                    premove_moves: vec![],
                    rzp_used: result.rzp_used,
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

'''
s = replace_once(s, phase_anchor, phase_code + phase_anchor, "multi-switch phase")

s = replace_once(
    s,
    "    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);",
    "    let multi_switch_niss_candidate_count = all_candidates\n"
    "        .iter()\n"
    "        .filter(|candidate| (8..=11).contains(&candidate.source_tag))\n"
    "        .count();\n\n"
    "    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);",
    "multi-switch count",
)

s = replace_once(
    s,
    "        slice_insertion_candidate_count,\n        eo_fallback_used: false,",
    "        slice_insertion_candidate_count,\n"
    "        multi_switch_niss_candidate_count,\n"
    "        eo_fallback_used: false,",
    "final result count",
)

s = replace_once(
    s,
    "    enable_htr_skeletons: bool,\n    enable_slice_insertion: bool,\n) -> FmcResult {",
    "    enable_htr_skeletons: bool,\n"
    "    enable_slice_insertion: bool,\n"
    "    enable_multi_switch_niss: bool,\n"
    ") -> FmcResult {",
    "public solver option",
)

# Add the option to both depth-5 and depth-6 internal calls.
s = s.replace(
    "        enable_htr_skeletons,\n        enable_slice_insertion,\n        FMC_MAX_EO_DEPTH,",
    "        enable_htr_skeletons,\n"
    "        enable_slice_insertion,\n"
    "        enable_multi_switch_niss,\n"
    "        FMC_MAX_EO_DEPTH,",
)
s = s.replace(
    "        enable_htr_skeletons,\n        enable_slice_insertion,\n        FMC_MAX_EO_DEPTH.saturating_add(1),",
    "        enable_htr_skeletons,\n"
    "        enable_slice_insertion,\n"
    "        enable_multi_switch_niss,\n"
    "        FMC_MAX_EO_DEPTH.saturating_add(1),",
)

source_old = '''        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        _ => "FMC_UNKNOWN".into(),'''
source_new = '''        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        8 => format!("FMC_MULTI_NISS_EO_BOUNDARY_{}", AXIS_NAMES[candidate.axis as usize]),
        9 => format!("FMC_MULTI_NISS_DR_BOUNDARY_{}", AXIS_NAMES[candidate.axis as usize]),
        10 => format!("FMC_MULTI_NISS_INVERSE_EO_BOUNDARY_{}", AXIS_NAMES[candidate.axis as usize]),
        11 => format!("FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}", AXIS_NAMES[candidate.axis as usize]),
        _ => "FMC_UNKNOWN".into(),'''
s = replace_once(s, source_old, source_new, "candidate source mapping")

skeleton_old = '''        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        _ => "FMC_UNKNOWN".into(),'''
skeleton_new = '''        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        8 => format!("FMC_MULTI_NISS_EO_BOUNDARY_{}", AXIS_NAMES[skeleton.axis as usize]),
        9 => format!("FMC_MULTI_NISS_DR_BOUNDARY_{}", AXIS_NAMES[skeleton.axis as usize]),
        10 => format!("FMC_MULTI_NISS_INVERSE_EO_BOUNDARY_{}", AXIS_NAMES[skeleton.axis as usize]),
        11 => format!("FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}", AXIS_NAMES[skeleton.axis as usize]),
        _ => "FMC_UNKNOWN".into(),'''
s = replace_once(s, skeleton_old, skeleton_new, "skeleton source mapping")

SEARCH.write_text(s)

lib = LIB.read_text()
lib = replace_once(
    lib,
    '    #[serde(rename = "enableSliceInsertion", default)]\n    enable_slice_insertion: bool,',
    '    #[serde(rename = "enableSliceInsertion", default)]\n'
    '    enable_slice_insertion: bool,\n'
    '    #[serde(rename = "enableMultiSwitchNiss", default)]\n'
    '    enable_multi_switch_niss: bool,',
    "lib option struct",
)
lib = replace_once(
    lib,
    "        options.enable_htr_skeletons,\n        options.enable_slice_insertion,\n    );",
    "        options.enable_htr_skeletons,\n"
    "        options.enable_slice_insertion,\n"
    "        options.enable_multi_switch_niss,\n"
    "    );",
    "lib solver call",
)
lib = replace_once(
    lib,
    '        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,\n        "eoFallbackUsed": result.eo_fallback_used,',
    '        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,\n'
    '        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,\n'
    '        "eoFallbackUsed": result.eo_fallback_used,',
    "lib result json",
)
LIB.write_text(lib)

wrapper = WRAPPER.read_text()
wrapper = replace_once(
    wrapper,
    "      enableHtrSkeletons: options.enableHtrSkeletons === true,\n      enableSliceInsertion: options.enableSliceInsertion === true,",
    "      enableHtrSkeletons: options.enableHtrSkeletons === true,\n"
    "      enableSliceInsertion: options.enableSliceInsertion === true,\n"
    "      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,",
    "wrapper option",
)
WRAPPER.write_text(wrapper)

print("Applied opt-in stage-boundary multi-switch NISS")
