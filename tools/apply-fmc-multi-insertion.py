from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()

def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match, found {count}: {old[:120]!r}")
    text = text.replace(old, new, 1)

if "Corner3Edge3" in text and "optimize_multi_skeleton_insertions" in text:
    print("FMC multi-insertion transform already applied")
    raise SystemExit(0)

replace_once(
r'''/// Cap synthetic 2C2E relocation skeletons after deterministic length sorting.
const FMC_RELOCATION_2C2E_LIMIT: usize = 256;
''',
r'''/// Cap synthetic 2C2E relocation skeletons after deterministic length sorting.
const FMC_RELOCATION_2C2E_LIMIT: usize = 256;

/// Retain a bounded, diverse set of guaranteed two-insertion relocation plans
/// for each multi-leftover family.
const FMC_MULTI_RELOCATION_PER_KIND_LIMIT: usize = 128;

/// Only the best first-insertion transitions are expanded with a second
/// insertion search for each multi skeleton.
const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;
''',
)

replace_once(
r'''#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FmcSkeletonKind {
    Corner3,
    Edge3,
    Corner2Edge2,
}

impl FmcSkeletonKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Corner3 => "corner3",
            Self::Edge3 => "edge3",
            Self::Corner2Edge2 => "corner2edge2",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Corner3 => 0,
            Self::Edge3 => 1,
            Self::Corner2Edge2 => 2,
        }
    }

    fn estimated_insertion_cost(self) -> usize {
        match self {
            Self::Corner3 | Self::Edge3 => 8,
            Self::Corner2Edge2 => 14,
        }
    }
}
''',
r'''#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FmcSkeletonKind {
    Corner3,
    Edge3,
    Corner2Edge2,
    Corner4,
    Edge4,
    Corner3Edge3,
}

impl FmcSkeletonKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Corner3 => "corner3",
            Self::Edge3 => "edge3",
            Self::Corner2Edge2 => "corner2edge2",
            Self::Corner4 => "corner4",
            Self::Edge4 => "edge4",
            Self::Corner3Edge3 => "corner3edge3",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Corner3 => 0,
            Self::Edge3 => 1,
            Self::Corner2Edge2 => 2,
            Self::Corner4 => 3,
            Self::Edge4 => 4,
            Self::Corner3Edge3 => 5,
        }
    }

    fn estimated_insertion_cost(self) -> usize {
        match self {
            Self::Corner3 | Self::Edge3 => 8,
            Self::Corner2Edge2 => 14,
            Self::Corner4 | Self::Edge4 | Self::Corner3Edge3 => 16,
        }
    }

    fn is_single_insertion(self) -> bool {
        matches!(self, Self::Corner3 | Self::Edge3 | Self::Corner2Edge2)
    }

    fn is_multi_insertion(self) -> bool {
        matches!(self, Self::Corner4 | Self::Edge4 | Self::Corner3Edge3)
    }
}
''',
)

replace_once(
r'''    match (corner_misplaced.len(), edge_misplaced.len()) {
        (3, 0) => Some((FmcSkeletonKind::Corner3, corner_misplaced)),
        (0, 3) => Some((FmcSkeletonKind::Edge3, edge_misplaced)),
        (2, 2) => {
            let mut positions = corner_misplaced;
            positions.extend_from_slice(&edge_misplaced);
            Some((FmcSkeletonKind::Corner2Edge2, positions))
        }
        _ => None,
    }
''',
r'''    match (corner_misplaced.len(), edge_misplaced.len()) {
        (3, 0) => Some((FmcSkeletonKind::Corner3, corner_misplaced)),
        (0, 3) => Some((FmcSkeletonKind::Edge3, edge_misplaced)),
        (2, 2) => {
            let mut positions = corner_misplaced;
            positions.extend_from_slice(&edge_misplaced);
            Some((FmcSkeletonKind::Corner2Edge2, positions))
        }
        (4, 0) => Some((FmcSkeletonKind::Corner4, corner_misplaced)),
        (0, 4) => Some((FmcSkeletonKind::Edge4, edge_misplaced)),
        (3, 3) => {
            let mut positions = corner_misplaced;
            positions.extend_from_slice(&edge_misplaced);
            Some((FmcSkeletonKind::Corner3Edge3, positions))
        }
        _ => None,
    }
''',
)

replace_once(
r'''#[derive(Clone, Debug)]
pub struct FmcCandidate {
''',
r'''#[derive(Clone, Debug)]
pub struct FmcInsertionStep {
    pub kind: FmcSkeletonKind,
    pub moves: Vec<u8>,
    pub position: u8,
}

#[derive(Clone, Debug)]
pub struct FmcCandidate {
''',
)

replace_once(
r'''    pub insertion_position: Option<u8>,
    pub skeleton_kind: Option<FmcSkeletonKind>,
}
''',
r'''    pub insertion_position: Option<u8>,
    pub skeleton_kind: Option<FmcSkeletonKind>,
    pub insertion_steps: Vec<FmcInsertionStep>,
}
''',
)

replace_once(
r'''    pub insertion_candidate_count: usize,
    pub mixed_insertion_candidate_count: usize,
}
''',
r'''    pub insertion_candidate_count: usize,
    pub mixed_insertion_candidate_count: usize,
    pub multi_insertion_candidate_count: usize,
}
''',
)

text = text.replace(
    "skeleton_kind: None,\n",
    "skeleton_kind: None,\n                            insertion_steps: vec![],\n",
)

replace_once(
r'''    for kind in [
        FmcSkeletonKind::Corner3,
        FmcSkeletonKind::Edge3,
        FmcSkeletonKind::Corner2Edge2,
    ] {
''',
r'''    for kind in [
        FmcSkeletonKind::Corner3,
        FmcSkeletonKind::Edge3,
        FmcSkeletonKind::Corner2Edge2,
        FmcSkeletonKind::Corner4,
        FmcSkeletonKind::Edge4,
        FmcSkeletonKind::Corner3Edge3,
    ] {
''',
)

replace_once(
r'''    result
}

pub struct FmcTables {
''',
r'''    result
}

#[derive(Clone, Debug)]
struct FmcMultiRelocationPlan {
    moves: Vec<u8>,
    kind: FmcSkeletonKind,
    defect_positions: Vec<u8>,
}

fn build_multi_relocation_plans(
    tables: &TwophaseTables,
    three_cycle_algorithms: &std::collections::HashMap<FmcStateKey, Vec<u8>>,
) -> Vec<FmcMultiRelocationPlan> {
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
        if !kind.is_multi_insertion() {
            return;
        }
        let key = fmc_state_key(&state);
        let plan = FmcMultiRelocationPlan {
            moves,
            kind,
            defect_positions,
        };
        match shortest_by_state.entry(key) {
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

    let mut result = Vec::new();
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
        result.extend(plans);
    }
    result
}

pub struct FmcTables {
''',
)

replace_once(
r'''    /// PLL-style algorithms indexed by exact orientation-preserving 2C2E state.
    pub two_corner_two_edge_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,
}
''',
r'''    /// PLL-style algorithms indexed by exact orientation-preserving 2C2E state.
    pub two_corner_two_edge_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,
    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.
    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,
}

impl FmcTables {
    pub fn multi_relocation_plan_count(&self) -> usize {
        self.multi_relocation_plans.len()
    }
}
''',
)

replace_once(
r'''    let three_cycle_algorithms = build_three_cycle_algorithms(tables);
    let two_corner_two_edge_algorithms = build_two_corner_two_edge_algorithms(tables);

    FmcTables {
''',
r'''    let three_cycle_algorithms = build_three_cycle_algorithms(tables);
    let two_corner_two_edge_algorithms = build_two_corner_two_edge_algorithms(tables);
    let multi_relocation_plans =
        build_multi_relocation_plans(tables, &three_cycle_algorithms);

    FmcTables {
''',
)

replace_once(
r'''        three_cycle_algorithms,
        two_corner_two_edge_algorithms,
    }
}
''',
r'''        three_cycle_algorithms,
        two_corner_two_edge_algorithms,
        multi_relocation_plans,
    }
}
''',
)

replace_once(
r'''    output
}

fn optimize_skeleton_insertions(
''',
r'''    output
}

fn synthesize_multi_relocation_skeletons(
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
    base_candidates.truncate(4);

    let mut output = Vec::new();
    for candidate in base_candidates {
        for plan in &fmc_tables.multi_relocation_plans {
            let mut skeleton_moves =
                Vec::with_capacity(candidate.moves.len() + plan.moves.len());
            skeleton_moves.extend_from_slice(&candidate.moves);
            skeleton_moves.extend_from_slice(&plan.moves);
            let skeleton_moves = simplify_moves(&skeleton_moves);
            if skeleton_moves.is_empty() {
                continue;
            }
            output.push(FmcSkeletonCandidate {
                moves: skeleton_moves,
                kind: plan.kind,
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

fn single_algorithm_library<'a>(
    kind: FmcSkeletonKind,
    fmc_tables: &'a FmcTables,
) -> Option<&'a std::collections::HashMap<FmcStateKey, Vec<u8>>> {
    match kind {
        FmcSkeletonKind::Corner3 | FmcSkeletonKind::Edge3 => {
            Some(&fmc_tables.three_cycle_algorithms)
        }
        FmcSkeletonKind::Corner2Edge2 => Some(&fmc_tables.two_corner_two_edge_algorithms),
        _ => None,
    }
}

fn best_single_insertion(
    scramble_state: &CubeState,
    skeleton: &FmcSkeletonCandidate,
    origin_kind: FmcSkeletonKind,
    prior_steps: &[FmcInsertionStep],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Option<FmcCandidate> {
    let algorithms = single_algorithm_library(skeleton.kind, fmc_tables)?;
    let move_count = skeleton.moves.len();
    let mut prefix_states = Vec::with_capacity(move_count + 1);
    prefix_states.push(*scramble_state);
    for &move_index in &skeleton.moves {
        let next = prefix_states
            .last()
            .unwrap()
            .apply_move(move_index as usize, &tables.move_data);
        prefix_states.push(next);
    }

    let mut target_states = vec![CubeState::solved(); move_count + 1];
    for index in (0..move_count).rev() {
        target_states[index] = target_states[index + 1].apply_move(
            MOVE_INVERSE[skeleton.moves[index] as usize] as usize,
            &tables.move_data,
        );
    }

    let mut best: Option<(Vec<u8>, Vec<u8>, usize)> = None;
    for position in 0..=move_count {
        let relative = relative_cube_state(&prefix_states[position], &target_states[position]);
        let Some(algorithm) = algorithms.get(&fmc_state_key(&relative)) else {
            continue;
        };

        let mut full = Vec::with_capacity(move_count + algorithm.len());
        full.extend_from_slice(&skeleton.moves[..position]);
        full.extend_from_slice(algorithm);
        full.extend_from_slice(&skeleton.moves[position..]);
        let full = simplify_moves(&full);
        if !scramble_state
            .apply_moves(&full, &tables.move_data)
            .is_solved()
        {
            continue;
        }

        let replace = best
            .as_ref()
            .is_none_or(|(current, current_algorithm, current_pos)| {
                (full.len(), algorithm.len(), position)
                    < (current.len(), current_algorithm.len(), *current_pos)
            });
        if replace {
            best = Some((full, algorithm.clone(), position));
        }
    }

    let (moves, insertion_moves, insertion_position) = best?;
    let mut insertion_steps = prior_steps.to_vec();
    insertion_steps.push(FmcInsertionStep {
        kind: skeleton.kind,
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

fn optimize_skeleton_insertions(
''',
)

start = text.index("fn optimize_skeleton_insertions(")
end = text.index("\n// --- Full FMC Solver ---", start)
new_block = r'''fn optimize_skeleton_insertions(
    scramble_state: &CubeState,
    skeletons: &[FmcSkeletonCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcCandidate> {
    skeletons
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
        .collect()
}

fn optimize_multi_skeleton_insertions(
    scramble_state: &CubeState,
    skeletons: &[FmcSkeletonCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcCandidate> {
    let mut three_cycle_algorithms = Vec::<(FmcSkeletonKind, Vec<u8>)>::new();
    for algorithm in fmc_tables.three_cycle_algorithms.values() {
        let state = CubeState::solved().apply_moves(algorithm, &tables.move_data);
        let Some((kind, _)) = classify_insertion_leftover(&state) else {
            continue;
        };
        if matches!(kind, FmcSkeletonKind::Corner3 | FmcSkeletonKind::Edge3) {
            three_cycle_algorithms.push((kind, algorithm.clone()));
        }
    }
    three_cycle_algorithms.sort_by_key(|(kind, moves)| (kind.rank(), moves.len(), moves.clone()));
    three_cycle_algorithms.dedup();

    let mut completed = Vec::new();
    for skeleton in skeletons
        .iter()
        .filter(|skeleton| skeleton.kind.is_multi_insertion())
    {
        let mut transitions = Vec::<(
            usize,
            Vec<u8>,
            FmcSkeletonCandidate,
            FmcInsertionStep,
        )>::new();

        for position in 0..=skeleton.moves.len() {
            for (algorithm_kind, algorithm) in &three_cycle_algorithms {
                let compatible = match skeleton.kind {
                    FmcSkeletonKind::Corner4 => *algorithm_kind == FmcSkeletonKind::Corner3,
                    FmcSkeletonKind::Edge4 => *algorithm_kind == FmcSkeletonKind::Edge3,
                    FmcSkeletonKind::Corner3Edge3 => true,
                    _ => false,
                };
                if !compatible {
                    continue;
                }

                let mut first_full =
                    Vec::with_capacity(skeleton.moves.len() + algorithm.len());
                first_full.extend_from_slice(&skeleton.moves[..position]);
                first_full.extend_from_slice(algorithm);
                first_full.extend_from_slice(&skeleton.moves[position..]);
                let first_full = simplify_moves(&first_full);
                if first_full.is_empty() {
                    continue;
                }

                let residual_state =
                    scramble_state.apply_moves(&first_full, &tables.move_data);
                let Some((residual_kind, defect_positions)) =
                    classify_insertion_leftover(&residual_state)
                else {
                    continue;
                };
                if !residual_kind.is_single_insertion() {
                    continue;
                }

                let estimated = first_full.len() + residual_kind.estimated_insertion_cost();
                let residual = FmcSkeletonCandidate {
                    moves: first_full.clone(),
                    kind: residual_kind,
                    defect_positions,
                    eo_len: skeleton.eo_len,
                    dr_len: skeleton.dr_len,
                    p2_len: skeleton.p2_len,
                    axis: skeleton.axis,
                    source_tag: skeleton.source_tag,
                    premove_moves: skeleton.premove_moves.clone(),
                    rzp_used: skeleton.rzp_used,
                };
                let first_step = FmcInsertionStep {
                    kind: *algorithm_kind,
                    moves: algorithm.clone(),
                    position: position.min(u8::MAX as usize) as u8,
                };
                transitions.push((estimated, first_full, residual, first_step));
            }
        }

        transitions.sort_by_key(|(estimated, moves, residual, step)| {
            (
                *estimated,
                moves.len(),
                residual.kind.rank(),
                step.moves.len(),
                step.position,
                moves.clone(),
            )
        });
        let mut seen = std::collections::HashSet::new();
        transitions.retain(|(_, moves, residual, _)| {
            seen.insert((moves.clone(), residual.kind, residual.defect_positions.clone()))
        });
        transitions.truncate(FMC_MULTI_FIRST_STAGE_LIMIT);

        let mut best: Option<FmcCandidate> = None;
        for (_, _, residual, first_step) in transitions {
            let Some(candidate) = best_single_insertion(
                scramble_state,
                &residual,
                skeleton.kind,
                &[first_step],
                tables,
                fmc_tables,
            ) else {
                continue;
            };
            let replace = best.as_ref().is_none_or(|current| {
                (
                    candidate.moves.len(),
                    candidate.insertion_steps.iter().map(|step| step.moves.len()).sum::<usize>(),
                    candidate.moves.clone(),
                ) < (
                    current.moves.len(),
                    current.insertion_steps.iter().map(|step| step.moves.len()).sum::<usize>(),
                    current.moves.clone(),
                )
            });
            if replace {
                best = Some(candidate);
            }
        }

        if let Some(candidate) = best {
            completed.push(candidate);
        }
    }
    completed
}
'''
text = text[:start] + new_block + text[end:]

replace_once(
r'''    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);
    all_skeletons.extend(relocation_skeletons);
    let skeletons = finalize_skeleton_beam(all_skeletons);
    let inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    let insertion_candidate_count = inserted_candidates.len();
    let mixed_insertion_candidate_count = inserted_candidates
        .iter()
        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Corner2Edge2))
        .count();
    all_candidates.extend(inserted_candidates);
''',
r'''    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);
    all_skeletons.extend(relocation_skeletons);
    let multi_relocation_skeletons =
        synthesize_multi_relocation_skeletons(&all_candidates, fmc_tables);
    all_skeletons.extend(multi_relocation_skeletons);
    let skeletons = finalize_skeleton_beam(all_skeletons);

    let inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    let single_best = all_candidates
        .iter()
        .chain(inserted_candidates.iter())
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    let mut multi_inserted_candidates =
        optimize_multi_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);

    let mixed_insertion_candidate_count = inserted_candidates
        .iter()
        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Corner2Edge2))
        .count();
    let multi_insertion_candidate_count = multi_inserted_candidates.len();
    let insertion_candidate_count =
        inserted_candidates.len() + multi_insertion_candidate_count;
    all_candidates.extend(inserted_candidates);
    all_candidates.extend(multi_inserted_candidates);
''',
)

replace_once(
r'''        insertion_candidate_count,
        mixed_insertion_candidate_count,
    }
}
''',
r'''        insertion_candidate_count,
        mixed_insertion_candidate_count,
        multi_insertion_candidate_count,
    }
}
''',
)

text = text.replace(
    "                mixed_insertion_candidate_count: 0,\n",
    "                mixed_insertion_candidate_count: 0,\n                multi_insertion_candidate_count: 0,\n",
)

replace_once(
r'''    let source = if let Some(kind) = candidate.skeleton_kind {
        format!(
            "FMC_INSERTION_{}_{}",
            kind.as_str().to_uppercase(),
            base_source
        )
    } else {
        base_source.clone()
    };
''',
r'''    let source = if let Some(kind) = candidate.skeleton_kind {
        let prefix = if candidate.insertion_steps.len() > 1 {
            "FMC_MULTI_INSERTION"
        } else {
            "FMC_INSERTION"
        };
        format!(
            "{}_{}_{}",
            prefix,
            kind.as_str().to_uppercase(),
            base_source
        )
    } else {
        base_source.clone()
    };
''',
)

replace_once(
r'''    if let (Some(kind), Some(position)) = (candidate.skeleton_kind, candidate.insertion_position) {
        let insertion_moves: Vec<&str> = candidate
            .insertion_moves
            .iter()
            .map(|&m| tables.move_data.move_names[m as usize].as_str())
            .collect();
        let object = value.as_object_mut().unwrap();
        object.insert("baseSource".into(), serde_json::json!(base_source));
        object.insert("skeletonKind".into(), serde_json::json!(kind.as_str()));
        object.insert("insertionPosition".into(), serde_json::json!(position));
        object.insert("insertionMoves".into(), serde_json::json!(insertion_moves));
        object.insert(
            "insertionLength".into(),
            serde_json::json!(candidate.insertion_moves.len()),
        );
    }
''',
r'''    if let (Some(kind), Some(position)) = (candidate.skeleton_kind, candidate.insertion_position) {
        let insertion_moves: Vec<&str> = candidate
            .insertion_moves
            .iter()
            .map(|&m| tables.move_data.move_names[m as usize].as_str())
            .collect();
        let insertions: Vec<serde_json::Value> = candidate
            .insertion_steps
            .iter()
            .map(|step| {
                let moves: Vec<&str> = step
                    .moves
                    .iter()
                    .map(|&m| tables.move_data.move_names[m as usize].as_str())
                    .collect();
                serde_json::json!({
                    "kind": step.kind.as_str(),
                    "position": step.position,
                    "moves": moves,
                    "length": step.moves.len(),
                })
            })
            .collect();
        let object = value.as_object_mut().unwrap();
        object.insert("baseSource".into(), serde_json::json!(base_source));
        object.insert("skeletonKind".into(), serde_json::json!(kind.as_str()));
        object.insert("insertionPosition".into(), serde_json::json!(position));
        object.insert("insertionMoves".into(), serde_json::json!(insertion_moves));
        object.insert(
            "insertionLength".into(),
            serde_json::json!(candidate.insertion_moves.len()),
        );
        object.insert(
            "insertionCount".into(),
            serde_json::json!(candidate.insertion_steps.len()),
        );
        object.insert("insertions".into(), serde_json::json!(insertions));
    }
''',
)

replace_once(
r'''        FmcSkeletonKind::Corner2Edge2 => (
            skeleton.defect_positions[..2].to_vec(),
            skeleton.defect_positions[2..].to_vec(),
        ),
    };
''',
r'''        FmcSkeletonKind::Corner2Edge2 => (
            skeleton.defect_positions[..2].to_vec(),
            skeleton.defect_positions[2..].to_vec(),
        ),
        FmcSkeletonKind::Corner4 => (skeleton.defect_positions.clone(), vec![]),
        FmcSkeletonKind::Edge4 => (vec![], skeleton.defect_positions.clone()),
        FmcSkeletonKind::Corner3Edge3 => (
            skeleton.defect_positions[..3].to_vec(),
            skeleton.defect_positions[3..].to_vec(),
        ),
    };
''',
)

replace_once(
r'''    #[test]
    fn rejects_mixed_or_oriented_defects() {
        let mut mixed = CubeState::solved();
        mixed.cp[0] = 1;
        mixed.cp[1] = 2;
        mixed.cp[2] = 0;
        mixed.ep[0] = 1;
        mixed.ep[1] = 2;
        mixed.ep[2] = 0;
        assert_eq!(classify_insertion_leftover(&mixed), None);

        let mut oriented = CubeState::solved();
''',
r'''    #[test]
    fn classifies_multi_insertion_leftovers() {
        let mut corner4 = CubeState::solved();
        corner4.cp[0] = 1;
        corner4.cp[1] = 2;
        corner4.cp[2] = 3;
        corner4.cp[3] = 0;
        assert_eq!(
            classify_insertion_leftover(&corner4),
            Some((FmcSkeletonKind::Corner4, vec![0, 1, 2, 3]))
        );

        let mut edge4 = CubeState::solved();
        edge4.ep[4] = 5;
        edge4.ep[5] = 6;
        edge4.ep[6] = 7;
        edge4.ep[7] = 4;
        assert_eq!(
            classify_insertion_leftover(&edge4),
            Some((FmcSkeletonKind::Edge4, vec![4, 5, 6, 7]))
        );

        let mut mixed = CubeState::solved();
        mixed.cp[0] = 1;
        mixed.cp[1] = 2;
        mixed.cp[2] = 0;
        mixed.ep[4] = 5;
        mixed.ep[5] = 6;
        mixed.ep[6] = 4;
        assert_eq!(
            classify_insertion_leftover(&mixed),
            Some((
                FmcSkeletonKind::Corner3Edge3,
                vec![0, 1, 2, 4, 5, 6]
            ))
        );
    }

    #[test]
    fn rejects_unsupported_or_oriented_defects() {
        let mut unsupported = CubeState::solved();
        unsupported.cp[0] = 1;
        unsupported.cp[1] = 2;
        unsupported.cp[2] = 0;
        unsupported.ep[0] = 1;
        unsupported.ep[1] = 0;
        assert_eq!(classify_insertion_leftover(&unsupported), None);

        let mut oriented = CubeState::solved();
''',
)

path.write_text(text)

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()

def replace_lib(old: str, new: str) -> None:
    global lib
    count = lib.count(old)
    if count != 1:
        raise RuntimeError(f"expected one lib match, found {count}: {old[:120]!r}")
    lib = lib.replace(old, new, 1)

replace_lib(
r'''    let two_corner_two_edge_algorithm_count = fmc.two_corner_two_edge_algorithms.len();
    drop(tables_guard);
''',
r'''    let two_corner_two_edge_algorithm_count = fmc.two_corner_two_edge_algorithms.len();
    let multi_relocation_plan_count = fmc.multi_relocation_plan_count();
    drop(tables_guard);
''',
)

replace_lib(
r'''        "twoCornerTwoEdgeAlgorithmCount": two_corner_two_edge_algorithm_count,
    })
''',
r'''        "twoCornerTwoEdgeAlgorithmCount": two_corner_two_edge_algorithm_count,
        "multiRelocationPlanCount": multi_relocation_plan_count,
    })
''',
)

replace_lib(
r'''        "mixedInsertionCandidateCount": result.mixed_insertion_candidate_count,
    })
''',
r'''        "mixedInsertionCandidateCount": result.mixed_insertion_candidate_count,
        "multiInsertionCandidateCount": result.multi_insertion_candidate_count,
    })
''',
)

lib_path.write_text(lib)
print("Applied FMC multi-insertion transform")
