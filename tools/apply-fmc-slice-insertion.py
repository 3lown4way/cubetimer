from pathlib import Path
import re

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
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;",
    "const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;\n\n/// Maximum number of synthetic leave-slice relocation plans retained.\nconst FMC_SLICE_RELOCATION_LIMIT: usize = 64;",
    "slice constant",
)

slice_helpers = r'''

/// Exact E2, M2 and S2 edge-only double swaps in the repository cubie convention.
fn slice_residual_state(axis: u8) -> CubeState {
    let mut state = CubeState::solved();
    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 10), (9, 11)],  // E2
        1 => [(1, 5), (3, 7)],    // M2
        2 => [(0, 6), (2, 4)],    // S2
        _ => unreachable!(),
    };
    for (left, right) in swaps {
        state.ep.swap(left, right);
    }
    state
}

/// Opposite outer half turns which complete the corresponding slice half turn
/// up to a free whole-cube x2/y2/z2 rotation.
fn slice_outer_pair(axis: u8) -> [u8; 2] {
    match axis {
        0 => [2, 11],  // U2 D2 completes E2
        1 => [5, 14],  // R2 L2 completes M2
        2 => [8, 17],  // F2 B2 completes S2
        _ => unreachable!(),
    }
}

fn slice_rotation_target(axis: u8, tables: &TwophaseTables) -> CubeState {
    slice_residual_state(axis).apply_moves(&slice_outer_pair(axis), &tables.move_data)
}

fn classify_slice_leftover(state: &CubeState) -> Option<(u8, Vec<u8>)> {
    if state.co.iter().any(|&value| value != 0)
        || state.eo.iter().any(|&value| value != 0)
        || state
            .cp
            .iter()
            .enumerate()
            .any(|(position, &piece)| piece as usize != position)
    {
        return None;
    }
    for axis in 0..3u8 {
        let residual = slice_residual_state(axis);
        if state.ep == residual.ep {
            let positions = state
                .ep
                .iter()
                .enumerate()
                .filter_map(|(position, &piece)| {
                    (piece as usize != position).then_some(position as u8)
                })
                .collect();
            return Some((axis, positions));
        }
    }
    None
}

pub fn is_fmc_solved_up_to_rotation(state: &CubeState, tables: &TwophaseTables) -> bool {
    state.is_solved() || (0..3u8).any(|axis| *state == slice_rotation_target(axis, tables))
}
'''
fmc = replace_once(
    fmc,
    "\n#[derive(Clone, Debug)]\nstruct FmcMultiRelocationPlan",
    slice_helpers + "\n#[derive(Clone, Debug)]\nstruct FmcMultiRelocationPlan",
    "slice helper insertion",
)

new_relocation_builder = r'''fn build_multi_relocation_plans(
    tables: &TwophaseTables,
    three_cycle_algorithms: &std::collections::HashMap<FmcStateKey, Vec<u8>>,
) -> (Vec<FmcMultiRelocationPlan>, Vec<FmcMultiRelocationPlan>) {
    let mut corner_removals = Vec::<Vec<u8>>::new();
    let mut edge_removals = Vec::<Vec<u8>>::new();

    for algorithm in three_cycle_algorithms.values() {
        let removal = simplify_moves(&invert_moves(algorithm));
        let state = CubeState::solved().apply_moves(&removal, &tables.move_data);
        match classify_insertion_leftover(&state) {
            Some((FmcSkeletonKind::Corner3, _)) => corner_removals.push(removal),
            Some((FmcSkeletonKind::Edge3, _)) => edge_removals.push(removal),
            _ => {}
        }
    }

    corner_removals.sort_by_key(|moves| (moves.len(), moves.clone()));
    corner_removals.dedup();
    edge_removals.sort_by_key(|moves| (moves.len(), moves.clone()));
    edge_removals.dedup();

    let mut shortest_by_state =
        std::collections::HashMap::<FmcStateKey, FmcMultiRelocationPlan>::new();
    let mut slice_by_state =
        std::collections::HashMap::<FmcStateKey, FmcMultiRelocationPlan>::new();

    let mut consider_pair = |first: &[u8], second: &[u8]| {
        let mut moves = Vec::with_capacity(first.len() + second.len());
        moves.extend_from_slice(first);
        moves.extend_from_slice(second);
        let moves = simplify_moves(&moves);
        if moves.is_empty() {
            return;
        }
        let state = CubeState::solved().apply_moves(&moves, &tables.move_data);
        let Some((kind, defect_positions)) = classify_insertion_leftover(&state) else {
            return;
        };
        let key = fmc_state_key(&state);
        let plan = FmcMultiRelocationPlan {
            moves,
            kind,
            defect_positions,
        };
        let destination = if kind == FmcSkeletonKind::Slice {
            &mut slice_by_state
        } else if kind.is_multi_insertion() {
            &mut shortest_by_state
        } else {
            return;
        };
        match destination.entry(key) {
            std::collections::hash_map::Entry::Vacant(entry) => {
                entry.insert(plan);
            }
            std::collections::hash_map::Entry::Occupied(mut entry) => {
                let current = entry.get();
                if (plan.moves.len(), plan.moves.clone())
                    < (current.moves.len(), current.moves.clone())
                {
                    entry.insert(plan);
                }
            }
        }
    };

    for first in &corner_removals {
        for second in &corner_removals {
            consider_pair(first, second);
        }
    }
    for first in &edge_removals {
        for second in &edge_removals {
            consider_pair(first, second);
        }
    }
    for first in &corner_removals {
        for second in &edge_removals {
            consider_pair(first, second);
        }
    }

    let mut multi = Vec::new();
    for kind in [
        FmcSkeletonKind::Corner4,
        FmcSkeletonKind::Edge4,
        FmcSkeletonKind::Corner3Edge3,
    ] {
        let mut plans: Vec<FmcMultiRelocationPlan> = shortest_by_state
            .values()
            .filter(|plan| plan.kind == kind)
            .cloned()
            .collect();
        plans.sort_by_key(|plan| {
            (
                plan.moves.len(),
                plan.defect_positions.clone(),
                plan.moves.clone(),
            )
        });
        plans.truncate(FMC_MULTI_RELOCATION_PER_KIND_LIMIT);
        multi.extend(plans);
    }

    let mut slice: Vec<FmcMultiRelocationPlan> = slice_by_state.into_values().collect();
    slice.sort_by_key(|plan| {
        (
            plan.moves.len(),
            plan.defect_positions.clone(),
            plan.moves.clone(),
        )
    });
    slice.truncate(FMC_SLICE_RELOCATION_LIMIT);
    (multi, slice)
}

pub struct FmcTables'''
fmc, count = re.subn(
    r"fn build_multi_relocation_plans\([\s\S]*?\n}\n\npub struct FmcTables",
    new_relocation_builder,
    fmc,
    count=1,
)
if count != 1:
    raise SystemExit(f"relocation builder replacement: found {count}")

fmc = replace_once(
    fmc,
    "    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.\n    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,",
    "    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.\n    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,\n    /// Exact E2/M2/S2 leave-slice relocation plans.\n    slice_relocation_plans: Vec<FmcMultiRelocationPlan>,",
    "slice table field",
)
fmc = replace_once(
    fmc,
    "    pub fn multi_relocation_plan_count(&self) -> usize {\n        self.multi_relocation_plans.len()\n    }",
    "    pub fn multi_relocation_plan_count(&self) -> usize {\n        self.multi_relocation_plans.len()\n    }\n\n    pub fn slice_relocation_plan_count(&self) -> usize {\n        self.slice_relocation_plans.len()\n    }",
    "slice table count",
)
fmc = replace_once(
    fmc,
    "    let multi_relocation_plans = build_multi_relocation_plans(tables, &three_cycle_algorithms);",
    "    let (multi_relocation_plans, slice_relocation_plans) =\n        build_multi_relocation_plans(tables, &three_cycle_algorithms);",
    "slice table build",
)
fmc = replace_once(
    fmc,
    "        multi_relocation_plans,\n        htr_first_move: OnceCell::new(),",
    "        multi_relocation_plans,\n        slice_relocation_plans,\n        htr_first_move: OnceCell::new(),",
    "slice table init",
)

fmc = replace_once(
    fmc,
    "    Corner2Edge2,\n    Corner4,",
    "    Corner2Edge2,\n    Slice,\n    Corner4,",
    "slice enum",
)
fmc = replace_once(
    fmc,
    "            Self::Corner2Edge2 => \"corner2edge2\",\n            Self::Corner4 => \"corner4\",",
    "            Self::Corner2Edge2 => \"corner2edge2\",\n            Self::Slice => \"slice\",\n            Self::Corner4 => \"corner4\",",
    "slice enum string",
)
fmc = replace_once(
    fmc,
    "            Self::Corner2Edge2 => 2,\n            Self::Corner4 => 3,\n            Self::Edge4 => 4,\n            Self::Corner3Edge3 => 5,",
    "            Self::Corner2Edge2 => 2,\n            Self::Slice => 3,\n            Self::Corner4 => 4,\n            Self::Edge4 => 5,\n            Self::Corner3Edge3 => 6,",
    "slice rank",
)
fmc = replace_once(
    fmc,
    "            Self::Corner3 | Self::Edge3 => 8,\n            Self::Corner2Edge2 => 14,\n            Self::Corner4 | Self::Edge4 | Self::Corner3Edge3 => 16,",
    "            Self::Slice => 2,\n            Self::Corner3 | Self::Edge3 => 8,\n            Self::Corner2Edge2 => 14,\n            Self::Corner4 | Self::Edge4 | Self::Corner3Edge3 => 16,",
    "slice estimated cost",
)
fmc = replace_once(
    fmc,
    "        matches!(self, Self::Corner3 | Self::Edge3 | Self::Corner2Edge2)",
    "        matches!(\n            self,\n            Self::Corner3 | Self::Edge3 | Self::Corner2Edge2 | Self::Slice\n        )",
    "slice single insertion",
)

fmc = replace_once(
    fmc,
    "fn classify_insertion_leftover(state: &CubeState) -> Option<(FmcSkeletonKind, Vec<u8>)> {\n    if state.co.iter().any(|&v| v != 0) || state.eo.iter().any(|&v| v != 0) {",
    "fn classify_insertion_leftover(state: &CubeState) -> Option<(FmcSkeletonKind, Vec<u8>)> {\n    if let Some((_axis, positions)) = classify_slice_leftover(state) {\n        return Some((FmcSkeletonKind::Slice, positions));\n    }\n    if state.co.iter().any(|&v| v != 0) || state.eo.iter().any(|&v| v != 0) {",
    "slice classifier",
)

slice_synthesis = r'''

fn synthesize_slice_relocation_skeletons(
    candidates: &[FmcCandidate],
    fmc_tables: &FmcTables,
) -> Vec<FmcSkeletonCandidate> {
    let mut base_candidates = candidates.to_vec();
    base_candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.source_tag,
            candidate.axis,
            candidate.moves.clone(),
        )
    });
    let mut seen_solutions = std::collections::HashSet::new();
    base_candidates.retain(|candidate| seen_solutions.insert(candidate.moves.clone()));
    base_candidates.truncate(6);

    let mut output = Vec::new();
    for candidate in base_candidates {
        for plan in &fmc_tables.slice_relocation_plans {
            let mut skeleton_moves = Vec::with_capacity(candidate.moves.len() + plan.moves.len());
            skeleton_moves.extend_from_slice(&candidate.moves);
            skeleton_moves.extend_from_slice(&plan.moves);
            let skeleton_moves = simplify_moves(&skeleton_moves);
            if skeleton_moves.is_empty() {
                continue;
            }
            output.push(FmcSkeletonCandidate {
                moves: skeleton_moves,
                kind: FmcSkeletonKind::Slice,
                defect_positions: plan.defect_positions.clone(),
                eo_len: candidate.eo_len,
                dr_len: candidate.dr_len,
                p2_len: candidate.p2_len,
                axis: candidate.axis,
                source_tag: candidate.source_tag,
                premove_moves: candidate.premove_moves.clone(),
                rzp_used: candidate.rzp_used,
            });
        }
    }
    output
}
'''
fmc = replace_once(
    fmc,
    "\nfn single_algorithm_library<'a>(",
    slice_synthesis + "\nfn single_algorithm_library<'a>(",
    "slice synthesis",
)

best_slice = r'''

fn best_slice_insertion(
    scramble_state: &CubeState,
    skeleton: &FmcSkeletonCandidate,
    origin_kind: FmcSkeletonKind,
    prior_steps: &[FmcInsertionStep],
    tables: &TwophaseTables,
) -> Option<FmcCandidate> {
    let move_count = skeleton.moves.len();
    let rotation_targets: [CubeState; 3] =
        std::array::from_fn(|axis| slice_rotation_target(axis as u8, tables));
    let mut best: Option<(Vec<u8>, Vec<u8>, usize)> = None;

    for position in 0..=move_count {
        for slice_axis in 0..3u8 {
            let algorithm = slice_outer_pair(slice_axis).to_vec();
            let mut full = Vec::with_capacity(move_count + algorithm.len());
            full.extend_from_slice(&skeleton.moves[..position]);
            full.extend_from_slice(&algorithm);
            full.extend_from_slice(&skeleton.moves[position..]);
            let full = simplify_moves(&full);
            let final_state = scramble_state.apply_moves(&full, &tables.move_data);
            if !rotation_targets.iter().any(|target| *target == final_state) {
                continue;
            }
            let replace = best
                .as_ref()
                .is_none_or(|(current, current_algorithm, current_pos)| {
                    (full.len(), algorithm.len(), position)
                        < (current.len(), current_algorithm.len(), *current_pos)
                });
            if replace {
                best = Some((full, algorithm, position));
            }
        }
    }

    let (moves, insertion_moves, insertion_position) = best?;
    let mut insertion_steps = prior_steps.to_vec();
    insertion_steps.push(FmcInsertionStep {
        kind: FmcSkeletonKind::Slice,
        moves: insertion_moves.clone(),
        position: insertion_position.min(u8::MAX as usize) as u8,
    });
    let finish_moves = insertion_steps
        .iter()
        .flat_map(|step| step.moves.iter().copied())
        .collect();

    Some(FmcCandidate {
        moves,
        eo_len: skeleton.eo_len,
        dr_len: skeleton.dr_len,
        p2_len: skeleton.p2_len,
        eo_moves: vec![],
        dr_moves: vec![],
        finish_moves,
        axis: skeleton.axis,
        source_tag: skeleton.source_tag,
        premove_moves: skeleton.premove_moves.clone(),
        rzp_used: skeleton.rzp_used,
        insertion_moves: insertion_steps[0].moves.clone(),
        insertion_position: Some(insertion_steps[0].position),
        skeleton_kind: Some(origin_kind),
        insertion_steps,
    })
}

fn complete_single_insertion(
    scramble_state: &CubeState,
    skeleton: &FmcSkeletonCandidate,
    origin_kind: FmcSkeletonKind,
    prior_steps: &[FmcInsertionStep],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Option<FmcCandidate> {
    if skeleton.kind == FmcSkeletonKind::Slice {
        best_slice_insertion(scramble_state, skeleton, origin_kind, prior_steps, tables)
    } else {
        best_single_insertion(
            scramble_state,
            skeleton,
            origin_kind,
            prior_steps,
            tables,
            fmc_tables,
        )
    }
}
'''
fmc = replace_once(
    fmc,
    "\nfn optimize_skeleton_insertions(\n",
    best_slice + "\nfn optimize_skeleton_insertions(\n",
    "best slice insertion",
)

old_opt = r'''    skeletons
        .iter()
        .filter(|skeleton| skeleton.kind.is_single_insertion())
        .filter_map(|skeleton| {
            best_single_insertion(
                scramble_state,
                skeleton,
                skeleton.kind,
                &[],
                tables,
                fmc_tables,
            )
        })
        .collect()'''
new_opt = r'''    skeletons
        .iter()
        .filter(|skeleton| skeleton.kind.is_single_insertion())
        .filter_map(|skeleton| {
            complete_single_insertion(
                scramble_state,
                skeleton,
                skeleton.kind,
                &[],
                tables,
                fmc_tables,
            )
        })
        .collect()'''
fmc = replace_once(fmc, old_opt, new_opt, "slice optimizer dispatch")
fmc = replace_once(
    fmc,
    "            let Some(candidate) = best_single_insertion(\n                scramble_state,\n                &residual,\n                skeleton.kind,\n                &[first_step],\n                tables,\n                fmc_tables,\n            ) else {",
    "            let Some(candidate) = complete_single_insertion(\n                scramble_state,\n                &residual,\n                skeleton.kind,\n                &[first_step],\n                tables,\n                fmc_tables,\n            ) else {",
    "slice residual dispatch",
)

fmc = replace_once(
    fmc,
    "    pub multi_insertion_candidate_count: usize,\n}",
    "    pub multi_insertion_candidate_count: usize,\n    pub slice_insertion_candidate_count: usize,\n}",
    "slice result field",
)
# Error result constructor appears once.
fmc = replace_once(
    fmc,
    "                multi_insertion_candidate_count: 0,\n            }",
    "                multi_insertion_candidate_count: 0,\n                slice_insertion_candidate_count: 0,\n            }",
    "slice error result",
)

fmc = replace_once(
    fmc,
    "    enable_multi_insertion: bool,\n    enable_htr_skeletons: bool,\n) -> FmcResult {",
    "    enable_multi_insertion: bool,\n    enable_htr_skeletons: bool,\n    enable_slice_insertion: bool,\n) -> FmcResult {",
    "slice solve option",
)

fmc = replace_once(
    fmc,
    "    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);\n    all_skeletons.extend(relocation_skeletons);",
    "    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);\n    all_skeletons.extend(relocation_skeletons);\n    if enable_slice_insertion {\n        let slice_skeletons = synthesize_slice_relocation_skeletons(&all_candidates, fmc_tables);\n        all_skeletons.extend(slice_skeletons);\n    } else {\n        all_skeletons.retain(|skeleton| skeleton.kind != FmcSkeletonKind::Slice);\n    }",
    "slice solve synthesis",
)

fmc = replace_once(
    fmc,
    "    let multi_insertion_candidate_count = multi_inserted_candidates.len();\n    let insertion_candidate_count = inserted_candidates.len() + multi_insertion_candidate_count;",
    "    let slice_insertion_candidate_count = inserted_candidates\n        .iter()\n        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Slice))\n        .count();\n    let multi_insertion_candidate_count = multi_inserted_candidates.len();\n    let insertion_candidate_count = inserted_candidates.len() + multi_insertion_candidate_count;",
    "slice candidate count",
)
fmc = replace_once(
    fmc,
    "        multi_insertion_candidate_count,\n    }",
    "        multi_insertion_candidate_count,\n        slice_insertion_candidate_count,\n    }",
    "slice final result",
)

# JSON defect split and source metadata.
fmc = replace_once(
    fmc,
    "        FmcSkeletonKind::Corner4 => (skeleton.defect_positions.clone(), vec![]),",
    "        FmcSkeletonKind::Slice => (vec![], skeleton.defect_positions.clone()),\n        FmcSkeletonKind::Corner4 => (skeleton.defect_positions.clone(), vec![]),",
    "slice skeleton json",
)

fmc_path.write_text(fmc)

lib = lib_path.read_text()
lib = replace_once(
    lib,
    "    let multi_relocation_plan_count = fmc.multi_relocation_plan_count();",
    "    let multi_relocation_plan_count = fmc.multi_relocation_plan_count();\n    let slice_relocation_plan_count = fmc.slice_relocation_plan_count();",
    "slice table diagnostic local",
)
lib = replace_once(
    lib,
    "        \"multiRelocationPlanCount\": multi_relocation_plan_count,",
    "        \"multiRelocationPlanCount\": multi_relocation_plan_count,\n        \"sliceRelocationPlanCount\": slice_relocation_plan_count,",
    "slice table diagnostic json",
)
lib = replace_once(
    lib,
    "    #[serde(rename = \"enableHtrSkeletons\", default)]\n    enable_htr_skeletons: bool,",
    "    #[serde(rename = \"enableHtrSkeletons\", default)]\n    enable_htr_skeletons: bool,\n    #[serde(rename = \"enableSliceInsertion\", default)]\n    enable_slice_insertion: bool,",
    "slice option json",
)
lib = replace_once(
    lib,
    "        options.enable_htr_skeletons,\n    );",
    "        options.enable_htr_skeletons,\n        options.enable_slice_insertion,\n    );",
    "slice solve argument",
)
lib = replace_once(
    lib,
    "        \"multiInsertionCandidateCount\": result.multi_insertion_candidate_count,",
    "        \"multiInsertionCandidateCount\": result.multi_insertion_candidate_count,\n        \"sliceInsertionCandidateCount\": result.slice_insertion_candidate_count,",
    "slice result diagnostic",
)
lib = replace_once(
    lib,
    "    use minmove_core::{parse_scramble as parse_moves_minmove, CubeState};",
    "    use minmove_core::{parse_scramble as parse_moves_minmove, CubeState};\n    use fmc_search::is_fmc_solved_up_to_rotation;",
    "slice verifier import",
)
lib = replace_once(
    lib,
    "            let solved = CubeState::solved()\n                .apply_moves(&moves, &tables.move_data)\n                .is_solved();",
    "            let final_state = CubeState::solved().apply_moves(&moves, &tables.move_data);\n            let solved = is_fmc_solved_up_to_rotation(&final_state, tables);",
    "slice verifier",
)
lib_path.write_text(lib)

wrapper = wrapper_path.read_text()
wrapper = replace_once(
    wrapper,
    "      enableHtrSkeletons: options.enableHtrSkeletons === true,",
    "      enableHtrSkeletons: options.enableHtrSkeletons === true,\n      enableSliceInsertion: options.enableSliceInsertion === true,",
    "slice wrapper option",
)
wrapper_path.write_text(wrapper)

print("Applied FMC slice insertion transform")
