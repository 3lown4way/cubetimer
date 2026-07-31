from pathlib import Path
import re

rust_path = Path("solver-wasm/src/fmc_search.rs")
lib_path = Path("solver-wasm/src/lib.rs")
js_path = Path("solver/fmcSolver.js")
rust = rust_path.read_text()
lib = lib_path.read_text()
js = js_path.read_text()

if "FMC_MULTI_GLOBAL_TRANSITION_LIMIT" in rust:
    raise SystemExit("global multi-insertion patch already applied")

old_constants = '''/// Only the best first-insertion transitions are expanded with a second
/// insertion search for each multi skeleton.
const FMC_MULTI_FIRST_STAGE_LIMIT: usize = 8;
'''
new_constants = '''/// A bounded but diverse first-insertion frontier is evaluated jointly with
/// every valid second-insertion boundary. This is deliberately much wider than
/// the legacy top-8 greedy handoff.
const FMC_MULTI_GLOBAL_TRANSITION_LIMIT: usize = 64;

/// Keep several globally ranked joint insertion results per raw skeleton so
/// later candidate verification is not forced back to one local optimum.
const FMC_MULTI_GLOBAL_RESULT_LIMIT_PER_SKELETON: usize = 4;
'''
if old_constants not in rust:
    raise SystemExit("multi insertion constants anchor not found")
rust = rust.replace(old_constants, new_constants, 1)

old_result_fields = '''    pub multi_insertion_candidate_count: usize,
    pub slice_insertion_candidate_count: usize,
'''
new_result_fields = '''    pub multi_insertion_candidate_count: usize,
    pub multi_insertion_transition_count: usize,
    pub multi_insertion_pair_count: usize,
    pub slice_insertion_candidate_count: usize,
'''
if old_result_fields not in rust:
    raise SystemExit("FmcResult fields anchor not found")
rust = rust.replace(old_result_fields, new_result_fields, 1)

start = rust.index("fn optimize_multi_skeleton_insertions(")
end = rust.index("\n// --- Full FMC Solver ---", start)
new_multi = r'''#[derive(Clone, Debug)]
struct FmcMultiTransition {
    residual_state_key: FmcStateKey,
    residual: FmcSkeletonCandidate,
    first_step: FmcInsertionStep,
    cancellation_gain: usize,
}

fn select_diverse_multi_transitions(
    mut transitions: Vec<FmcMultiTransition>,
) -> Vec<FmcMultiTransition> {
    transitions.sort_by_key(|transition| {
        (
            transition.residual.kind.rank(),
            transition.first_step.kind.rank(),
            transition.first_step.position,
            std::cmp::Reverse(transition.cancellation_gain),
            transition.residual.moves.len(),
            transition.first_step.moves.len(),
            transition.residual.moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    transitions.retain(|transition| {
        seen.insert((
            transition.residual_state_key,
            transition.residual.moves.clone(),
            transition.first_step.kind,
            transition.first_step.moves.clone(),
            transition.first_step.position,
        ))
    });

    let mut buckets = std::collections::BTreeMap::<(u8, u8, u8), Vec<FmcMultiTransition>>::new();
    for transition in transitions {
        let denominator = transition.residual.moves.len().saturating_add(1).max(1);
        let boundary_band = ((transition.first_step.position as usize * 8) / denominator)
            .min(7) as u8;
        buckets
            .entry((
                transition.residual.kind.rank(),
                transition.first_step.kind.rank(),
                boundary_band,
            ))
            .or_default()
            .push(transition);
    }
    for bucket in buckets.values_mut() {
        bucket.sort_by_key(|transition| {
            (
                std::cmp::Reverse(transition.cancellation_gain),
                transition.residual.moves.len(),
                transition.first_step.moves.len(),
                transition.first_step.position,
                transition.residual.moves.clone(),
            )
        });
    }

    let mut selected = Vec::new();
    let mut depth = 0usize;
    while selected.len() < FMC_MULTI_GLOBAL_TRANSITION_LIMIT {
        let mut advanced = false;
        for bucket in buckets.values() {
            if let Some(transition) = bucket.get(depth) {
                selected.push(transition.clone());
                advanced = true;
                if selected.len() >= FMC_MULTI_GLOBAL_TRANSITION_LIMIT {
                    break;
                }
            }
        }
        if !advanced {
            break;
        }
        depth += 1;
    }
    selected
}

fn enumerate_joint_second_insertions(
    scramble_state: &CubeState,
    origin_skeleton: &FmcSkeletonCandidate,
    residual: &FmcSkeletonCandidate,
    first_step: &FmcInsertionStep,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcCandidate> {
    let move_count = residual.moves.len();
    let mut completed = Vec::new();

    let mut push_candidate = |
        moves: Vec<u8>,
        second_kind: FmcSkeletonKind,
        insertion_moves: Vec<u8>,
        insertion_position: usize,
    | {
        let insertion_steps = vec![
            first_step.clone(),
            FmcInsertionStep {
                kind: second_kind,
                moves: insertion_moves,
                position: insertion_position.min(u8::MAX as usize) as u8,
            },
        ];
        completed.push(FmcCandidate {
            moves,
            eo_len: origin_skeleton.eo_len,
            dr_len: origin_skeleton.dr_len,
            p2_len: origin_skeleton.p2_len,
            eo_moves: origin_skeleton.eo_moves.clone(),
            dr_moves: origin_skeleton.dr_moves.clone(),
            finish_moves: origin_skeleton.finish_moves.clone(),
            axis: origin_skeleton.axis,
            source_tag: origin_skeleton.source_tag,
            premove_moves: origin_skeleton.premove_moves.clone(),
            rzp_used: origin_skeleton.rzp_used,
            skeleton_moves: origin_skeleton.moves.clone(),
            insertion_moves: first_step.moves.clone(),
            insertion_position: Some(first_step.position),
            skeleton_kind: Some(origin_skeleton.kind),
            insertion_steps,
        });
    };

    if residual.kind == FmcSkeletonKind::Slice {
        let rotation_targets: [CubeState; 3] =
            std::array::from_fn(|axis| slice_rotation_target(axis as u8, tables));
        for position in 0..=move_count {
            for slice_axis in 0..3u8 {
                let algorithm = slice_outer_pair(slice_axis).to_vec();
                let mut full = Vec::with_capacity(move_count + algorithm.len());
                full.extend_from_slice(&residual.moves[..position]);
                full.extend_from_slice(&algorithm);
                full.extend_from_slice(&residual.moves[position..]);
                let full = simplify_moves(&full);
                let final_state = scramble_state.apply_moves(&full, &tables.move_data);
                if rotation_targets.iter().any(|target| *target == final_state) {
                    push_candidate(full, FmcSkeletonKind::Slice, algorithm, position);
                }
            }
        }
    } else if let Some(algorithms) = single_algorithm_library(residual.kind, fmc_tables) {
        let mut prefix_states = Vec::with_capacity(move_count + 1);
        prefix_states.push(*scramble_state);
        for &move_index in &residual.moves {
            let next = prefix_states
                .last()
                .unwrap()
                .apply_move(move_index as usize, &tables.move_data);
            prefix_states.push(next);
        }

        let mut target_states = vec![CubeState::solved(); move_count + 1];
        for index in (0..move_count).rev() {
            target_states[index] = target_states[index + 1].apply_move(
                MOVE_INVERSE[residual.moves[index] as usize] as usize,
                &tables.move_data,
            );
        }

        for position in 0..=move_count {
            let relative = relative_cube_state(&prefix_states[position], &target_states[position]);
            let Some(algorithm) = algorithms.get(&fmc_state_key(&relative)) else {
                continue;
            };
            let mut full = Vec::with_capacity(move_count + algorithm.len());
            full.extend_from_slice(&residual.moves[..position]);
            full.extend_from_slice(algorithm);
            full.extend_from_slice(&residual.moves[position..]);
            let full = simplify_moves(&full);
            if scramble_state
                .apply_moves(&full, &tables.move_data)
                .is_solved()
            {
                push_candidate(full, residual.kind, algorithm.clone(), position);
            }
        }
    }

    completed.sort_by_key(|candidate| {
        let inserted = candidate
            .insertion_steps
            .iter()
            .map(|step| step.moves.len())
            .sum::<usize>();
        let raw = origin_skeleton.moves.len().saturating_add(inserted);
        let cancellation = raw.saturating_sub(candidate.moves.len());
        (
            candidate.moves.len(),
            std::cmp::Reverse(cancellation),
            inserted,
            candidate.insertion_steps[0].position,
            candidate.insertion_steps[1].position,
            candidate.moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    completed.retain(|candidate| seen.insert(candidate.moves.clone()));
    completed
}

fn optimize_multi_skeleton_insertions(
    scramble_state: &CubeState,
    skeletons: &[FmcSkeletonCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> (Vec<FmcCandidate>, usize, usize) {
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
    let mut transition_count = 0usize;
    let mut pair_count = 0usize;

    for skeleton in skeletons
        .iter()
        .filter(|skeleton| skeleton.kind.is_multi_insertion())
    {
        let mut transitions = Vec::<FmcMultiTransition>::new();

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

                let mut first_full = Vec::with_capacity(skeleton.moves.len() + algorithm.len());
                first_full.extend_from_slice(&skeleton.moves[..position]);
                first_full.extend_from_slice(algorithm);
                first_full.extend_from_slice(&skeleton.moves[position..]);
                let raw_first_length = first_full.len();
                let first_full = simplify_moves(&first_full);
                if first_full.is_empty() {
                    continue;
                }

                let residual_state = scramble_state.apply_moves(&first_full, &tables.move_data);
                let Some((residual_kind, defect_positions)) =
                    classify_insertion_leftover(&residual_state)
                else {
                    continue;
                };
                if !residual_kind.is_single_insertion() {
                    continue;
                }

                let residual = FmcSkeletonCandidate {
                    moves: first_full,
                    kind: residual_kind,
                    defect_positions,
                    eo_len: skeleton.eo_len,
                    dr_len: skeleton.dr_len,
                    p2_len: skeleton.p2_len,
                    eo_moves: skeleton.eo_moves.clone(),
                    dr_moves: skeleton.dr_moves.clone(),
                    finish_moves: skeleton.finish_moves.clone(),
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
                transitions.push(FmcMultiTransition {
                    residual_state_key: fmc_state_key(&residual_state),
                    cancellation_gain: raw_first_length.saturating_sub(residual.moves.len()),
                    residual,
                    first_step,
                });
            }
        }

        let selected_transitions = select_diverse_multi_transitions(transitions);
        transition_count += selected_transitions.len();
        let mut joint_candidates = Vec::new();
        for transition in selected_transitions {
            let second_candidates = enumerate_joint_second_insertions(
                scramble_state,
                skeleton,
                &transition.residual,
                &transition.first_step,
                tables,
                fmc_tables,
            );
            pair_count += second_candidates.len();
            joint_candidates.extend(second_candidates);
        }

        joint_candidates.sort_by_key(|candidate| {
            let inserted = candidate
                .insertion_steps
                .iter()
                .map(|step| step.moves.len())
                .sum::<usize>();
            let raw = skeleton.moves.len().saturating_add(inserted);
            let cancellation = raw.saturating_sub(candidate.moves.len());
            (
                candidate.moves.len(),
                std::cmp::Reverse(cancellation),
                inserted,
                candidate.moves.clone(),
            )
        });
        let mut seen = std::collections::HashSet::new();
        joint_candidates.retain(|candidate| seen.insert(candidate.moves.clone()));
        joint_candidates.truncate(FMC_MULTI_GLOBAL_RESULT_LIMIT_PER_SKELETON);
        completed.extend(joint_candidates);
    }

    completed.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.source_tag,
            candidate.axis,
            candidate.moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    completed.retain(|candidate| seen.insert(candidate.moves.clone()));
    (completed, transition_count, pair_count)
}
'''
rust = rust[:start] + new_multi + rust[end:]

old_multi_call = '''    let mut multi_inserted_candidates = if enable_multi_insertion {
        optimize_multi_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables)
    } else {
        Vec::new()
    };
'''
new_multi_call = '''    let (
        mut multi_inserted_candidates,
        multi_insertion_transition_count,
        multi_insertion_pair_count,
    ) = if enable_multi_insertion {
        optimize_multi_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables)
    } else {
        (Vec::new(), 0, 0)
    };
'''
if old_multi_call not in rust:
    raise SystemExit("multi insertion call anchor not found")
rust = rust.replace(old_multi_call, new_multi_call, 1)

rust = rust.replace(
    '''                multi_insertion_candidate_count: 0,
                slice_insertion_candidate_count: 0,
''',
    '''                multi_insertion_candidate_count: 0,
                multi_insertion_transition_count: 0,
                multi_insertion_pair_count: 0,
                slice_insertion_candidate_count: 0,
''',
)

old_final_result = '''        multi_insertion_candidate_count,
        slice_insertion_candidate_count,
'''
new_final_result = '''        multi_insertion_candidate_count,
        multi_insertion_transition_count,
        multi_insertion_pair_count,
        slice_insertion_candidate_count,
'''
if old_final_result not in rust:
    raise SystemExit("final FmcResult anchor not found")
rust = rust.replace(old_final_result, new_final_result, 1)

old_lib = '''        "multiInsertionCandidateCount": result.multi_insertion_candidate_count,
        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,
'''
new_lib = '''        "multiInsertionCandidateCount": result.multi_insertion_candidate_count,
        "multiInsertionTransitionCount": result.multi_insertion_transition_count,
        "multiInsertionPairCount": result.multi_insertion_pair_count,
        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,
'''
if old_lib not in lib:
    raise SystemExit("lib JSON anchor not found")
lib = lib.replace(old_lib, new_lib, 1)

old_js = '''          multiInsertion: stageOptions.enableMultiInsertion === true,
          reservedCompression: qualityStage.options.reservedCompression === true,
'''
new_js = '''          multiInsertion: stageOptions.enableMultiInsertion === true,
          multiInsertionTransitionCount: Number.isFinite(wasmResult?.multiInsertionTransitionCount)
            ? wasmResult.multiInsertionTransitionCount
            : 0,
          multiInsertionPairCount: Number.isFinite(wasmResult?.multiInsertionPairCount)
            ? wasmResult.multiInsertionPairCount
            : 0,
          reservedCompression: qualityStage.options.reservedCompression === true,
'''
if old_js not in js:
    raise SystemExit("JS diagnostics anchor not found")
js = js.replace(old_js, new_js, 1)

rust_path.write_text(rust)
lib_path.write_text(lib)
js_path.write_text(js)
