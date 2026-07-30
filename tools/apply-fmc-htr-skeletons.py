from pathlib import Path

root = Path(__file__).resolve().parents[1]
fmc_path = root / "solver-wasm" / "src" / "fmc_search.rs"
lib_path = root / "solver-wasm" / "src" / "lib.rs"
wrapper_path = root / "solver" / "wasmSolver.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


fmc = fmc_path.read_text()
fmc = replace_once(
    fmc,
    "use once_cell::sync::Lazy;",
    "use once_cell::sync::{Lazy, OnceCell};",
    "once_cell import",
)
fmc = replace_once(
    fmc,
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;",
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;\n\n/// Global half turns used inside the HTR subgroup.\nconst FMC_HTR_HALF_TURN_MOVES: [u8; 6] = [2, 5, 8, 11, 14, 17];\n\n/// Avoid accepting an HTR detour that is materially longer than the normal P2 tail.\nconst FMC_HTR_TAIL_SLACK: usize = 2;",
    "HTR constants",
)
fmc = replace_once(
    fmc,
    "    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.\n    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,",
    "    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.\n    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,\n    /// Lazily built half-turn subgroup table. Values are the first half turn toward solved.\n    htr_first_move: OnceCell<std::collections::HashMap<u128, u8>>,",
    "FmcTables HTR field",
)
fmc = replace_once(
    fmc,
    "        two_corner_two_edge_algorithms,\n        multi_relocation_plans,\n    }",
    "        two_corner_two_edge_algorithms,\n        multi_relocation_plans,\n        htr_first_move: OnceCell::new(),\n    }",
    "FmcTables HTR init",
)

htr_functions = r'''

fn htr_permutation_key(state: &CubeState) -> u128 {
    let mut key = 0u128;
    for (index, &piece) in state.cp.iter().enumerate() {
        key |= (piece as u128) << (index * 3);
    }
    for (index, &piece) in state.ep.iter().enumerate() {
        key |= (piece as u128) << (24 + index * 4);
    }
    key
}

fn build_htr_first_move_table(
    tables: &TwophaseTables,
) -> std::collections::HashMap<u128, u8> {
    let solved = CubeState::solved();
    let mut first_move = std::collections::HashMap::<u128, u8>::new();
    let mut queue = std::collections::VecDeque::<CubeState>::new();
    first_move.insert(htr_permutation_key(&solved), 255);
    queue.push_back(solved);

    while let Some(state) = queue.pop_front() {
        for &move_index in &FMC_HTR_HALF_TURN_MOVES {
            let next = state.apply_move(move_index as usize, &tables.move_data);
            let key = htr_permutation_key(&next);
            if first_move.insert(key, move_index).is_none() {
                queue.push_back(next);
            }
        }
    }
    first_move
}

fn htr_finish_moves(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Option<Vec<u8>> {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return None;
    }
    let table = fmc_tables
        .htr_first_move
        .get_or_init(|| build_htr_first_move_table(tables));
    let mut current = *state;
    let mut moves = Vec::new();
    let mut guard = 0usize;
    loop {
        let move_index = *table.get(&htr_permutation_key(&current))?;
        if move_index == 255 {
            return Some(moves);
        }
        moves.push(move_index);
        current = current.apply_move(move_index as usize, &tables.move_data);
        guard += 1;
        if guard > 40 {
            return None;
        }
    }
}

fn find_htr_tail_from_p2(
    state_after_dr: &CubeState,
    p2_moves: &[u8],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Option<Vec<u8>> {
    let mut state = *state_after_dr;
    let mut prefix = Vec::<u8>::new();
    let mut best: Option<Vec<u8>> = None;

    // Exclude the final solved state: it only reproduces the original P2 route.
    for &next_move in p2_moves {
        if let Some(finish) = htr_finish_moves(&state, tables, fmc_tables) {
            let mut tail = prefix.clone();
            tail.extend_from_slice(&finish);
            let tail = simplify_moves(&tail);
            if tail != p2_moves && tail.len() <= p2_moves.len() + FMC_HTR_TAIL_SLACK {
                let replace = best
                    .as_ref()
                    .is_none_or(|current| (tail.len(), tail.clone()) < (current.len(), current.clone()));
                if replace {
                    best = Some(tail);
                }
            }
        }
        state = state.apply_move(next_move as usize, &tables.move_data);
        prefix.push(next_move);
    }
    best
}
'''
fmc = replace_once(
    fmc,
    "\n// --- Result Types ---",
    htr_functions + "\n// --- Result Types ---",
    "HTR helper functions",
)

fmc = replace_once(
    fmc,
    "    current_best: &mut usize,\n    force_rzp: bool,\n) -> Vec<(",
    "    current_best: &mut usize,\n    force_rzp: bool,\n    enable_htr_skeletons: bool,\n) -> Vec<(",
    "single-axis HTR option",
)
fmc = replace_once(
    fmc,
    "    bool,\n    Vec<AxisSkeletonPrefix>,\n)>",
    "    bool,\n    bool,\n    Vec<AxisSkeletonPrefix>,\n)>",
    "single-axis return HTR flag",
)
fmc = replace_once(
    fmc,
    "                dr_route.rzp_setup_len > 0,\n                skeleton_prefixes,\n            ));",
    "                dr_route.rzp_setup_len > 0,\n                false,\n                skeleton_prefixes,\n            ));\n\n            if enable_htr_skeletons {\n                if let Some(htr_tail) =\n                    find_htr_tail_from_p2(&state_after_dr, &p2_global, tables, fmc_tables)\n                {\n                    let mut htr_all_moves =\n                        Vec::with_capacity(eo_seq.len() + dr_moves.len() + htr_tail.len());\n                    htr_all_moves.extend_from_slice(eo_seq);\n                    htr_all_moves.extend_from_slice(dr_moves);\n                    htr_all_moves.extend_from_slice(&htr_tail);\n                    let htr_simplified = simplify_moves(&htr_all_moves);\n                    if !htr_simplified.is_empty() && htr_simplified.len() <= *current_best {\n                        if htr_simplified.len() < *current_best {\n                            *current_best = htr_simplified.len();\n                        }\n                        let htr_prefixes = collect_axis_skeleton_prefixes(\n                            &state_after_dr,\n                            eo_seq,\n                            dr_moves,\n                            &htr_tail,\n                            tables,\n                        );\n                        results.push((\n                            htr_simplified,\n                            eo_seq.clone(),\n                            dr_moves.clone(),\n                            htr_tail,\n                            dr_route.rzp_setup_len > 0,\n                            true,\n                            htr_prefixes,\n                        ));\n                    }\n                }\n            }",
    "HTR result expansion",
)

fmc = replace_once(
    fmc,
    "    force_rzp: bool,\n    enable_multi_insertion: bool,\n) -> FmcResult {",
    "    force_rzp: bool,\n    enable_multi_insertion: bool,\n    enable_htr_skeletons: bool,\n) -> FmcResult {",
    "solve_fmc HTR option",
)
# Add HTR option to all four solve_fmc_single_axis calls.
fmc = fmc.replace(
    "            force_rzp,\n        );",
    "            force_rzp,\n            enable_htr_skeletons,\n        );",
)
if fmc.count("enable_htr_skeletons,\n        );") != 4:
    raise SystemExit("expected four solve_fmc_single_axis HTR arguments")

# Update four result destructuring loops.
old_loop = "for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used, skeleton_prefixes) in results"
fmc = fmc.replace(
    old_loop,
    "for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used, htr_used, skeleton_prefixes) in results",
)
old_pm_loop = "for (moves_in_axis, eo_raw, dr_raw, p2_raw, rzp_used, skeleton_prefixes) in results"
fmc = fmc.replace(
    old_pm_loop,
    "for (moves_in_axis, eo_raw, dr_raw, p2_raw, rzp_used, htr_used, skeleton_prefixes) in results",
)
if fmc.count("htr_used, skeleton_prefixes) in results") != 4:
    raise SystemExit("expected four HTR result destructuring loops")

# Insert source_tag calculations after each conversion closure.
markers = [
    ("            let original: Vec<u8> = cvt(&moves_in_axis_frame);\n", "            let source_tag = if htr_used { 4 } else { 0 };\n"),
    ("            let original: Vec<u8> = cvt(&moves_in_axis_frame);\n            // NISS", "            let original: Vec<u8> = cvt(&moves_in_axis_frame);\n            let source_tag = if htr_used { 5 } else { 1 };\n            // NISS"),
    ("                    let original: Vec<u8> = cvt(&moves_in_axis);\n                    // Direct premove", "                    let original: Vec<u8> = cvt(&moves_in_axis);\n                    let source_tag = if htr_used { 6 } else { 2 };\n                    // Direct premove"),
    ("                    let original: Vec<u8> = cvt(&moves_in_axis);\n                    // NISS premove", "                    let original: Vec<u8> = cvt(&moves_in_axis);\n                    let source_tag = if htr_used { 7 } else { 3 };\n                    // NISS premove"),
]
# First marker is ambiguous because it occurs twice; handle direct first occurrence only.
fmc = replace_once(fmc, markers[0][0], markers[0][0] + markers[0][1], "direct source tag")
for old, new in markers[1:]:
    fmc = replace_once(fmc, old, new, "HTR source tag")

# Replace hardcoded source tags inside the four loops. These patterns are unique in candidate/build calls.
for literal in ["source_tag: 0,", "source_tag: 1,", "source_tag: 2,", "source_tag: 3,"]:
    fmc = replace_once(fmc, literal, "source_tag,", f"candidate {literal}")
for literal in ["                            0,\n", "                            1,\n", "                            2,\n", "                            3,\n"]:
    fmc = replace_once(fmc, literal, "                            source_tag,\n", f"build skeleton tag {literal.strip()}")

fmc = replace_once(
    fmc,
    "        3 => format!(\"FMC_PREMOVE_NISS_{}\", AXIS_NAMES[candidate.axis as usize]),\n        _ => \"FMC_UNKNOWN\".into(),",
    "        3 => format!(\"FMC_PREMOVE_NISS_{}\", AXIS_NAMES[candidate.axis as usize]),\n        4 => format!(\"FMC_HTR_EO_{}\", AXIS_NAMES[candidate.axis as usize]),\n        5 => format!(\"FMC_HTR_NISS_{}\", AXIS_NAMES[candidate.axis as usize]),\n        6 => format!(\"FMC_HTR_PREMOVE_{}\", AXIS_NAMES[candidate.axis as usize]),\n        7 => format!(\"FMC_HTR_PREMOVE_NISS_{}\", AXIS_NAMES[candidate.axis as usize]),\n        _ => \"FMC_UNKNOWN\".into(),",
    "candidate HTR source names",
)
fmc = replace_once(
    fmc,
    "        3 => format!(\"FMC_PREMOVE_NISS_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        _ => \"FMC_UNKNOWN\".into(),",
    "        3 => format!(\"FMC_PREMOVE_NISS_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        4 => format!(\"FMC_HTR_EO_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        5 => format!(\"FMC_HTR_NISS_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        6 => format!(\"FMC_HTR_PREMOVE_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        7 => format!(\"FMC_HTR_PREMOVE_NISS_{}\", AXIS_NAMES[skeleton.axis as usize]),\n        _ => \"FMC_UNKNOWN\".into(),",
    "skeleton HTR source names",
)
fmc_path.write_text(fmc)

lib = lib_path.read_text()
lib = replace_once(
    lib,
    "    #[serde(rename = \"enableMultiInsertion\", default)]\n    enable_multi_insertion: bool,",
    "    #[serde(rename = \"enableMultiInsertion\", default)]\n    enable_multi_insertion: bool,\n    #[serde(rename = \"enableHtrSkeletons\", default)]\n    enable_htr_skeletons: bool,",
    "lib HTR option",
)
lib = replace_once(
    lib,
    "        options.enable_multi_insertion,\n    );",
    "        options.enable_multi_insertion,\n        options.enable_htr_skeletons,\n    );",
    "lib solve_fmc HTR argument",
)
lib = replace_once(
    lib,
    "        \"multiInsertionCandidateCount\": result.multi_insertion_candidate_count,",
    "        \"multiInsertionCandidateCount\": result.multi_insertion_candidate_count,\n        \"htrCandidateCount\": result.candidates.iter().filter(|candidate| candidate.source_tag >= 4).count(),\n        \"htrSkeletonCount\": result.skeletons.iter().filter(|skeleton| skeleton.source_tag >= 4).count(),",
    "lib HTR diagnostics",
)
lib_path.write_text(lib)

wrapper = wrapper_path.read_text()
wrapper = replace_once(
    wrapper,
    "      enableMultiInsertion: options.enableMultiInsertion === true,",
    "      enableMultiInsertion: options.enableMultiInsertion === true,\n      enableHtrSkeletons: options.enableHtrSkeletons === true,",
    "wrapper HTR option",
)
wrapper_path.write_text(wrapper)

print("Applied FMC HTR skeleton transform")
