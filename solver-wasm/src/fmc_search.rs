use crate::minmove_core::{
    encode_co, encode_eo, encode_perm8, encode_slice_from_ep, parse_scramble,
    solution_string_from_path, CubeState, CO_SIZE, EDGE_COUNT, EO_SIZE, LAST_FACE_FREE, MOVE_COUNT,
    SLICE_SIZE,
};
use crate::twophase_bundle::TwophaseTables;
use crate::twophase_search::{solve_phase2, Phase2Input};
use once_cell::sync::{Lazy, OnceCell};

// --- Constants ---

/// Inverse of each move: U↔U', U2↔U2, R↔R', etc.
pub const MOVE_INVERSE: [u8; 18] = [1, 0, 2, 4, 3, 5, 7, 6, 8, 10, 9, 11, 13, 12, 14, 16, 15, 17];

/// EO-preserving moves for DR solving (all except F, F', B, B').
/// U(0),U'(1),U2(2), R(3),R'(4),R2(5), F2(8), D(9),D'(10),D2(11), L(12),L'(13),L2(14), B2(17)
const DR_EO_MOVE_INDICES: [u8; 14] = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 17];

/// Quarter-turn amounts for move suffix index (0→1 CW, 1→3 CCW, 2→2 half).
const TURN_AMOUNTS: [u8; 3] = [1, 3, 2];

/// Opposite face lookup (move-face convention: U=0,R=1,F=2,D=3,L=4,B=5).
pub const OPPOSITE_FACE: [u8; 6] = [3, 4, 5, 0, 1, 2];

/// Joint CO×Slice size for the DR BFS table.
const CO_SLICE_SIZE: usize = CO_SIZE * SLICE_SIZE;

/// Maximum EO depth to search.
const FMC_MAX_EO_DEPTH: u8 = 5;

/// Maximum DR depth (via first-move table chase).
const FMC_MAX_DR_DEPTH: u8 = 14;

/// Maximum P2 depth.
const FMC_MAX_P2_DEPTH: u8 = 18;

/// P2 node limit per call.
const FMC_P2_NODE_LIMIT: u64 = 2_000_000;

/// Premove P2 node limit (tighter for speed).
const FMC_PM_P2_NODE_LIMIT: u64 = 500_000;

/// EO sequence limit per axis for direct/NISS.
const FMC_EO_LIMIT: usize = 6;

/// EO sequence limit per axis for premove sweep.
const FMC_PM_EO_LIMIT: usize = 3;

/// Enable RZP-assisted DR candidate expansion.
const FMC_RZP_ENABLED: bool = true;

/// Maximum EO-preserving setup depth before attempting a DR tail.
const FMC_RZP_SETUP_DEPTH: u8 = 2;

/// Maximum number of DR routes to evaluate per EO sequence.
const FMC_DR_ROUTE_LIMIT: usize = 8;

/// Allow RZP-derived DR routes up to this many moves longer than the direct shortest DR route.
const FMC_DR_SLACK: usize = 3;

/// Maximum skeleton candidates returned for the next insertion stage.
const FMC_SKELETON_BEAM_LIMIT: usize = 24;

/// Preserve up to this many candidates per (kind, source, axis) bucket before
/// filling the remaining global beam slots.
const FMC_SKELETON_PER_BUCKET: usize = 2;

/// Maximum setup depth used to conjugate human-style 3-cycle commutators.
const FMC_THREE_CYCLE_SETUP_DEPTH: u8 = 2;

/// Maximum setup depth used to relocate PLL-style 2C2E algorithms.
const FMC_TWO_CORNER_TWO_EDGE_SETUP_DEPTH: u8 = 4;

/// Cap synthetic 2C2E relocation skeletons after deterministic length sorting.
const FMC_RELOCATION_2C2E_LIMIT: usize = 256;

/// Retain a bounded, diverse set of guaranteed two-insertion relocation plans
/// for each multi-leftover family.
const FMC_MULTI_RELOCATION_PER_KIND_LIMIT: usize = 128;

/// A bounded but diverse first-insertion frontier is evaluated jointly with
/// every valid second-insertion boundary. This is deliberately much wider than
/// the legacy top-8 greedy handoff.
const FMC_MULTI_GLOBAL_TRANSITION_LIMIT: usize = 64;

/// Keep several globally ranked joint insertion results per raw skeleton so
/// later candidate verification is not forced back to one local optimum.
const FMC_MULTI_GLOBAL_RESULT_LIMIT_PER_SKELETON: usize = 4;

/// Stage-boundary NISS keeps one EO and one DR boundary per axis/side.
const FMC_MULTI_NISS_BOUNDARY_EO_LIMIT: usize = 3;
const FMC_MULTI_NISS_CONTINUATION_EO_LIMIT: usize = 2;
const FMC_MULTI_NISS_CONTINUATION_P2_NODE_LIMIT: u64 = 500_000;
const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;

/// Deep-Extreme rescue for complementary EO frames. A cached reverse frontier
/// joins one-move P2 finishes to a bounded forward DR search, preserving longer
/// DR routes whose endpoint is globally better than the canonical shortest DR.
const FMC_COMPLEMENTARY_MITM_TARGET_TOTAL: usize = 20;
const FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH: usize = 5;
const FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH: usize = 6;
const FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT: usize = 600_000;

/// Deep-Extreme pre-EO NISS rescue. It explores a short prefix on one side,
/// switches before EO, then evaluates the opposite-side EO with a bounded
/// joint DR + short-P2 meet-in-the-middle continuation.
const FMC_PRE_EO_NISS_TARGET_TOTAL: usize = 20;
const FMC_PRE_EO_NISS_PREFIX_DEPTH: usize = 3;
const FMC_PRE_EO_NISS_SWITCH_EO_TOTAL: usize = 6;
const FMC_PRE_EO_NISS_EO_LIMIT: usize = 8;
const FMC_PRE_EO_NISS_FRONTIER_LIMIT: usize = 24;
const FMC_PRE_EO_NISS_P2_REVERSE_DEPTH: usize = 3;
const FMC_PRE_EO_NISS_DR_REVERSE_DEPTH: usize = 3;
const FMC_PRE_EO_NISS_DR_FORWARD_DEPTH: usize = 5;
const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;
/// Bound the reverse pre-EO table so an unexpectedly broad frontier cannot
/// exhaust browser WASM memory.
const FMC_PRE_EO_TAIL_STATE_LIMIT: usize = 1_200_000;

/// L3 Extreme retries one independent EO/premove frontier only when the
/// primary portfolio still exceeds the human sub-20 target.
const FMC_EXTREME_RETRY_TARGET: usize = 20;
const FMC_EXTREME_RETRY_VARIANT_OFFSET: u32 = 148;
/// Once a 20-move result is reached, spend one additional independent frontier
/// on the stricter sub-20 objective. This is skipped for 19 moves or better.
const FMC_EXTREME_SUB20_TARGET: usize = 19;
const FMC_EXTREME_SUB20_VARIANT_OFFSET: u32 = 111;

/// Maximum number of synthetic leave-slice relocation plans retained.
const FMC_SLICE_RELOCATION_LIMIT: usize = 64;

/// Global half turns used inside the HTR subgroup.
const FMC_HTR_HALF_TURN_MOVES: [u8; 6] = [2, 5, 8, 11, 14, 17];

/// Avoid accepting an HTR detour that is materially longer than the normal P2 tail.
const FMC_HTR_TAIL_SLACK: usize = 2;

/// Safety ceiling for the compact HTR coordinate table. The expected exact
/// subgroup is below this bound; reaching it leaves a safe partial table rather
/// than exhausting WASM linear memory.
const FMC_HTR_STATE_LIMIT: usize = 1_000_000;

/// Diagnostic selection mask for the four expensive Deep-Extreme subpaths.
/// Production callers use ALL, preserving the existing search portfolio.
const FMC_DEEP_COMPONENT_STAGE_BOUNDARY: u8 = 1 << 0;
const FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM: u8 = 1 << 1;
const FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL: u8 = 1 << 2;
const FMC_DEEP_COMPONENT_PRE_EO: u8 = 1 << 3;
pub const FMC_DEEP_COMPONENT_ALL: u8 = FMC_DEEP_COMPONENT_STAGE_BOUNDARY
    | FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM
    | FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL
    | FMC_DEEP_COMPONENT_PRE_EO;

// --- Axis conjugation ---
// JS convention: U=0,D=1,R=2,L=3,F=4,B=5
// Move convention: U=0,R=1,F=2,D=3,L=4,B=5

/// Maps move-face convention to JS face convention.
const MOVE_FACE_TO_JS: [usize; 6] = [0, 2, 4, 1, 3, 5];
/// Maps JS face convention to move-face convention.
const JS_TO_MOVE_FACE: [usize; 6] = [0, 3, 1, 4, 2, 5];

/// Axis scramble maps in JS face convention.
const AXIS_SCRAMBLE_MAPS_JS: [[u8; 6]; 3] = [
    [0, 1, 2, 3, 4, 5], // UD: identity
    [5, 4, 2, 3, 0, 1], // FB: U→B, D→F, R→R, L→L, F→U, B→D
    [2, 3, 1, 0, 4, 5], // RL: U→R, D→L, R→D, L→U, F→F, B→B
];

/// Axis solution maps (inverse of scramble maps) in JS face convention.
const AXIS_SOLUTION_MAPS_JS: [[u8; 6]; 3] = [
    [0, 1, 2, 3, 4, 5], // UD: identity
    [4, 5, 2, 3, 1, 0], // FB: U→F, D→B, R→R, L→L, F→D, B→U
    [3, 2, 0, 1, 4, 5], // RL: U→L, D→R, R→U, L→D, F→F, B→B
];

/// The second EO frame available for each DR axis. Existing axis tables cover
/// only one of the two EO axes compatible with each DR axis.
const COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS: [[u8; 6]; 3] =
    [[0, 1, 4, 5, 3, 2], [2, 3, 4, 5, 0, 1], [4, 5, 1, 0, 3, 2]];

const COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS: [[u8; 6]; 3] =
    [[0, 1, 5, 4, 2, 3], [4, 5, 0, 1, 2, 3], [3, 2, 5, 4, 0, 1]];

const AXIS_NAMES: [&str; 3] = ["UD", "FB", "RL"];

const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];

// --- FMC Tables ---

type FmcStateKey = [u8; 40];

fn fmc_state_key(state: &CubeState) -> FmcStateKey {
    let mut key = [0u8; 40];
    key[..8].copy_from_slice(&state.cp);
    key[8..16].copy_from_slice(&state.co);
    key[16..28].copy_from_slice(&state.ep);
    key[28..40].copy_from_slice(&state.eo);
    key
}

/// Compose two cube transformations in the same order as `state.apply_moves`:
/// applying `left` and then `right` yields `left * right`.
fn compose_cube_states(left: &CubeState, right: &CubeState) -> CubeState {
    let mut result = CubeState::solved();
    for pos in 0..8 {
        let middle = right.cp[pos] as usize;
        result.cp[pos] = left.cp[middle];
        result.co[pos] = (left.co[middle] + right.co[pos]) % 3;
    }
    for pos in 0..12 {
        let middle = right.ep[pos] as usize;
        result.ep[pos] = left.ep[middle];
        result.eo[pos] = (left.eo[middle] + right.eo[pos]) & 1;
    }
    result
}

fn invert_cube_state(state: &CubeState) -> CubeState {
    let mut inverse = CubeState::solved();
    for pos in 0..8 {
        let piece = state.cp[pos] as usize;
        inverse.cp[piece] = pos as u8;
        inverse.co[piece] = (3 - state.co[pos] % 3) % 3;
    }
    for pos in 0..12 {
        let piece = state.ep[pos] as usize;
        inverse.ep[piece] = pos as u8;
        inverse.eo[piece] = state.eo[pos];
    }
    inverse
}

fn relative_cube_state(from: &CubeState, to: &CubeState) -> CubeState {
    compose_cube_states(&invert_cube_state(from), to)
}

fn enumerate_canonical_sequences(
    max_depth: u8,
    move_faces: &[u8],
    include_empty: bool,
) -> Vec<Vec<u8>> {
    fn dfs(
        path: &mut Vec<u8>,
        output: &mut Vec<Vec<u8>>,
        max_depth: u8,
        move_faces: &[u8],
        last_face: u8,
    ) {
        if !path.is_empty() {
            output.push(path.clone());
        }
        if path.len() >= max_depth as usize {
            return;
        }
        for move_index in 0..MOVE_COUNT as u8 {
            let face = move_faces[move_index as usize];
            if last_face < LAST_FACE_FREE && face == last_face {
                continue;
            }
            if last_face < LAST_FACE_FREE
                && face == OPPOSITE_FACE[last_face as usize]
                && face < last_face
            {
                continue;
            }
            path.push(move_index);
            dfs(path, output, max_depth, move_faces, face);
            path.pop();
        }
    }

    let mut output = Vec::new();
    if include_empty {
        output.push(Vec::new());
    }
    dfs(
        &mut Vec::with_capacity(max_depth as usize),
        &mut output,
        max_depth,
        move_faces,
        LAST_FACE_FREE,
    );
    output
}

fn is_pure_three_cycle_state(state: &CubeState) -> bool {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return false;
    }
    let corners = state
        .cp
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    let edges = state
        .ep
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    (corners == 3 && edges == 0) || (corners == 0 && edges == 3)
}

fn insert_shortest_algorithm(
    algorithms: &mut std::collections::HashMap<FmcStateKey, Vec<u8>>,
    state: &CubeState,
    moves: Vec<u8>,
) {
    if moves.is_empty() {
        return;
    }
    let key = fmc_state_key(state);
    match algorithms.entry(key) {
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(moves);
        }
        std::collections::hash_map::Entry::Occupied(mut entry) => {
            let current = entry.get();
            if moves.len() < current.len() || (moves.len() == current.len() && moves < *current) {
                entry.insert(moves);
            }
        }
    }
}

/// Build a compact human-style 3-cycle library. Base algorithms are commutators
/// `[A, B]` with A up to three moves and B one move. They are then conjugated
/// by canonical setups up to two moves. Only exact cube states are indexed.
fn build_three_cycle_algorithms(
    tables: &TwophaseTables,
) -> std::collections::HashMap<FmcStateKey, Vec<u8>> {
    let a_sequences = enumerate_canonical_sequences(3, &tables.move_data.move_face, false);
    let setups = enumerate_canonical_sequences(
        FMC_THREE_CYCLE_SETUP_DEPTH,
        &tables.move_data.move_face,
        true,
    );
    let mut base = std::collections::HashMap::<FmcStateKey, Vec<u8>>::new();

    for a in &a_sequences {
        let inverse_a = invert_moves(a);
        for b in 0..MOVE_COUNT as u8 {
            let mut commutator = Vec::with_capacity(a.len() * 2 + 2);
            commutator.extend_from_slice(a);
            commutator.push(b);
            commutator.extend_from_slice(&inverse_a);
            commutator.push(MOVE_INVERSE[b as usize]);
            let commutator = simplify_moves(&commutator);
            if commutator.len() < 4 {
                continue;
            }
            let state = CubeState::solved().apply_moves(&commutator, &tables.move_data);
            if !is_pure_three_cycle_state(&state) {
                continue;
            }
            insert_shortest_algorithm(&mut base, &state, commutator.clone());

            let inverse = invert_moves(&commutator);
            let inverse_state = CubeState::solved().apply_moves(&inverse, &tables.move_data);
            insert_shortest_algorithm(&mut base, &inverse_state, inverse);
        }
    }

    let base_algorithms: Vec<Vec<u8>> = base.values().cloned().collect();
    let mut result = base;
    for algorithm in base_algorithms {
        for setup in &setups {
            if setup.is_empty() {
                continue;
            }
            let mut conjugated = Vec::with_capacity(setup.len() * 2 + algorithm.len());
            conjugated.extend_from_slice(setup);
            conjugated.extend_from_slice(&algorithm);
            conjugated.extend_from_slice(&invert_moves(setup));
            let conjugated = simplify_moves(&conjugated);
            let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
            insert_shortest_algorithm(&mut result, &state, conjugated);
        }
    }
    result
}

fn is_two_corner_two_edge_state(state: &CubeState) -> bool {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return false;
    }
    let corners = state
        .cp
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    let edges = state
        .ep
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    corners == 2 && edges == 2
}

/// Build a deterministic 2C2E library from standard PLL-style double swaps and
/// canonical conjugating setups. Multiple base families are retained because
/// orientation-preserving 2C2E states split into practical setup classes.
fn build_two_corner_two_edge_algorithms(
    tables: &TwophaseTables,
) -> std::collections::HashMap<FmcStateKey, Vec<u8>> {
    // T, Jb, Ra, Rb and F permutations in the repository move convention.
    // Every sequence is effect-checked before it is admitted to the library.
    let base_sequences: [Vec<u8>; 5] = [
        vec![3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 7],
        vec![3, 0, 4, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1],
        vec![3, 1, 4, 1, 3, 0, 3, 9, 4, 1, 3, 10, 4, 2, 4],
        vec![4, 2, 3, 2, 4, 6, 3, 0, 4, 1, 4, 7, 5, 1],
        vec![4, 1, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 0, 3],
    ];
    let setups = enumerate_canonical_sequences(
        FMC_TWO_CORNER_TWO_EDGE_SETUP_DEPTH,
        &tables.move_data.move_face,
        true,
    );
    let mut result = std::collections::HashMap::<FmcStateKey, Vec<u8>>::new();

    for base in base_sequences {
        let base = simplify_moves(&base);
        let base_state = CubeState::solved().apply_moves(&base, &tables.move_data);
        if !is_two_corner_two_edge_state(&base_state) {
            continue;
        }

        let mut variants = vec![base.clone(), invert_moves(&base)];
        variants.sort();
        variants.dedup();
        for algorithm in variants {
            for setup in &setups {
                let mut conjugated = Vec::with_capacity(setup.len() * 2 + algorithm.len());
                conjugated.extend_from_slice(setup);
                conjugated.extend_from_slice(&algorithm);
                conjugated.extend_from_slice(&invert_moves(setup));
                let conjugated = simplify_moves(&conjugated);
                let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
                if is_two_corner_two_edge_state(&state) {
                    insert_shortest_algorithm(&mut result, &state, conjugated);
                }
            }
        }
    }

    result
}

/// Exact E2, M2 and S2 edge-only double swaps in the repository cubie convention.
fn slice_residual_state(axis: u8) -> CubeState {
    let mut state = CubeState::solved();
    // Repository edge order: UF, UR, UB, UL, DF, DR, DB, DL, FR, FL, BR, BL.
    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 11), (9, 10)], // E2: FR↔BL, FL↔BR
        1 => [(0, 6), (2, 4)],   // M2: UF↔DB, UB↔DF
        2 => [(1, 7), (3, 5)],   // S2: UR↔DL, UL↔DR
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
        0 => [2, 11], // U2 D2 completes E2
        1 => [5, 14], // R2 L2 completes M2
        2 => [8, 17], // F2 B2 completes S2
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

#[derive(Clone, Debug)]
struct FmcMultiRelocationPlan {
    moves: Vec<u8>,
    kind: FmcSkeletonKind,
    defect_positions: Vec<u8>,
}

fn build_multi_relocation_plans(
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

#[derive(Clone, Copy, Debug)]
struct FmcComplementaryTail {
    dr_moves: [u8; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
    dr_len: u8,
    p2_move: u8,
}

impl FmcComplementaryTail {
    fn solved() -> Self {
        Self {
            dr_moves: [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: 255,
        }
    }

    fn total_len(&self) -> usize {
        self.dr_len as usize + usize::from(self.p2_move != 255)
    }

    fn dr_slice(&self) -> &[u8] {
        &self.dr_moves[..self.dr_len as usize]
    }

    fn p2_moves(&self) -> Vec<u8> {
        if self.p2_move == 255 {
            Vec::new()
        } else {
            vec![self.p2_move]
        }
    }

    fn prepend_dr(&self, move_index: u8) -> Option<Self> {
        let old_len = self.dr_len as usize;
        if old_len >= FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH {
            return None;
        }
        let mut dr_moves = [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH];
        dr_moves[0] = move_index;
        if old_len > 0 {
            dr_moves[1..=old_len].copy_from_slice(&self.dr_moves[..old_len]);
        }
        Some(Self {
            dr_moves,
            dr_len: self.dr_len + 1,
            p2_move: self.p2_move,
        })
    }
}

fn complementary_compact_state_key(state: &CubeState) -> u128 {
    let mut key = 0u128;
    let mut shift = 0u32;
    for &value in &state.cp {
        key |= (value as u128) << shift;
        shift += 3;
    }
    for &value in &state.co {
        key |= (value as u128) << shift;
        shift += 2;
    }
    for &value in &state.ep {
        key |= (value as u128) << shift;
        shift += 4;
    }
    for &value in &state.eo {
        key |= (value as u128) << shift;
        shift += 1;
    }
    key
}

fn complementary_tail_order(
    tail: &FmcComplementaryTail,
) -> (usize, u8, [u8; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH], u8) {
    (tail.total_len(), tail.dr_len, tail.dr_moves, tail.p2_move)
}

fn retain_complementary_tail(
    tails: &mut std::collections::HashMap<u128, FmcComplementaryTail>,
    state: &CubeState,
    candidate: FmcComplementaryTail,
) -> bool {
    let key = complementary_compact_state_key(state);
    match tails.get(&key) {
        None => {
            tails.insert(key, candidate);
            true
        }
        Some(current)
            if complementary_tail_order(&candidate) < complementary_tail_order(current) =>
        {
            tails.insert(key, candidate);
            true
        }
        _ => false,
    }
}

fn build_complementary_short_p2_tails(
    tables: &TwophaseTables,
) -> std::collections::HashMap<u128, FmcComplementaryTail> {
    let solved = CubeState::solved();
    let mut tails = std::collections::HashMap::<u128, FmcComplementaryTail>::new();
    let solved_tail = FmcComplementaryTail::solved();
    retain_complementary_tail(&mut tails, &solved, solved_tail);

    let mut frontier = vec![(solved, solved_tail)];
    for &global_move in &tables.phase2_move_indices {
        let state = solved.apply_move(global_move as usize, &tables.move_data);
        let tail = FmcComplementaryTail {
            dr_moves: [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: MOVE_INVERSE[global_move as usize],
        };
        if retain_complementary_tail(&mut tails, &state, tail) {
            frontier.push((state, tail));
        }
    }

    for _ in 0..FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in frontier {
            for &move_index in &DR_EO_MOVE_INDICES {
                let predecessor = state.apply_move(move_index as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_dr(MOVE_INVERSE[move_index as usize]) else {
                    continue;
                };
                if retain_complementary_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        frontier = next;
    }
    tails
}

pub struct FmcTables {
    /// CO×Slice BFS distance table (using EO-preserving moves).
    pub co_slice_dist: Vec<u8>,
    /// First-move table for instant optimal DR lookup.
    pub co_slice_first_move: Vec<u8>,
    /// EO BFS distance table.
    pub eo_dist: Vec<u8>,
    /// EO-preserving move allowed lists by last face.
    pub dr_eo_allowed_by_last_face: Vec<Vec<u8>>,
    /// Move conjugation tables for each axis: move_index → conjugated_index.
    pub axis_scramble_move_map: [[u8; 18]; 3],
    /// Inverse conjugation for converting solution back to original frame.
    pub axis_solution_move_map: [[u8; 18]; 3],
    /// Human-style commutator/setup algorithms indexed by exact 3-cycle state.
    pub three_cycle_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,
    /// PLL-style algorithms indexed by exact orientation-preserving 2C2E state.
    pub two_corner_two_edge_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,
    /// Guaranteed two-cycle removals that create 4C, 4E or 3C3E skeletons.
    multi_relocation_plans: Vec<FmcMultiRelocationPlan>,
    /// Exact E2/M2/S2 leave-slice relocation plans.
    slice_relocation_plans: Vec<FmcMultiRelocationPlan>,
    /// Lazily built half-turn subgroup table. Values are the first half turn toward solved.
    htr_first_move: OnceCell<std::collections::HashMap<u64, u8>>,
    complementary_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcComplementaryTail>>,
    pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u64, FmcPreEoTail>>,
}

impl FmcTables {
    pub fn warm_deep_tables(&self, tables: &TwophaseTables) -> (usize, usize, usize) {
        let htr = self
            .htr_first_move
            .get_or_init(|| build_htr_first_move_table(tables));
        let complementary = self
            .complementary_short_p2_tails
            .get_or_init(|| build_complementary_short_p2_tails(tables));
        let pre_eo = self
            .pre_eo_short_p2_tails
            .get_or_init(|| build_pre_eo_short_p2_tails(tables));
        (htr.len(), complementary.len(), pre_eo.len())
    }

    pub fn multi_relocation_plan_count(&self) -> usize {
        self.multi_relocation_plans.len()
    }

    pub fn slice_relocation_plan_count(&self) -> usize {
        self.slice_relocation_plans.len()
    }
}

fn build_move_conjugation(js_face_map: &[u8; 6]) -> [u8; 18] {
    let mut result = [0u8; 18];
    for move_idx in 0..18usize {
        let face = move_idx / 3;
        let turn = move_idx % 3;
        let js_face = MOVE_FACE_TO_JS[face];
        let mapped_js_face = js_face_map[js_face] as usize;
        let mapped_face = JS_TO_MOVE_FACE[mapped_js_face];
        result[move_idx] = (mapped_face * 3 + turn) as u8;
    }
    result
}

pub fn build_fmc_tables(tables: &TwophaseTables) -> FmcTables {
    let solved_slice = tables.solved_slice as usize;

    // Build EO distance table (BFS from solved EO=0, using all 18 moves)
    let mut eo_dist = vec![255u8; EO_SIZE];
    eo_dist[0] = 0;
    let mut frontier: Vec<usize> = vec![0];
    let mut depth = 0u8;
    while !frontier.is_empty() && depth < 15 {
        depth += 1;
        let mut next = Vec::new();
        for &state in &frontier {
            for m in 0..MOVE_COUNT {
                let ns = tables.eo_move.get(state, m) as usize;
                if eo_dist[ns] == 255 {
                    eo_dist[ns] = depth;
                    next.push(ns);
                }
            }
        }
        frontier = next;
    }

    // Build CO×Slice BFS distance + first-move table (from solved DR, using EO-preserving moves)
    let mut co_slice_dist = vec![255u8; CO_SLICE_SIZE];
    let mut co_slice_first_move = vec![255u8; CO_SLICE_SIZE];
    let start_key = solved_slice; // co=0, slice=solved_slice
    co_slice_dist[start_key] = 0;
    let mut frontier: Vec<usize> = vec![start_key];
    let mut depth = 0u8;
    while !frontier.is_empty() && depth < 20 {
        depth += 1;
        let mut next = Vec::new();
        for &key in &frontier {
            let co = key / SLICE_SIZE;
            let sl = key % SLICE_SIZE;
            for &m in &DR_EO_MOVE_INDICES {
                let nco = tables.co_move.get(co, m as usize) as usize;
                let nsl = tables.slice_move.get(sl, m as usize) as usize;
                let nkey = nco * SLICE_SIZE + nsl;
                if co_slice_dist[nkey] == 255 {
                    co_slice_dist[nkey] = depth;
                    // Store inverse move: to go FROM nkey TOWARDS solved, apply inverse(m).
                    co_slice_first_move[nkey] = MOVE_INVERSE[m as usize];
                    next.push(nkey);
                }
            }
        }
        frontier = next;
    }

    // Build DR EO-preserving allowed moves by last face
    let mut dr_eo_allowed: Vec<Vec<u8>> = vec![Vec::new(); LAST_FACE_FREE as usize + 1];
    for last_face in 0..=LAST_FACE_FREE as usize {
        for &m in &DR_EO_MOVE_INDICES {
            let face = m / 3;
            if last_face == LAST_FACE_FREE as usize {
                dr_eo_allowed[last_face].push(m);
                continue;
            }
            if face == last_face as u8 {
                continue;
            }
            if face == OPPOSITE_FACE[last_face] && face < last_face as u8 {
                continue;
            }
            dr_eo_allowed[last_face].push(m);
        }
    }

    // Build axis conjugation tables
    let mut axis_scramble_move_map = [[0u8; 18]; 3];
    let mut axis_solution_move_map = [[0u8; 18]; 3];
    for i in 0..3 {
        axis_scramble_move_map[i] = build_move_conjugation(&AXIS_SCRAMBLE_MAPS_JS[i]);
        axis_solution_move_map[i] = build_move_conjugation(&AXIS_SOLUTION_MAPS_JS[i]);
    }

    let three_cycle_algorithms = build_three_cycle_algorithms(tables);
    let two_corner_two_edge_algorithms = build_two_corner_two_edge_algorithms(tables);
    let (multi_relocation_plans, slice_relocation_plans) =
        build_multi_relocation_plans(tables, &three_cycle_algorithms);

    FmcTables {
        co_slice_dist,
        co_slice_first_move,
        eo_dist,
        dr_eo_allowed_by_last_face: dr_eo_allowed,
        axis_scramble_move_map,
        axis_solution_move_map,
        three_cycle_algorithms,
        two_corner_two_edge_algorithms,
        multi_relocation_plans,
        slice_relocation_plans,
        htr_first_move: OnceCell::new(),
        complementary_short_p2_tails: OnceCell::new(),
        pre_eo_short_p2_tails: OnceCell::new(),
    }
}

// --- EO Sequence Search (IDA*) ---

struct EoSearchCtx<'a> {
    tables: &'a TwophaseTables,
    eo_dist: &'a [u8],
    path: Vec<u8>,
    solutions: Vec<Vec<u8>>,
    limit: usize,
    variant: u32,
}

impl<'a> EoSearchCtx<'a> {
    fn dfs(&mut self, eo: usize, depth: u8, bound: u8, last_face: u8) -> u8 {
        if self.solutions.len() >= self.limit {
            return 255;
        }
        let h = self.eo_dist[eo];
        let f = depth.saturating_add(h);
        if f > bound {
            return f;
        }
        if eo == 0 {
            self.solutions.push(self.path.clone());
            return 255; // found, continue searching at this depth
        }

        let mut min_next = 255u8;
        let allowed = &self.tables.phase1_allowed_moves_by_last_face[last_face as usize];
        let allowed_len = allowed.len();
        let rotation = if allowed_len == 0 {
            0
        } else {
            ((self.variant / 2) as usize) % allowed_len
        };
        for offset in 0..allowed_len {
            let forward_index = (offset + rotation) % allowed_len;
            let index = if self.variant & 1 == 0 {
                forward_index
            } else {
                allowed_len - 1 - forward_index
            };
            let m = allowed[index];
            if self.solutions.len() >= self.limit {
                return 255;
            }
            let next_eo = self.tables.eo_move.get(eo, m as usize) as usize;
            let face = self.tables.move_data.move_face[m as usize];
            self.path.push(m);
            let result = self.dfs(next_eo, depth + 1, bound, face);
            self.path.pop();
            if result < min_next {
                min_next = result;
            }
        }
        min_next
    }
}

fn find_eo_sequences(
    eo_idx: usize,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_depth: u8,
    limit: usize,
    variant: u32,
) -> Vec<Vec<u8>> {
    if eo_idx == 0 {
        return vec![vec![]]; // already solved
    }

    let min_depth = fmc_tables.eo_dist[eo_idx];
    if min_depth > max_depth {
        return vec![]; // unreachable within budget
    }

    let mut ctx = EoSearchCtx {
        tables,
        eo_dist: &fmc_tables.eo_dist,
        path: Vec::with_capacity(max_depth as usize),
        solutions: Vec::new(),
        // Collect a wider deterministic pool, then assign different residue
        // buckets to search variants. This makes additional Extreme time cover
        // new EO branches instead of replaying the same shortest prefix set.
        limit: limit.saturating_mul(4).max(limit),
        variant,
    };

    for d in min_depth..=max_depth {
        if ctx.solutions.len() >= ctx.limit {
            break;
        }
        ctx.path.clear();
        ctx.dfs(eo_idx, 0, d, LAST_FACE_FREE);
    }

    let mut solutions = ctx.solutions;
    solutions.sort_by_key(|moves| (moves.len(), moves.clone()));
    solutions.dedup();
    if variant == 0 {
        solutions.truncate(limit);
        return solutions;
    }

    // Non-zero variants deliberately evaluate a disjoint slice of the wider
    // EO pool. Do not refill from the complete pool: doing that made every
    // variant converge back to the same candidate set.
    const VARIANT_BUCKETS: usize = 4;
    let bucket = variant as usize % VARIANT_BUCKETS;
    let mut selected: Vec<Vec<u8>> = solutions
        .iter()
        .enumerate()
        .filter_map(|(index, moves)| (index % VARIANT_BUCKETS == bucket).then_some(moves.clone()))
        .take(limit)
        .collect();

    // Very small EO pools can leave a residue bucket empty. In that case retain
    // one rotated candidate so the variant stays productive without recreating
    // the entire baseline set.
    if selected.is_empty() && !solutions.is_empty() {
        let rotation = (variant as usize * 17) % solutions.len();
        selected.push(solutions[rotation].clone());
    }
    selected
}

// --- DR Solving (first-move table chase) ---

fn solve_dr(
    co_idx: usize,
    slice_idx: usize,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
    max_depth: u8,
) -> Option<Vec<u8>> {
    let solved_slice = tables.solved_slice as usize;

    if co_idx == 0 && slice_idx == solved_slice {
        return Some(vec![]);
    }

    let key = co_idx * SLICE_SIZE + slice_idx;
    if fmc_tables.co_slice_dist[key] > max_depth {
        return None;
    }

    let mut path = Vec::new();
    let mut co = co_idx;
    let mut sl = slice_idx;
    while co != 0 || sl != solved_slice {
        let k = co * SLICE_SIZE + sl;
        let fm = fmc_tables.co_slice_first_move[k];
        if fm == 255 || path.len() > max_depth as usize {
            return None;
        }
        path.push(fm);
        co = tables.co_move.get(co, fm as usize) as usize;
        sl = tables.slice_move.get(sl, fm as usize) as usize;
    }
    Some(path)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct RzpDefect {
    bad_c: u8,
    bad_e: u8,
}

#[derive(Clone, Debug)]
struct DrRoute {
    moves: Vec<u8>,
    rzp_setup_len: u8,
    rzp_defect: Option<RzpDefect>,
}

fn rzp_defect_from_state(state: &CubeState) -> RzpDefect {
    let bad_c = state.co.iter().filter(|&&ori| ori != 0).count() as u8;

    let bad_e_ud_positions = (0..8).filter(|&pos| state.ep[pos] >= 8).count() as u8;

    let bad_e_slice_positions = (8..EDGE_COUNT).filter(|&pos| state.ep[pos] < 8).count() as u8;

    RzpDefect {
        bad_c,
        bad_e: bad_e_ud_positions + bad_e_slice_positions,
    }
}

fn rzp_priority(defect: RzpDefect) -> Option<u8> {
    match (defect.bad_c, defect.bad_e) {
        (0, 0) => Some(0),
        (3, 2) => Some(1),
        (4, 2) => Some(1),
        (4, 4) => Some(2),
        (7, 8) => Some(3),
        (8, 8) => Some(3),
        _ => None,
    }
}

fn last_face_of_moves(moves: &[u8], tables: &TwophaseTables) -> u8 {
    moves
        .last()
        .map(|&m| tables.move_data.move_face[m as usize])
        .unwrap_or(LAST_FACE_FREE)
}

fn solve_dr_routes_via_rzp(
    state_after_eo: &CubeState,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
    max_depth: u8,
    last_face_before_dr: u8,
    force_rzp: bool,
) -> Vec<DrRoute> {
    let mut routes: Vec<DrRoute> = Vec::new();
    let mut seen = std::collections::HashSet::<Vec<u8>>::new();

    let co0 = encode_co(&state_after_eo.co);
    let sl0 = encode_slice_from_ep(&state_after_eo.ep);

    let direct = solve_dr(co0, sl0, fmc_tables, tables, max_depth);
    let direct_len = direct.as_ref().map(|m| m.len()).unwrap_or(usize::MAX);
    let direct_found = direct.is_some();

    if !FMC_RZP_ENABLED || max_depth == 0 {
        return routes;
    }

    if let Some(moves) = direct {
        if !force_rzp && seen.insert(moves.clone()) {
            routes.push(DrRoute {
                moves,
                rzp_setup_len: 0,
                rzp_defect: Some(rzp_defect_from_state(state_after_eo)),
            });
        }
    }

    let slack_limit = if force_rzp {
        usize::MAX
    } else {
        direct_len.saturating_add(FMC_DR_SLACK)
    };

    fn dfs(
        state: CubeState,
        setup: &mut Vec<u8>,
        routes: &mut Vec<DrRoute>,
        seen: &mut std::collections::HashSet<Vec<u8>>,
        fmc_tables: &FmcTables,
        tables: &TwophaseTables,
        max_depth: u8,
        slack_limit: usize,
        depth_left: u8,
        last_face: u8,
    ) {
        if routes.len() >= FMC_DR_ROUTE_LIMIT {
            return;
        }

        let defect = rzp_defect_from_state(&state);

        if rzp_priority(defect).is_some() && setup.len() <= max_depth as usize {
            let remaining = max_depth.saturating_sub(setup.len() as u8);
            let co = encode_co(&state.co);
            let sl = encode_slice_from_ep(&state.ep);

            if let Some(tail) = solve_dr(co, sl, fmc_tables, tables, remaining) {
                let mut full = setup.clone();
                full.extend_from_slice(&tail);

                let within_cap = full.len() <= max_depth as usize;
                let within_slack = slack_limit == usize::MAX || full.len() <= slack_limit;

                if within_cap && within_slack && seen.insert(full.clone()) {
                    routes.push(DrRoute {
                        moves: full,
                        rzp_setup_len: setup.len() as u8,
                        rzp_defect: Some(defect),
                    });
                }
            }
        }

        if depth_left == 0 {
            return;
        }

        for &m in &fmc_tables.dr_eo_allowed_by_last_face[last_face as usize] {
            let face = tables.move_data.move_face[m as usize];
            let next_state = state.apply_move(m as usize, &tables.move_data);

            setup.push(m);
            dfs(
                next_state,
                setup,
                routes,
                seen,
                fmc_tables,
                tables,
                max_depth,
                slack_limit,
                depth_left - 1,
                face,
            );
            setup.pop();

            if routes.len() >= FMC_DR_ROUTE_LIMIT {
                return;
            }
        }
    }

    let mut setup = Vec::new();
    dfs(
        *state_after_eo,
        &mut setup,
        &mut routes,
        &mut seen,
        fmc_tables,
        tables,
        max_depth,
        slack_limit,
        FMC_RZP_SETUP_DEPTH,
        last_face_before_dr,
    );

    routes.sort_by_key(|route| {
        let priority = route.rzp_defect.and_then(rzp_priority).unwrap_or(99);

        (route.moves.len(), priority, route.rzp_setup_len)
    });

    routes.truncate(FMC_DR_ROUTE_LIMIT);
    routes
}

// --- P2 Input Building ---

fn encode_perm4(perm: &[u8; 4]) -> usize {
    let mut index = 0usize;
    for i in 0..4 {
        let mut smaller = 0usize;
        for j in (i + 1)..4 {
            if perm[j] < perm[i] {
                smaller += 1;
            }
        }
        index += smaller * FACTORIAL_4[3 - i];
    }
    index
}

fn build_p2_input(state: &CubeState) -> Option<Phase2Input> {
    // Verify edges are in DR configuration: UD edges (0-7) in UD positions, E-slice (8-11) in E-slice.
    for i in 0..8 {
        if state.ep[i] >= 8 {
            return None;
        }
    }
    for i in 8..12 {
        if state.ep[i] < 8 {
            return None;
        }
    }

    let cp_idx = encode_perm8(&state.cp);
    let ep8: [u8; 8] = [
        state.ep[0],
        state.ep[1],
        state.ep[2],
        state.ep[3],
        state.ep[4],
        state.ep[5],
        state.ep[6],
        state.ep[7],
    ];
    let ep_idx = encode_perm8(&ep8);
    let sep: [u8; 4] = [
        state.ep[8] - 8,
        state.ep[9] - 8,
        state.ep[10] - 8,
        state.ep[11] - 8,
    ];
    let sep_idx = encode_perm4(&sep);

    Some(Phase2Input {
        cp_idx,
        ep_idx,
        sep_idx,
    })
}

// --- Move Simplification ---

fn turn_to_suffix(combined: u8) -> u8 {
    match combined {
        1 => 0,
        3 => 1,
        2 => 2,
        _ => unreachable!(),
    }
}

/// Simplify a move sequence by cancelling adjacent same-face and opposite-face sandwiches.
/// Iterates until no more simplifications possible.
pub fn simplify_moves(input: &[u8]) -> Vec<u8> {
    let mut result = input.to_vec();
    loop {
        let new_result = simplify_pass(&result);
        if new_result.len() == result.len() {
            break;
        }
        result = new_result;
    }
    result
}

fn simplify_pass(input: &[u8]) -> Vec<u8> {
    let mut result: Vec<u8> = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        // Check for same-face merge with next
        if i + 1 < input.len() && input[i] / 3 == input[i + 1] / 3 {
            let face = input[i] / 3;
            let ta = TURN_AMOUNTS[(input[i] % 3) as usize];
            let tb = TURN_AMOUNTS[(input[i + 1] % 3) as usize];
            let combined = (ta + tb) & 3;
            if combined != 0 {
                result.push(face * 3 + turn_to_suffix(combined));
            }
            i += 2;
            continue;
        }
        // Check for opposite-face sandwich: A B C where A.face == C.face and B.face == opposite(A.face)
        if i + 2 < input.len() {
            let af = input[i] / 3;
            let bf = input[i + 1] / 3;
            let cf = input[i + 2] / 3;
            if af == cf && bf == OPPOSITE_FACE[af as usize] {
                let ta = TURN_AMOUNTS[(input[i] % 3) as usize];
                let tc = TURN_AMOUNTS[(input[i + 2] % 3) as usize];
                let combined = (ta + tc) & 3;
                if combined != 0 {
                    result.push(af * 3 + turn_to_suffix(combined));
                }
                result.push(input[i + 1]);
                i += 3;
                continue;
            }
        }
        result.push(input[i]);
        i += 1;
    }
    result
}

const FMC_CANONICAL_AXIS_FACES: [[u8; 2]; 3] = [[0, 3], [1, 4], [2, 5]];

fn move_axis_from_face(face: u8) -> usize {
    match face {
        0 | 3 => 0,
        1 | 4 => 1,
        2 | 5 => 2,
        _ => unreachable!(),
    }
}

fn canonicalize_commuting_axis_blocks(input: &[u8]) -> Vec<u8> {
    let moves = simplify_moves(input);
    let mut canonical = Vec::with_capacity(moves.len());
    let mut index = 0usize;
    while index < moves.len() {
        let first_face = moves[index] / 3;
        let axis = move_axis_from_face(first_face);
        let mut amounts = [0u8; 6];
        while index < moves.len() {
            let move_index = moves[index];
            let face = move_index / 3;
            if move_axis_from_face(face) != axis {
                break;
            }
            let amount = TURN_AMOUNTS[(move_index % 3) as usize];
            amounts[face as usize] = (amounts[face as usize] + amount) & 3;
            index += 1;
        }
        for &face in &FMC_CANONICAL_AXIS_FACES[axis] {
            let amount = amounts[face as usize];
            if amount != 0 {
                canonical.push(face * 3 + turn_to_suffix(amount));
            }
        }
    }
    canonical
}

fn is_trivial_reverse_solution(solution: &[u8], reverse_scramble_canonical: &[u8]) -> bool {
    canonicalize_commuting_axis_blocks(solution) == reverse_scramble_canonical
}

fn retain_nontrivial_reverse_candidates(
    candidates: &mut Vec<FmcCandidate>,
    reverse_scramble_canonical: &[u8],
) -> usize {
    let before = candidates.len();
    candidates.retain(|candidate| {
        !is_trivial_reverse_solution(&candidate.moves, reverse_scramble_canonical)
    });
    before.saturating_sub(candidates.len())
}

// --- State Inversion ---

fn invert_state(state: &CubeState) -> CubeState {
    let mut inv = CubeState::solved();
    for i in 0..8 {
        let j = state.cp[i] as usize;
        inv.cp[j] = i as u8;
        inv.co[j] = (3 - state.co[i] % 3) % 3;
    }
    for i in 0..12 {
        let j = state.ep[i] as usize;
        inv.ep[j] = i as u8;
        inv.eo[j] = state.eo[i];
    }
    inv
}

fn invert_moves(moves: &[u8]) -> Vec<u8> {
    moves
        .iter()
        .rev()
        .map(|&m| MOVE_INVERSE[m as usize])
        .collect()
}

// --- Premove Sets ---

fn build_premove_sets() -> Vec<Vec<u8>> {
    let mut sets: Vec<Vec<u8>> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let push_set =
        |moves: Vec<u8>, sets: &mut Vec<Vec<u8>>, seen: &mut std::collections::HashSet<Vec<u8>>| {
            let simplified = simplify_moves(&moves);
            if simplified.is_empty() || simplified.len() > 2 {
                return;
            }
            if seen.insert(simplified.clone()) {
                sets.push(simplified);
            }
        };

    // Single-face premoves (18)
    for face in 0..6u8 {
        for turn in 0..3u8 {
            push_set(vec![face * 3 + turn], &mut sets, &mut seen);
        }
    }

    // Double-face premoves: various face pairs
    // Matching the JS FMC_PREMOVE_PAIR_FACES order
    let pair_faces: [(u8, u8); 18] = [
        (0, 1),
        (1, 0),
        (0, 2),
        (2, 0),
        (1, 2),
        (2, 1), // U-R, R-U, U-F, F-U, R-F, F-R
        (3, 4),
        (4, 3),
        (3, 5),
        (5, 3),
        (4, 5),
        (5, 4), // D-L, L-D, D-B, B-D, L-B, B-L
        (0, 3),
        (3, 0),
        (1, 4),
        (4, 1),
        (2, 5),
        (5, 2), // U-D, D-U, R-L, L-R, F-B, B-F
    ];

    for &(fa, fb) in &pair_faces {
        for ta in 0..3u8 {
            for tb in 0..3u8 {
                push_set(vec![fa * 3 + ta, fb * 3 + tb], &mut sets, &mut seen);
            }
        }
    }

    sets
}

struct FmcPremoveSet {
    moves: Vec<u8>,
    axis_moves: [Vec<u8>; 3],
}

static FMC_PREMOVE_SETS: Lazy<Vec<FmcPremoveSet>> = Lazy::new(|| {
    let axis_maps: [[u8; 18]; 3] =
        std::array::from_fn(|axis| build_move_conjugation(&AXIS_SCRAMBLE_MAPS_JS[axis]));
    build_premove_sets()
        .into_iter()
        .map(|moves| {
            let axis_moves: [Vec<u8>; 3] = std::array::from_fn(|axis| {
                moves.iter().map(|&m| axis_maps[axis][m as usize]).collect()
            });
            FmcPremoveSet { moves, axis_moves }
        })
        .collect()
});

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FmcSkeletonKind {
    Corner3,
    Edge3,
    Corner2Edge2,
    Slice,
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
            Self::Slice => "slice",
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
            Self::Slice => 3,
            Self::Corner4 => 4,
            Self::Edge4 => 5,
            Self::Corner3Edge3 => 6,
        }
    }

    fn estimated_insertion_cost(self) -> usize {
        match self {
            Self::Slice => 2,
            Self::Corner3 | Self::Edge3 => 8,
            Self::Corner2Edge2 => 14,
            Self::Corner4 | Self::Edge4 | Self::Corner3Edge3 => 16,
        }
    }

    fn is_single_insertion(self) -> bool {
        matches!(
            self,
            Self::Corner3 | Self::Edge3 | Self::Corner2Edge2 | Self::Slice
        )
    }

    fn is_multi_insertion(self) -> bool {
        matches!(self, Self::Corner4 | Self::Edge4 | Self::Corner3Edge3)
    }
}

#[derive(Clone, Debug)]
struct AxisSkeletonPrefix {
    moves: Vec<u8>,
    eo_len: u8,
    dr_len: u8,
    p2_len: u8,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    finish_moves: Vec<u8>,
}

fn classify_insertion_leftover(state: &CubeState) -> Option<(FmcSkeletonKind, Vec<u8>)> {
    if let Some((_axis, positions)) = classify_slice_leftover(state) {
        return Some((FmcSkeletonKind::Slice, positions));
    }
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

    match (corner_misplaced.len(), edge_misplaced.len()) {
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
        if let Some((kind, defect_positions)) = classify_insertion_leftover(&state) {
            let simplified = simplify_moves(&moves);
            if !simplified.is_empty() && seen.insert((kind, defect_positions, simplified.clone())) {
                prefixes.push(AxisSkeletonPrefix {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_len as u8,
                    eo_moves: eo_moves.to_vec(),
                    dr_moves: dr_moves.to_vec(),
                    finish_moves: p2_moves[..p2_len].to_vec(),
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

fn htr_coordinate_key(cp_idx: usize, ep_idx: usize, sep_idx: usize) -> u64 {
    (cp_idx as u64) | ((ep_idx as u64) << 16) | ((sep_idx as u64) << 32)
}

fn htr_half_turn_local_moves(tables: &TwophaseTables) -> Vec<u8> {
    tables
        .phase2_move_indices
        .iter()
        .enumerate()
        .filter_map(|(local, &global)| {
            FMC_HTR_HALF_TURN_MOVES
                .contains(&global)
                .then_some(local as u8)
        })
        .collect()
}

fn build_htr_first_move_table(tables: &TwophaseTables) -> std::collections::HashMap<u64, u8> {
    let half_turn_moves = htr_half_turn_local_moves(tables);
    let mut first_move = std::collections::HashMap::<u64, u8>::new();
    let mut queue = std::collections::VecDeque::<(usize, usize, usize)>::new();
    first_move.insert(htr_coordinate_key(0, 0, 0), 255);
    queue.push_back((0, 0, 0));

    while let Some((cp_idx, ep_idx, sep_idx)) = queue.pop_front() {
        for &local_move in &half_turn_moves {
            let local = local_move as usize;
            let next_cp = tables.phase2_cp_move.get(cp_idx, local) as usize;
            let next_ep = tables.phase2_ep_move.get(ep_idx, local) as usize;
            let next_sep = tables.phase2_sep_move.get(sep_idx, local) as usize;
            let key = htr_coordinate_key(next_cp, next_ep, next_sep);
            if first_move.contains_key(&key) {
                continue;
            }
            if first_move.len() >= FMC_HTR_STATE_LIMIT {
                continue;
            }
            // Every HTR generator is a half turn and therefore self-inverse.
            first_move.insert(key, local_move);
            queue.push_back((next_cp, next_ep, next_sep));
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
    let input = build_p2_input(state)?;
    let table = fmc_tables
        .htr_first_move
        .get_or_init(|| build_htr_first_move_table(tables));
    let mut cp_idx = input.cp_idx;
    let mut ep_idx = input.ep_idx;
    let mut sep_idx = input.sep_idx;
    let mut moves = Vec::new();
    let mut guard = 0usize;
    loop {
        let local_move = *table.get(&htr_coordinate_key(cp_idx, ep_idx, sep_idx))?;
        if local_move == 255 {
            return Some(moves);
        }
        let local = local_move as usize;
        moves.push(tables.phase2_move_indices[local]);
        cp_idx = tables.phase2_cp_move.get(cp_idx, local) as usize;
        ep_idx = tables.phase2_ep_move.get(ep_idx, local) as usize;
        sep_idx = tables.phase2_sep_move.get(sep_idx, local) as usize;
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
    const ENTRY_DEPTH: usize = 3;
    let mut queue = std::collections::VecDeque::<(CubeState, Vec<u8>, u8)>::new();
    let mut seen = std::collections::HashMap::<FmcStateKey, usize>::new();
    queue.push_back((*state_after_dr, Vec::new(), LAST_FACE_FREE));
    seen.insert(fmc_state_key(state_after_dr), 0);
    let mut best: Option<Vec<u8>> = None;
    while let Some((state, prefix, last_face)) = queue.pop_front() {
        if let Some(finish) = htr_finish_moves(&state, tables, fmc_tables) {
            let mut tail = prefix.clone();
            tail.extend_from_slice(&finish);
            let tail = simplify_moves(&tail);
            if tail != p2_moves && tail.len() <= p2_moves.len() + FMC_HTR_TAIL_SLACK {
                let replace = best.as_ref().is_none_or(|current| {
                    (tail.len(), tail.clone()) < (current.len(), current.clone())
                });
                if replace {
                    best = Some(tail);
                }
            }
        }
        if prefix.len() >= ENTRY_DEPTH {
            continue;
        }
        for &move_index in &tables.phase2_move_indices {
            let face = tables.move_data.move_face[move_index as usize];
            if last_face < LAST_FACE_FREE && face == last_face {
                continue;
            }
            if last_face < LAST_FACE_FREE
                && face == OPPOSITE_FACE[last_face as usize]
                && face < last_face
            {
                continue;
            }
            let next = state.apply_move(move_index as usize, &tables.move_data);
            let next_depth = prefix.len() + 1;
            let key = fmc_state_key(&next);
            if seen.get(&key).is_some_and(|&depth| depth <= next_depth) {
                continue;
            }
            seen.insert(key, next_depth);
            let mut next_prefix = prefix.clone();
            next_prefix.push(move_index);
            queue.push_back((next, next_prefix, face));
        }
    }
    best
}

// --- Result Types ---

#[derive(Clone, Debug)]
pub struct FmcInsertionStep {
    pub kind: FmcSkeletonKind,
    pub moves: Vec<u8>,
    pub position: u8,
}

#[derive(Clone, Debug)]
pub struct FmcCandidate {
    pub moves: Vec<u8>,
    pub eo_len: u8,
    pub dr_len: u8,
    pub p2_len: u8,
    /// Individual segment moves in the axis frame (already converted to original axis)
    pub eo_moves: Vec<u8>,
    pub dr_moves: Vec<u8>,
    pub finish_moves: Vec<u8>,
    pub axis: u8,
    /// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS; 12 is complementary-frame short-P2 MITM rescue; 13 is complementary-frame normal direct rescue.
    pub source_tag: u8,
    pub premove_moves: Vec<u8>,
    /// Whether this candidate used RZP for DR (vs direct solve)
    pub rzp_used: bool,
    /// Skeleton before insertion and cancellation, when applicable.
    pub skeleton_moves: Vec<u8>,
    /// Exact algorithm inserted into a 3-cycle skeleton, when applicable.
    pub insertion_moves: Vec<u8>,
    pub insertion_position: Option<u8>,
    pub skeleton_kind: Option<FmcSkeletonKind>,
    pub insertion_steps: Vec<FmcInsertionStep>,
}

#[derive(Clone, Debug)]
pub struct FmcSkeletonCandidate {
    pub moves: Vec<u8>,
    pub kind: FmcSkeletonKind,
    pub defect_positions: Vec<u8>,
    pub eo_len: u8,
    pub dr_len: u8,
    pub p2_len: u8,
    pub eo_moves: Vec<u8>,
    pub dr_moves: Vec<u8>,
    pub finish_moves: Vec<u8>,
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
    pub insertion_candidate_count: usize,
    pub mixed_insertion_candidate_count: usize,
    pub multi_insertion_candidate_count: usize,
    pub multi_insertion_transition_count: usize,
    pub multi_insertion_pair_count: usize,
    pub slice_insertion_candidate_count: usize,
    pub multi_switch_niss_candidate_count: usize,
    pub reverse_scramble_rejected_count: usize,
}

#[derive(Default)]
struct FmcP2Cache {
    solved: std::collections::HashMap<(usize, usize, usize, u64), Vec<u8>>,
    exact_failed: std::collections::HashSet<(usize, usize, usize, u8, u64)>,
}

impl FmcP2Cache {
    fn solve(
        &mut self,
        input: &Phase2Input,
        tables: &TwophaseTables,
        max_depth: u8,
        node_limit: u64,
    ) -> Option<Vec<u8>> {
        let solved_key = (input.cp_idx, input.ep_idx, input.sep_idx, node_limit);
        if let Some(moves) = self.solved.get(&solved_key) {
            if moves.len() <= max_depth as usize {
                return Some(moves.clone());
            }
        }

        let failed_key = (
            input.cp_idx,
            input.ep_idx,
            input.sep_idx,
            max_depth,
            node_limit,
        );
        if self.exact_failed.contains(&failed_key) {
            return None;
        }

        let result = solve_phase2(input, tables, max_depth, node_limit);
        if result.ok {
            self.solved.insert(solved_key, result.moves.clone());
            Some(result.moves)
        } else {
            self.exact_failed.insert(failed_key);
            None
        }
    }
}

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
    include_dr_boundaries: bool,
) -> Vec<FmcNissBoundary> {
    let eo_idx = encode_eo(&state.eo);
    let eo_sequences = find_eo_sequences(
        eo_idx,
        tables,
        fmc_tables,
        max_eo_depth,
        FMC_MULTI_NISS_BOUNDARY_EO_LIMIT,
        0,
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

    [best_eo, if include_dr_boundaries { best_dr } else { None }]
        .into_iter()
        .flatten()
        .collect()
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
    include_dr_boundaries: bool,
) -> Vec<FmcBoundaryNissResult> {
    let boundaries = collect_multi_switch_niss_boundaries(
        state,
        tables,
        fmc_tables,
        max_eo_depth,
        *current_best,
        force_rzp,
        include_dr_boundaries,
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
            0,
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
            if !state.apply_moves(&flattened, &tables.move_data).is_solved() {
                continue;
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

#[derive(Clone, Copy, Debug)]
struct FmcPreEoTail {
    dr_moves: [u8; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
    dr_len: u8,
    p2_moves: [u8; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
    p2_len: u8,
}

impl FmcPreEoTail {
    fn solved() -> Self {
        Self {
            dr_moves: [255; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
            dr_len: 0,
            p2_moves: [255; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
            p2_len: 0,
        }
    }

    fn total_len(&self) -> usize {
        self.dr_len as usize + self.p2_len as usize
    }

    fn dr_slice(&self) -> &[u8] {
        &self.dr_moves[..self.dr_len as usize]
    }

    fn p2_slice(&self) -> &[u8] {
        &self.p2_moves[..self.p2_len as usize]
    }

    fn prepend_dr(&self, move_index: u8) -> Option<Self> {
        let old_len = self.dr_len as usize;
        if old_len >= FMC_PRE_EO_NISS_DR_REVERSE_DEPTH {
            return None;
        }
        let mut next = *self;
        next.dr_moves = [255; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH];
        next.dr_moves[0] = move_index;
        if old_len > 0 {
            next.dr_moves[1..=old_len].copy_from_slice(&self.dr_moves[..old_len]);
        }
        next.dr_len += 1;
        Some(next)
    }

    fn prepend_p2(&self, move_index: u8) -> Option<Self> {
        let old_len = self.p2_len as usize;
        if old_len >= FMC_PRE_EO_NISS_P2_REVERSE_DEPTH {
            return None;
        }
        let mut next = *self;
        next.p2_moves = [255; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH];
        next.p2_moves[0] = move_index;
        if old_len > 0 {
            next.p2_moves[1..=old_len].copy_from_slice(&self.p2_moves[..old_len]);
        }
        next.p2_len += 1;
        Some(next)
    }
}

fn pre_eo_tail_order(
    tail: &FmcPreEoTail,
) -> (
    usize,
    u8,
    [u8; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
    u8,
    [u8; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
) {
    (
        tail.total_len(),
        tail.dr_len,
        tail.dr_moves,
        tail.p2_len,
        tail.p2_moves,
    )
}

fn encode_edge_permutation_12(ep: &[u8; EDGE_COUNT]) -> u32 {
    let mut rank = 0u32;
    for i in 0..EDGE_COUNT {
        let mut smaller = 0u32;
        for j in (i + 1)..EDGE_COUNT {
            if ep[j] < ep[i] {
                smaller += 1;
            }
        }
        rank = rank * (EDGE_COUNT - i) as u32 + smaller;
    }
    rank
}

/// EO remains solved throughout the reverse P2/DR table and the matching
/// forward DR search. CP (16 bits), CO (12 bits), and full EP (29 bits)
/// therefore form a collision-free 57-bit coordinate.
fn pre_eo_compact_state_key(state: &CubeState) -> u64 {
    let cp = encode_perm8(&state.cp) as u64;
    let co = encode_co(&state.co) as u64;
    let ep = encode_edge_permutation_12(&state.ep) as u64;
    cp | (co << 16) | (ep << 28)
}

fn retain_pre_eo_tail(
    tails: &mut std::collections::HashMap<u64, FmcPreEoTail>,
    state: &CubeState,
    candidate: FmcPreEoTail,
) -> bool {
    let key = pre_eo_compact_state_key(state);
    match tails.get(&key) {
        None => {
            if tails.len() >= FMC_PRE_EO_TAIL_STATE_LIMIT {
                return false;
            }
            tails.insert(key, candidate);
            true
        }
        Some(current) if pre_eo_tail_order(&candidate) < pre_eo_tail_order(current) => {
            tails.insert(key, candidate);
            true
        }
        _ => false,
    }
}

fn build_pre_eo_short_p2_tails(
    tables: &TwophaseTables,
) -> std::collections::HashMap<u64, FmcPreEoTail> {
    let solved = CubeState::solved();
    let solved_tail = FmcPreEoTail::solved();
    let mut tails = std::collections::HashMap::<u64, FmcPreEoTail>::new();
    retain_pre_eo_tail(&mut tails, &solved, solved_tail);

    let mut p2_frontier = vec![(solved, solved_tail)];
    let mut dr_seeds = p2_frontier.clone();
    for _ in 0..FMC_PRE_EO_NISS_P2_REVERSE_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in p2_frontier {
            for &global_move in &tables.phase2_move_indices {
                let predecessor = state.apply_move(global_move as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_p2(MOVE_INVERSE[global_move as usize]) else {
                    continue;
                };
                if retain_pre_eo_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        dr_seeds.extend(next.iter().copied());
        p2_frontier = next;
    }

    let mut frontier = dr_seeds;
    for _ in 0..FMC_PRE_EO_NISS_DR_REVERSE_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in frontier {
            for &move_index in &DR_EO_MOVE_INDICES {
                let predecessor = state.apply_move(move_index as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_dr(MOVE_INVERSE[move_index as usize]) else {
                    continue;
                };
                if retain_pre_eo_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        frontier = next;
    }
    tails
}

#[derive(Clone, Debug)]
struct FmcPreEoBoundary {
    prefix_moves: Vec<u8>,
    eo_moves: Vec<u8>,
    state_after_eo: CubeState,
    dr_distance: u8,
    lower_bound: usize,
}

fn collect_pre_eo_niss_frontier(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
) -> Vec<FmcPreEoBoundary> {
    fn dfs(
        state: CubeState,
        path: &mut Vec<u8>,
        last_face: u8,
        tables: &TwophaseTables,
        fmc_tables: &FmcTables,
        max_eo_depth: u8,
        output: &mut Vec<FmcPreEoBoundary>,
    ) {
        if !path.is_empty() {
            let switched = invert_state(&state);
            let eo_idx = encode_eo(&switched.eo);
            let eo_min = fmc_tables.eo_dist[eo_idx] as usize;
            let eo_cap = FMC_PRE_EO_NISS_SWITCH_EO_TOTAL
                .saturating_sub(path.len())
                .min(max_eo_depth as usize);
            if eo_min <= eo_cap {
                let eo_sequences = find_eo_sequences(
                    eo_idx,
                    tables,
                    fmc_tables,
                    eo_cap as u8,
                    FMC_PRE_EO_NISS_EO_LIMIT,
                    0,
                );
                for eo_moves in eo_sequences {
                    let state_after_eo = switched.apply_moves(&eo_moves, &tables.move_data);
                    let co = encode_co(&state_after_eo.co);
                    let slice = encode_slice_from_ep(&state_after_eo.ep);
                    let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice];
                    if dr_distance == 255 {
                        continue;
                    }
                    let lower_bound = path.len() + eo_moves.len() + dr_distance as usize;
                    if lower_bound <= FMC_PRE_EO_NISS_TARGET_TOTAL {
                        output.push(FmcPreEoBoundary {
                            prefix_moves: path.clone(),
                            eo_moves,
                            state_after_eo,
                            dr_distance,
                            lower_bound,
                        });
                    }
                }
            }
        }

        if path.len() >= FMC_PRE_EO_NISS_PREFIX_DEPTH {
            return;
        }
        for &move_index in &tables.phase1_allowed_moves_by_last_face[last_face as usize] {
            let face = tables.move_data.move_face[move_index as usize];
            path.push(move_index);
            let next = state.apply_move(move_index as usize, &tables.move_data);
            dfs(next, path, face, tables, fmc_tables, max_eo_depth, output);
            path.pop();
        }
    }

    let mut output = Vec::new();
    dfs(
        *state,
        &mut Vec::new(),
        LAST_FACE_FREE,
        tables,
        fmc_tables,
        max_eo_depth,
        &mut output,
    );
    output.sort_by_key(|boundary| {
        (
            boundary.lower_bound,
            boundary.prefix_moves.len() + boundary.eo_moves.len(),
            boundary.dr_distance,
            boundary.prefix_moves.clone(),
            boundary.eo_moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    output.retain(|boundary| seen.insert(fmc_state_key(&boundary.state_after_eo)));
    output.truncate(FMC_PRE_EO_NISS_FRONTIER_LIMIT);
    output
}

fn solve_pre_eo_joint_mitm(
    start: &CubeState,
    last_face_before_dr: u8,
    remaining_budget: usize,
    tails: &std::collections::HashMap<u64, FmcPreEoTail>,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
) -> Option<(Vec<u8>, Vec<u8>)> {
    #[derive(Clone)]
    struct ForwardNode {
        state: CubeState,
        path: [u8; FMC_PRE_EO_NISS_DR_FORWARD_DEPTH],
        len: u8,
        last_face: u8,
    }

    let mut frontier = vec![ForwardNode {
        state: *start,
        path: [255; FMC_PRE_EO_NISS_DR_FORWARD_DEPTH],
        len: 0,
        last_face: last_face_before_dr,
    }];
    let mut seen = std::collections::HashMap::<(u64, u8), u8>::new();
    seen.insert((pre_eo_compact_state_key(start), last_face_before_dr), 0);
    let mut node_count = 1usize;
    let mut best: Option<(Vec<u8>, Vec<u8>)> = None;

    for depth in 0..=FMC_PRE_EO_NISS_DR_FORWARD_DEPTH {
        for node in &frontier {
            if let Some(tail) = tails.get(&pre_eo_compact_state_key(&node.state)) {
                let total = node.len as usize + tail.total_len();
                if total <= remaining_budget {
                    let mut dr_moves = node.path[..node.len as usize].to_vec();
                    dr_moves.extend_from_slice(tail.dr_slice());
                    let p2_moves = tail.p2_slice().to_vec();
                    let solved = start
                        .apply_moves(&dr_moves, &tables.move_data)
                        .apply_moves(&p2_moves, &tables.move_data)
                        .is_solved();
                    if solved {
                        let replace = best.as_ref().is_none_or(|(current_dr, current_p2)| {
                            (
                                dr_moves.len() + p2_moves.len(),
                                dr_moves.clone(),
                                p2_moves.clone(),
                            ) < (
                                current_dr.len() + current_p2.len(),
                                current_dr.clone(),
                                current_p2.clone(),
                            )
                        });
                        if replace {
                            best = Some((dr_moves, p2_moves));
                        }
                    }
                }
            }
        }
        if depth == FMC_PRE_EO_NISS_DR_FORWARD_DEPTH {
            break;
        }

        let mut next_frontier = Vec::new();
        for node in frontier {
            let co = encode_co(&node.state.co);
            let slice = encode_slice_from_ep(&node.state.ep);
            let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
            let forward_left = FMC_PRE_EO_NISS_DR_FORWARD_DEPTH - depth;
            if dr_distance == 255
                || dr_distance > forward_left + FMC_PRE_EO_NISS_DR_REVERSE_DEPTH
                || node.len as usize >= remaining_budget
            {
                continue;
            }

            let mut children = Vec::new();
            for &move_index in &fmc_tables.dr_eo_allowed_by_last_face[node.last_face as usize] {
                let next_state = node
                    .state
                    .apply_move(move_index as usize, &tables.move_data);
                let key = pre_eo_compact_state_key(&next_state);
                let next_co = encode_co(&next_state.co);
                let next_slice = encode_slice_from_ep(&next_state.ep);
                let distance = fmc_tables.co_slice_dist[next_co * SLICE_SIZE + next_slice];
                children.push((
                    !tails.contains_key(&key),
                    distance,
                    move_index,
                    next_state,
                    key,
                ));
            }
            children.sort_by_key(|(not_meet, distance, move_index, _, _)| {
                (*not_meet, *distance, *move_index)
            });

            for (_, _, move_index, next_state, key) in children {
                let face = tables.move_data.move_face[move_index as usize];
                let next_depth = (depth + 1) as u8;
                let seen_key = (key, face);
                if seen
                    .get(&seen_key)
                    .is_some_and(|&previous| previous <= next_depth)
                {
                    continue;
                }
                seen.insert(seen_key, next_depth);
                let mut path = node.path;
                path[depth] = move_index;
                next_frontier.push(ForwardNode {
                    state: next_state,
                    path,
                    len: next_depth,
                    last_face: face,
                });
                node_count += 1;
                if node_count >= FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT {
                    return best;
                }
            }
        }
        frontier = next_frontier;
    }
    best
}

#[derive(Clone, Debug)]
struct FmcPreEoNissResult {
    moves: Vec<u8>,
    prefix_moves: Vec<u8>,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    p2_moves: Vec<u8>,
}

fn solve_pre_eo_niss_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    tails: &std::collections::HashMap<u64, FmcPreEoTail>,
) -> Vec<FmcPreEoNissResult> {
    let boundaries = collect_pre_eo_niss_frontier(state, tables, fmc_tables, max_eo_depth);
    let mut output = Vec::new();
    for boundary in boundaries {
        let used = boundary.prefix_moves.len() + boundary.eo_moves.len();
        let remaining = FMC_PRE_EO_NISS_TARGET_TOTAL.saturating_sub(used);
        let last_face = last_face_of_moves(&boundary.eo_moves, tables);
        let Some((dr_moves, p2_moves)) = solve_pre_eo_joint_mitm(
            &boundary.state_after_eo,
            last_face,
            remaining,
            tails,
            fmc_tables,
            tables,
        ) else {
            continue;
        };
        let mut continuation = boundary.eo_moves.clone();
        continuation.extend_from_slice(&dr_moves);
        continuation.extend_from_slice(&p2_moves);
        let mut flattened = boundary.prefix_moves.clone();
        flattened.extend_from_slice(&invert_moves(&continuation));
        let flattened = simplify_moves(&flattened);
        if flattened.is_empty()
            || flattened.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
            || !state.apply_moves(&flattened, &tables.move_data).is_solved()
        {
            continue;
        }
        output.push(FmcPreEoNissResult {
            moves: flattened,
            prefix_moves: boundary.prefix_moves,
            eo_moves: boundary.eo_moves,
            dr_moves,
            p2_moves,
        });
    }
    output.sort_by_key(|result| (result.moves.len(), result.moves.clone()));
    let mut seen = std::collections::HashSet::new();
    output.retain(|result| seen.insert(result.moves.clone()));
    output.truncate(4);
    output
}

fn solve_complementary_short_p2_mitm(
    start: &CubeState,
    tails: &std::collections::HashMap<u128, FmcComplementaryTail>,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
) -> Option<(Vec<u8>, Vec<u8>)> {
    #[derive(Clone)]
    struct ForwardNode {
        state: CubeState,
        path: [u8; FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH],
        len: u8,
        last_face: u8,
    }

    let mut frontier = vec![ForwardNode {
        state: *start,
        path: [255; FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH],
        len: 0,
        last_face: LAST_FACE_FREE,
    }];
    let mut seen = std::collections::HashMap::<(u128, u8), u8>::new();
    seen.insert((complementary_compact_state_key(start), LAST_FACE_FREE), 0);
    let mut node_count = 1usize;

    for depth in 0..=FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH {
        for node in &frontier {
            if let Some(tail) = tails.get(&complementary_compact_state_key(&node.state)) {
                let tail_dr = tail.dr_slice();
                let p2_moves = tail.p2_moves();
                let solved = node
                    .state
                    .apply_moves(tail_dr, &tables.move_data)
                    .apply_moves(&p2_moves, &tables.move_data)
                    .is_solved();
                if solved {
                    let mut dr_moves = node.path[..node.len as usize].to_vec();
                    dr_moves.extend_from_slice(tail_dr);
                    return Some((dr_moves, p2_moves));
                }
            }
        }
        if depth == FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH {
            break;
        }

        let mut next_frontier = Vec::new();
        for node in frontier {
            let co = encode_co(&node.state.co);
            let slice = encode_slice_from_ep(&node.state.ep);
            let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
            let forward_left = FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH - depth;
            if dr_distance == 255
                || dr_distance > forward_left + FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH
            {
                continue;
            }

            let mut children = Vec::new();
            for &move_index in &fmc_tables.dr_eo_allowed_by_last_face[node.last_face as usize] {
                let state = node
                    .state
                    .apply_move(move_index as usize, &tables.move_data);
                let key = complementary_compact_state_key(&state);
                let next_co = encode_co(&state.co);
                let next_slice = encode_slice_from_ep(&state.ep);
                let distance = fmc_tables.co_slice_dist[next_co * SLICE_SIZE + next_slice];
                children.push((!tails.contains_key(&key), distance, move_index, state, key));
            }
            children.sort_by_key(|(not_meet, distance, move_index, _, _)| {
                (*not_meet, *distance, *move_index)
            });

            for (_, _, move_index, state, key) in children {
                let face = tables.move_data.move_face[move_index as usize];
                let new_depth = (depth + 1) as u8;
                let seen_key = (key, face);
                if seen
                    .get(&seen_key)
                    .is_some_and(|&previous_depth| previous_depth <= new_depth)
                {
                    continue;
                }
                seen.insert(seen_key, new_depth);
                let mut path = node.path;
                path[depth] = move_index;
                next_frontier.push(ForwardNode {
                    state,
                    path,
                    len: new_depth,
                    last_face: face,
                });
                node_count += 1;
                if node_count >= FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT {
                    return None;
                }
            }
        }
        frontier = next_frontier;
    }
    None
}

// --- Single-Axis EO→DR→P2 Pipeline ---

/// Runs the EO→DR→P2 pipeline for a single cube state (already conjugated to axis frame).
/// Returns a list of (simplified_moves, eo_moves_raw, dr_moves_raw, p2_moves_raw, rzp_used).
fn solve_fmc_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    eo_limit: usize,
    max_dr_depth: u8,
    max_p2_depth: u8,
    p2_node_limit: u64,
    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    search_variant: u32,
    force_rzp: bool,
    enable_htr_skeletons: bool,
) -> Vec<(
    Vec<u8>,
    Vec<u8>,
    Vec<u8>,
    Vec<u8>,
    bool,
    bool,
    Vec<AxisSkeletonPrefix>,
)> {
    let mut results = Vec::new();

    let eo_idx = encode_eo(&state.eo);
    let eo_seqs = find_eo_sequences(
        eo_idx,
        tables,
        fmc_tables,
        max_eo_depth,
        eo_limit,
        search_variant,
    );

    for eo_seq in &eo_seqs {
        if eo_seq.len() >= *current_best {
            continue;
        }

        // Apply EO moves to state
        let state_after_eo = state.apply_moves(eo_seq, &tables.move_data);
        let co_after = encode_co(&state_after_eo.co);
        let slice_after = encode_slice_from_ep(&state_after_eo.ep);

        // Solve DR routes via RZP
        let dr_cap = (*current_best - eo_seq.len()).min(max_dr_depth as usize) as u8;
        let last_face_before_dr = last_face_of_moves(eo_seq, tables);

        let dr_routes = solve_dr_routes_via_rzp(
            &state_after_eo,
            fmc_tables,
            tables,
            dr_cap,
            last_face_before_dr,
            force_rzp,
        );

        if dr_routes.is_empty() {
            continue;
        }

        for dr_route in dr_routes {
            let dr_moves = &dr_route.moves;

            let partial_len = eo_seq.len() + dr_moves.len();
            if partial_len >= *current_best {
                continue;
            }

            let state_after_dr = state_after_eo.apply_moves(dr_moves, &tables.move_data);

            let p2_input = match build_p2_input(&state_after_dr) {
                Some(input) => input,
                None => continue,
            };

            let p2_cap = (*current_best - partial_len).min(max_p2_depth as usize) as u8;
            let p2_moves = match p2_cache.solve(&p2_input, tables, p2_cap, p2_node_limit) {
                Some(moves) => moves,
                None => continue,
            };
            let p2_global: Vec<u8> = p2_moves
                .iter()
                .map(|&local| tables.phase2_move_indices[local as usize])
                .collect();

            let mut all_moves = Vec::with_capacity(eo_seq.len() + dr_moves.len() + p2_global.len());
            all_moves.extend_from_slice(eo_seq);
            all_moves.extend_from_slice(dr_moves);
            all_moves.extend_from_slice(&p2_global);

            let simplified = simplify_moves(&all_moves);
            if simplified.is_empty() {
                continue;
            }
            // `current_best` is a raw exploration ceiling. A complete
            // candidate must not tighten it; longer skeletons may compress
            // below the final best after insertion and cancellation.

            let skeleton_prefixes = collect_axis_skeleton_prefixes(
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
                false,
                skeleton_prefixes,
            ));

            if enable_htr_skeletons {
                if let Some(htr_tail) =
                    find_htr_tail_from_p2(&state_after_dr, &p2_global, tables, fmc_tables)
                {
                    let mut htr_all_moves =
                        Vec::with_capacity(eo_seq.len() + dr_moves.len() + htr_tail.len());
                    htr_all_moves.extend_from_slice(eo_seq);
                    htr_all_moves.extend_from_slice(dr_moves);
                    htr_all_moves.extend_from_slice(&htr_tail);
                    let htr_simplified = simplify_moves(&htr_all_moves);
                    if !htr_simplified.is_empty() && htr_simplified.len() <= *current_best {
                        // HTR completion also leaves the raw ceiling unchanged.
                        let htr_prefixes = collect_axis_skeleton_prefixes(
                            &state_after_dr,
                            eo_seq,
                            dr_moves,
                            &htr_tail,
                            tables,
                        );
                        results.push((
                            htr_simplified,
                            eo_seq.clone(),
                            dr_moves.clone(),
                            htr_tail,
                            dr_route.rzp_setup_len > 0,
                            true,
                            htr_prefixes,
                        ));
                    }
                }
            }
        }
    }

    results
}

fn build_skeleton_candidate(
    scramble_state: &CubeState,
    moves: Vec<u8>,
    tables: &TwophaseTables,
    prefix: &AxisSkeletonPrefix,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    finish_moves: Vec<u8>,
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
    let (kind, defect_positions) = classify_insertion_leftover(&final_state)?;
    Some(FmcSkeletonCandidate {
        moves: simplified,
        kind,
        defect_positions,
        eo_len: prefix.eo_len,
        dr_len: prefix.dr_len,
        p2_len: prefix.p2_len,
        eo_moves,
        dr_moves,
        finish_moves,
        axis,
        source_tag,
        premove_moves: premove_moves.to_vec(),
        rzp_used,
    })
}

fn finalize_skeleton_beam(
    mut candidates: Vec<FmcSkeletonCandidate>,
    beam_limit: usize,
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
            candidate.defect_positions.clone(),
            candidate.moves.clone(),
        ))
    });

    let mut selected = Vec::new();
    let mut selected_keys = std::collections::HashSet::new();
    let mut bucket_counts = std::collections::HashMap::<(FmcSkeletonKind, u8, u8), usize>::new();

    // Reserve one beam slot for each supported leftover family before normal
    // source/axis quotas. Without this, the 24 legacy 3C/3E buckets can fill
    // the entire beam before any 2C2E relocation skeleton is considered.
    for kind in [
        FmcSkeletonKind::Corner3,
        FmcSkeletonKind::Edge3,
        FmcSkeletonKind::Corner2Edge2,
        FmcSkeletonKind::Corner4,
        FmcSkeletonKind::Edge4,
        FmcSkeletonKind::Corner3Edge3,
    ] {
        if let Some((index, candidate)) = candidates
            .iter()
            .enumerate()
            .find(|(index, candidate)| candidate.kind == kind && !selected_keys.contains(index))
        {
            let bucket = (candidate.kind, candidate.source_tag, candidate.axis);
            selected.push(candidate.clone());
            selected_keys.insert(index);
            *bucket_counts.entry(bucket).or_insert(0) += 1;
        }
    }

    for quota in 1..=FMC_SKELETON_PER_BUCKET {
        for (index, candidate) in candidates.iter().enumerate() {
            if selected.len() >= beam_limit {
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

    if selected.len() < beam_limit {
        for (index, candidate) in candidates.into_iter().enumerate() {
            if selected.len() >= beam_limit {
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

/// Create guaranteed insertion skeletons by removing a known 3-cycle algorithm
/// from an already complete FMC solution. Reinserting the same cycle at the end
/// recovers a valid solution, while trying every other boundary can produce
/// additional cancellations and a shorter final result.
fn synthesize_relocation_skeletons(
    candidates: &[FmcCandidate],
    tables: &TwophaseTables,
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
    base_candidates.truncate(8);

    let mut removable_cycles = Vec::<(Vec<u8>, FmcSkeletonKind, Vec<u8>)>::new();
    for algorithm in fmc_tables
        .three_cycle_algorithms
        .values()
        .chain(fmc_tables.two_corner_two_edge_algorithms.values())
    {
        let inverse = invert_moves(algorithm);
        let defect = CubeState::solved().apply_moves(&inverse, &tables.move_data);
        let Some((kind, positions)) = classify_insertion_leftover(&defect) else {
            continue;
        };
        removable_cycles.push((inverse, kind, positions));
    }
    removable_cycles.sort_by_key(|(moves, kind, positions)| {
        (moves.len(), kind.rank(), positions.clone(), moves.clone())
    });

    let mut mixed_seen = 0usize;
    removable_cycles.retain(|(_, kind, _)| {
        if *kind != FmcSkeletonKind::Corner2Edge2 {
            return true;
        }
        mixed_seen += 1;
        mixed_seen <= FMC_RELOCATION_2C2E_LIMIT
    });

    let mut output = Vec::new();
    for candidate in base_candidates {
        for (removed_moves, kind, positions) in &removable_cycles {
            let mut skeleton_moves =
                Vec::with_capacity(candidate.moves.len() + removed_moves.len());
            skeleton_moves.extend_from_slice(&candidate.moves);
            skeleton_moves.extend_from_slice(removed_moves);
            let skeleton_moves = simplify_moves(&skeleton_moves);
            if skeleton_moves.is_empty() {
                continue;
            }

            output.push(FmcSkeletonCandidate {
                moves: skeleton_moves,
                kind: *kind,
                defect_positions: positions.clone(),
                eo_len: candidate.eo_len,
                dr_len: candidate.dr_len,
                p2_len: candidate.p2_len,
                eo_moves: candidate.eo_moves.clone(),
                dr_moves: candidate.dr_moves.clone(),
                finish_moves: candidate.finish_moves.clone(),
                axis: candidate.axis,
                source_tag: candidate.source_tag,
                premove_moves: candidate.premove_moves.clone(),
                rzp_used: candidate.rzp_used,
            });
        }
    }
    output
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
            let mut skeleton_moves = Vec::with_capacity(candidate.moves.len() + plan.moves.len());
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
                eo_moves: candidate.eo_moves.clone(),
                dr_moves: candidate.dr_moves.clone(),
                finish_moves: candidate.finish_moves.clone(),
                axis: candidate.axis,
                source_tag: candidate.source_tag,
                premove_moves: candidate.premove_moves.clone(),
                rzp_used: candidate.rzp_used,
            });
        }
    }
    output
}

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
                eo_moves: candidate.eo_moves.clone(),
                dr_moves: candidate.dr_moves.clone(),
                finish_moves: candidate.finish_moves.clone(),
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

    Some(FmcCandidate {
        moves,
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
        skeleton_moves: skeleton.moves.clone(),
        insertion_moves: insertion_steps[0].moves.clone(),
        insertion_position: Some(insertion_steps[0].position),
        skeleton_kind: Some(origin_kind),
        insertion_steps,
    })
}

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

    Some(FmcCandidate {
        moves,
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
        skeleton_moves: skeleton.moves.clone(),
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

fn optimize_skeleton_insertions(
    scramble_state: &CubeState,
    skeletons: &[FmcSkeletonCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcCandidate> {
    skeletons
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
        .collect()
}

#[derive(Clone, Debug)]
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
        let boundary_band =
            ((transition.first_step.position as usize * 8) / denominator).min(7) as u8;
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

    let mut push_candidate = |moves: Vec<u8>,
                              second_kind: FmcSkeletonKind,
                              insertion_moves: Vec<u8>,
                              insertion_position: usize| {
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

// --- Full FMC Solver ---

fn solve_fmc_with_eo_depth(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    deep_component_mask: u8,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
    max_eo_depth: u8,
) -> FmcResult {
    // Parse scramble
    let scramble_moves = match parse_scramble(scramble, &tables.move_data) {
        Ok(m) => m,
        Err(_) => {
            return FmcResult {
                ok: false,
                candidates: vec![],
                skeletons: vec![],
                insertion_candidate_count: 0,
                mixed_insertion_candidate_count: 0,
                multi_insertion_candidate_count: 0,
                multi_insertion_transition_count: 0,
                multi_insertion_pair_count: 0,
                slice_insertion_candidate_count: 0,
                multi_switch_niss_candidate_count: 0,
                reverse_scramble_rejected_count: 0,
            }
        }
    };

    let search_level = search_level.min(3) as usize;
    let deep_component_mask = deep_component_mask & FMC_DEEP_COMPONENT_ALL;
    let deep_stage_boundary_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_STAGE_BOUNDARY != 0;
    let deep_complementary_mitm_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM != 0;
    let deep_complementary_normal_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL != 0;
    let deep_pre_eo_enabled =
        enable_deep_multi_switch_niss && deep_component_mask & FMC_DEEP_COMPONENT_PRE_EO != 0;
    let direct_eo_limit = [FMC_EO_LIMIT, 12, 24, 48][search_level];
    let premove_eo_limit = [FMC_PM_EO_LIMIT, 6, 12, 24][search_level];
    let p2_node_limit = [FMC_P2_NODE_LIMIT, 8_000_000, 24_000_000, 64_000_000][search_level];
    let premove_p2_node_limit =
        [FMC_PM_P2_NODE_LIMIT, 2_000_000, 8_000_000, 20_000_000][search_level];
    let skeleton_beam_limit = [FMC_SKELETON_BEAM_LIMIT, 48, 96, 160][search_level];

    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut all_skeletons: Vec<FmcSkeletonCandidate> = Vec::new();
    let original_scramble_state =
        CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
    let reverse_scramble_canonical =
        canonicalize_commuting_axis_blocks(&invert_moves(&scramble_moves));
    let mut reverse_scramble_rejected_count = 0usize;
    // Independent from the best completed solution: Extreme can retain
    // 28-34 move raw skeletons after finding a 20-21 move result.
    let mut raw_exploration_limit = incumbent_move_count.clamp(1, 40);
    let mut p2_cache = FmcP2Cache::default();

    // Build each axis base state once. Premove variants append only their 1-2
    // conjugated moves instead of replaying the full scramble for every attempt.
    let direct_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {
        let conjugated: Vec<u8> = scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
            .collect();
        CubeState::solved().apply_moves(&conjugated, &tables.move_data)
    });

    // --- Phase 1: Direct solve across 3 axes ---
    for axis in 0..3u8 {
        let state = direct_axis_states[axis as usize];

        let results = solve_fmc_single_axis(
            &state,
            tables,
            fmc_tables,
            max_eo_depth,
            direct_eo_limit,
            FMC_MAX_DR_DEPTH,
            FMC_MAX_P2_DEPTH,
            p2_node_limit,
            &mut p2_cache,
            &mut raw_exploration_limit,
            search_variant.wrapping_add(axis as u32 * 17),
            force_rzp,
            enable_htr_skeletons,
        );

        for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used, htr_used, skeleton_prefixes) in
            results
        {
            let cvt = |v: &[u8]| -> Vec<u8> {
                v.iter()
                    .map(|&m| fmc_tables.axis_solution_move_map[axis as usize][m as usize])
                    .collect()
            };
            let original: Vec<u8> = cvt(&moves_in_axis_frame);
            let source_tag = if htr_used { 4 } else { 0 };
            let simplified = simplify_moves(&original);
            if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_raw.len() as u8,
                    dr_len: dr_raw.len() as u8,
                    p2_len: p2_raw.len() as u8,
                    eo_moves: cvt(&eo_raw),
                    dr_moves: cvt(&dr_raw),
                    finish_moves: cvt(&p2_raw),
                    axis,
                    source_tag,
                    premove_moves: vec![],
                    rzp_used,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }

            for prefix in skeleton_prefixes {
                let original_prefix = cvt(&prefix.moves);
                if let Some(candidate) = build_skeleton_candidate(
                    &original_scramble_state,
                    original_prefix,
                    tables,
                    &prefix,
                    cvt(&prefix.eo_moves),
                    cvt(&prefix.dr_moves),
                    cvt(&prefix.finish_moves),
                    axis,
                    source_tag,
                    &[],
                    rzp_used,
                ) {
                    all_skeletons.push(candidate);
                }
            }
        }
    }

    // --- Phase 2: NISS (inverse scramble) across 3 axes ---
    let inv_scramble_moves = invert_moves(&scramble_moves);
    let inverse_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {
        let conjugated: Vec<u8> = inv_scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
            .collect();
        CubeState::solved().apply_moves(&conjugated, &tables.move_data)
    });
    for axis in 0..3u8 {
        let state = inverse_axis_states[axis as usize];

        let results = solve_fmc_single_axis(
            &state,
            tables,
            fmc_tables,
            max_eo_depth,
            direct_eo_limit,
            FMC_MAX_DR_DEPTH,
            FMC_MAX_P2_DEPTH,
            p2_node_limit,
            &mut p2_cache,
            &mut raw_exploration_limit,
            search_variant.wrapping_add(101 + axis as u32 * 17),
            force_rzp,
            enable_htr_skeletons,
        );

        for (moves_in_axis_frame, eo_raw, dr_raw, p2_raw, rzp_used, htr_used, skeleton_prefixes) in
            results
        {
            let cvt = |v: &[u8]| -> Vec<u8> {
                v.iter()
                    .map(|&m| fmc_tables.axis_solution_move_map[axis as usize][m as usize])
                    .collect()
            };
            let original: Vec<u8> = cvt(&moves_in_axis_frame);
            let source_tag = if htr_used { 5 } else { 1 };
            // NISS: invert the solution
            let inverted = invert_moves(&original);
            let simplified = simplify_moves(&inverted);
            if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
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
                    source_tag,
                    premove_moves: vec![],
                    rzp_used,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }

            for prefix in skeleton_prefixes {
                let inverse_prefix = invert_moves(&cvt(&prefix.moves));
                if let Some(candidate) = build_skeleton_candidate(
                    &original_scramble_state,
                    inverse_prefix,
                    tables,
                    &prefix,
                    cvt(&prefix.eo_moves),
                    cvt(&prefix.dr_moves),
                    cvt(&prefix.finish_moves),
                    axis,
                    source_tag,
                    &[],
                    rzp_used,
                ) {
                    all_skeletons.push(candidate);
                }
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    // Completed-solution pruning is separate from the raw skeleton frontier.
    // Multi-switch can tighten this completed ceiling, but must never shrink
    // the 28/31/34-move budget reserved for selected skeleton exploration.
    let mut completed_best = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(raw_exploration_limit);

    // --- Phase 2b: stage-boundary multi-switch NISS ---
    if enable_multi_switch_niss || deep_stage_boundary_enabled {
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
                &mut completed_best,
                force_rzp,
                deep_stage_boundary_enabled,
            );
            for result in direct_results {
                let simplified = simplify_moves(&cvt(&result.moves));
                if simplified.is_empty()
                    || simplified.len() > raw_exploration_limit
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                completed_best = completed_best.min(simplified.len());
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
                    skeleton_moves: vec![],
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
                &mut completed_best,
                force_rzp,
                deep_stage_boundary_enabled,
            );
            for result in inverse_results {
                let effective_inverse_solution = cvt(&result.moves);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > raw_exploration_limit
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                completed_best = completed_best.min(simplified.len());
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
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    // --- Phase 2c: complementary-frame short-P2 MITM rescue ---
    let completed_best_before_complementary = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if deep_complementary_mitm_enabled
        && search_level >= 3
        && completed_best_before_complementary > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
    {
        let complementary_tails = fmc_tables
            .complementary_short_p2_tails
            .get_or_init(|| build_complementary_short_p2_tails(tables));
        let complementary_scramble_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS[axis])
        });
        let complementary_solution_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS[axis])
        });

        for axis in 0..3usize {
            let conjugated_inverse: Vec<u8> = inv_scramble_moves
                .iter()
                .map(|&move_index| complementary_scramble_maps[axis][move_index as usize])
                .collect();
            let inverse_state =
                CubeState::solved().apply_moves(&conjugated_inverse, &tables.move_data);
            let eo_sequences = find_eo_sequences(
                encode_eo(&inverse_state.eo),
                tables,
                fmc_tables,
                max_eo_depth,
                1,
                0,
            );

            for eo_moves in eo_sequences.into_iter().take(1) {
                if eo_moves.is_empty() || eo_moves.len() >= FMC_COMPLEMENTARY_MITM_TARGET_TOTAL {
                    continue;
                }
                let boundary_state = inverse_state.apply_moves(&eo_moves, &tables.move_data);
                let switched_state = invert_state(&boundary_state);
                let Some((dr_moves, p2_moves)) = solve_complementary_short_p2_mitm(
                    &switched_state,
                    complementary_tails,
                    fmc_tables,
                    tables,
                ) else {
                    continue;
                };

                let mut continuation = dr_moves.clone();
                continuation.extend_from_slice(&p2_moves);
                let inverse_continuation = invert_moves(&continuation);
                let mut flattened = eo_moves.clone();
                flattened.extend_from_slice(&inverse_continuation);
                let flattened = simplify_moves(&flattened);
                if flattened.is_empty()
                    || flattened.len() > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
                    || !inverse_state
                        .apply_moves(&flattened, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }

                let convert = |moves: &[u8]| -> Vec<u8> {
                    moves
                        .iter()
                        .map(|&move_index| complementary_solution_maps[axis][move_index as usize])
                        .collect()
                };
                let effective_inverse_solution = convert(&flattened);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > raw_exploration_limit
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }

                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_moves.len() as u8,
                    eo_moves: convert(&eo_moves),
                    dr_moves: convert(&dr_moves),
                    finish_moves: convert(&p2_moves),
                    axis: axis as u8,
                    source_tag: 12,
                    premove_moves: vec![],
                    rzp_used: false,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    // --- Phase 2d: complementary-frame normal EO→DR→P2 rescue ---
    // This is intentionally much narrower than a full six-frame replay: it is
    // only active in deep Extreme while the current completed best exceeds 20.
    let completed_best_before_complementary_normal = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if deep_complementary_normal_enabled
        && search_level >= 3
        && completed_best_before_complementary_normal > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
    {
        let complementary_scramble_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS[axis])
        });
        let complementary_solution_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS[axis])
        });

        for axis in 0..3usize {
            let conjugated_direct: Vec<u8> = scramble_moves
                .iter()
                .map(|&move_index| complementary_scramble_maps[axis][move_index as usize])
                .collect();
            let direct_state =
                CubeState::solved().apply_moves(&conjugated_direct, &tables.move_data);
            let mut rescue_limit = FMC_COMPLEMENTARY_MITM_TARGET_TOTAL + 1;
            let results = solve_fmc_single_axis(
                &direct_state,
                tables,
                fmc_tables,
                max_eo_depth,
                8,
                FMC_MAX_DR_DEPTH,
                FMC_MAX_P2_DEPTH,
                2_000_000,
                &mut p2_cache,
                &mut rescue_limit,
                0,
                force_rzp,
                false,
            );

            let convert = |moves: &[u8]| -> Vec<u8> {
                moves
                    .iter()
                    .map(|&move_index| complementary_solution_maps[axis][move_index as usize])
                    .collect()
            };
            for (moves, eo_moves, dr_moves, p2_moves, rzp_used, _, _) in results {
                let simplified = simplify_moves(&convert(&moves));
                if simplified.is_empty()
                    || simplified.len() > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_moves.len() as u8,
                    eo_moves: convert(&eo_moves),
                    dr_moves: convert(&dr_moves),
                    finish_moves: convert(&p2_moves),
                    axis: axis as u8,
                    source_tag: 13,
                    premove_moves: vec![],
                    rzp_used,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    // --- Phase 2e: bounded pre-EO NISS switch rescue ---
    let completed_best_before_pre_eo = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if deep_pre_eo_enabled
        && search_level >= 3
        && completed_best_before_pre_eo > FMC_PRE_EO_NISS_TARGET_TOTAL
    {
        let pre_eo_tails = fmc_tables
            .pre_eo_short_p2_tails
            .get_or_init(|| build_pre_eo_short_p2_tails(tables));
        let mut accepted_inverse = false;

        for axis in 0..3usize {
            let results = solve_pre_eo_niss_single_axis(
                &inverse_axis_states[axis],
                tables,
                fmc_tables,
                max_eo_depth,
                pre_eo_tails,
            );
            let convert = |moves: &[u8]| -> Vec<u8> {
                moves
                    .iter()
                    .map(|&move_index| fmc_tables.axis_solution_move_map[axis][move_index as usize])
                    .collect()
            };
            for result in results {
                let effective_inverse_solution = convert(&result.moves);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                let mut eo_metadata = result.prefix_moves.clone();
                eo_metadata.extend_from_slice(&result.eo_moves);
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_metadata.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.p2_moves.len() as u8,
                    eo_moves: convert(&eo_metadata),
                    dr_moves: convert(&result.dr_moves),
                    finish_moves: convert(&result.p2_moves),
                    axis: axis as u8,
                    source_tag: 14,
                    premove_moves: vec![],
                    rzp_used: false,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
                accepted_inverse = true;
            }
            if accepted_inverse {
                break;
            }
        }

        if !accepted_inverse {
            for axis in 0..3usize {
                let results = solve_pre_eo_niss_single_axis(
                    &direct_axis_states[axis],
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    pre_eo_tails,
                );
                let convert = |moves: &[u8]| -> Vec<u8> {
                    moves
                        .iter()
                        .map(|&move_index| {
                            fmc_tables.axis_solution_move_map[axis][move_index as usize]
                        })
                        .collect()
                };
                for result in results {
                    let simplified = simplify_moves(&convert(&result.moves));
                    if simplified.is_empty()
                        || simplified.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
                        || !original_scramble_state
                            .apply_moves(&simplified, &tables.move_data)
                            .is_solved()
                    {
                        continue;
                    }
                    if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                        reverse_scramble_rejected_count += 1;
                        continue;
                    }
                    let mut eo_metadata = result.prefix_moves.clone();
                    eo_metadata.extend_from_slice(&result.eo_moves);
                    all_candidates.push(FmcCandidate {
                        moves: simplified,
                        eo_len: eo_metadata.len() as u8,
                        dr_len: result.dr_moves.len() as u8,
                        p2_len: result.p2_moves.len() as u8,
                        eo_moves: convert(&eo_metadata),
                        dr_moves: convert(&result.dr_moves),
                        finish_moves: convert(&result.p2_moves),
                        axis: axis as u8,
                        source_tag: 15,
                        premove_moves: vec![],
                        rzp_used: false,
                        skeleton_moves: vec![],
                        insertion_moves: vec![],
                        insertion_position: None,
                        skeleton_kind: None,
                        insertion_steps: vec![],
                    });
                }
                if all_candidates
                    .iter()
                    .any(|candidate| matches!(candidate.source_tag, 14 | 15))
                {
                    break;
                }
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    completed_best = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(completed_best);

    // --- Phase 3: Premove sweep ---
    let premove_sets = &*FMC_PREMOVE_SETS;
    let pm_limit = max_premove_sets.min(premove_sets.len());

    for pm_idx in 0..pm_limit {
        let premove_index = if premove_sets.is_empty() {
            0
        } else {
            ((search_variant as usize * 37) + pm_idx * 53) % premove_sets.len()
        };
        let premove = &premove_sets[premove_index];
        let pm_set = &premove.moves;
        let conjugated_premoves = &premove.axis_moves;
        // One diverse premove set keeps the independent raw frontier alive.
        // All remaining premove sets use the completed-solution ceiling,
        // avoiding the 144-way depth-34 explosion observed in the full fix.
        let use_raw_premove_frontier = search_level >= 3 && pm_idx == 0;

        // Direct with premoves: effective = scramble + premoves
        {
            for axis in 0..3u8 {
                let state = direct_axis_states[axis as usize]
                    .apply_moves(&conjugated_premoves[axis as usize], &tables.move_data);

                // Use a tighter budget check: skip if premove_len + best possible pipeline >= best
                let pm_len = pm_set.len();

                let mut premove_search_limit = if use_raw_premove_frontier {
                    raw_exploration_limit
                } else {
                    completed_best
                };
                let results = solve_fmc_single_axis(
                    &state,
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    premove_eo_limit,
                    FMC_MAX_DR_DEPTH,
                    FMC_MAX_P2_DEPTH,
                    premove_p2_node_limit,
                    &mut p2_cache,
                    &mut premove_search_limit,
                    search_variant
                        .wrapping_add(1009)
                        .wrapping_add(pm_idx as u32 * 131)
                        .wrapping_add(axis as u32 * 17),
                    force_rzp,
                    enable_htr_skeletons,
                );

                for (
                    moves_in_axis,
                    eo_raw,
                    dr_raw,
                    p2_raw,
                    rzp_used,
                    htr_used,
                    skeleton_prefixes,
                ) in results
                {
                    let cvt = |v: &[u8]| -> Vec<u8> {
                        v.iter()
                            .map(|&m| fmc_tables.axis_solution_move_map[axis as usize][m as usize])
                            .collect()
                    };
                    let original: Vec<u8> = cvt(&moves_in_axis);
                    let source_tag = if htr_used { 6 } else { 2 };
                    // Direct premove: solution = premoves + pipeline_solution
                    let mut full = pm_set.clone();
                    full.extend_from_slice(&original);
                    let simplified = simplify_moves(&full);
                    if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
                        all_candidates.push(FmcCandidate {
                            moves: simplified,
                            eo_len: eo_raw.len() as u8,
                            dr_len: dr_raw.len() as u8,
                            p2_len: p2_raw.len() as u8,
                            eo_moves: cvt(&eo_raw),
                            dr_moves: cvt(&dr_raw),
                            finish_moves: cvt(&p2_raw),
                            axis,
                            source_tag,
                            premove_moves: pm_set.clone(),
                            rzp_used,
                            skeleton_moves: vec![],
                            insertion_moves: vec![],
                            insertion_position: None,
                            skeleton_kind: None,
                            insertion_steps: vec![],
                        });
                    }

                    for prefix in skeleton_prefixes {
                        let mut full_prefix = pm_set.clone();
                        full_prefix.extend_from_slice(&cvt(&prefix.moves));
                        if let Some(candidate) = build_skeleton_candidate(
                            &original_scramble_state,
                            full_prefix,
                            tables,
                            &prefix,
                            cvt(&prefix.eo_moves),
                            cvt(&prefix.dr_moves),
                            cvt(&prefix.finish_moves),
                            axis,
                            source_tag,
                            pm_set,
                            rzp_used,
                        ) {
                            all_skeletons.push(candidate);
                        }
                    }
                }
            }
        }

        // NISS with premoves: effective = inv_scramble + premoves
        {
            for axis in 0..3u8 {
                let state = inverse_axis_states[axis as usize]
                    .apply_moves(&conjugated_premoves[axis as usize], &tables.move_data);

                let mut premove_search_limit = if use_raw_premove_frontier {
                    raw_exploration_limit
                } else {
                    completed_best
                };
                let results = solve_fmc_single_axis(
                    &state,
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    premove_eo_limit,
                    FMC_MAX_DR_DEPTH,
                    FMC_MAX_P2_DEPTH,
                    premove_p2_node_limit,
                    &mut p2_cache,
                    &mut premove_search_limit,
                    search_variant
                        .wrapping_add(2003)
                        .wrapping_add(pm_idx as u32 * 131)
                        .wrapping_add(axis as u32 * 17),
                    force_rzp,
                    enable_htr_skeletons,
                );

                for (
                    moves_in_axis,
                    eo_raw,
                    dr_raw,
                    p2_raw,
                    rzp_used,
                    htr_used,
                    skeleton_prefixes,
                ) in results
                {
                    let cvt = |v: &[u8]| -> Vec<u8> {
                        v.iter()
                            .map(|&m| fmc_tables.axis_solution_move_map[axis as usize][m as usize])
                            .collect()
                    };
                    let original: Vec<u8> = cvt(&moves_in_axis);
                    let source_tag = if htr_used { 7 } else { 3 };
                    // NISS premove: solution = inv(pipeline) + inv(premoves)
                    let mut full = invert_moves(&original);
                    full.extend_from_slice(&invert_moves(pm_set));
                    let simplified = simplify_moves(&full);
                    if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
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
                            source_tag,
                            premove_moves: pm_set.clone(),
                            rzp_used,
                            skeleton_moves: vec![],
                            insertion_moves: vec![],
                            insertion_position: None,
                            skeleton_kind: None,
                            insertion_steps: vec![],
                        });
                    }

                    for prefix in skeleton_prefixes {
                        let mut full_prefix = invert_moves(&cvt(&prefix.moves));
                        full_prefix.extend_from_slice(&invert_moves(pm_set));
                        if let Some(candidate) = build_skeleton_candidate(
                            &original_scramble_state,
                            full_prefix,
                            tables,
                            &prefix,
                            cvt(&prefix.eo_moves),
                            cvt(&prefix.dr_moves),
                            cvt(&prefix.finish_moves),
                            axis,
                            source_tag,
                            pm_set,
                            rzp_used,
                        ) {
                            all_skeletons.push(candidate);
                        }
                    }
                }
            }
        }
    }

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    let multi_switch_niss_candidate_count = all_candidates
        .iter()
        .filter(|candidate| (8..=11).contains(&candidate.source_tag))
        .count();

    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);
    all_skeletons.extend(relocation_skeletons);
    if enable_slice_insertion {
        let slice_skeletons = synthesize_slice_relocation_skeletons(&all_candidates, fmc_tables);
        all_skeletons.extend(slice_skeletons);
    } else {
        all_skeletons.retain(|skeleton| skeleton.kind != FmcSkeletonKind::Slice);
    }
    if enable_multi_insertion {
        let multi_relocation_skeletons =
            synthesize_multi_relocation_skeletons(&all_candidates, fmc_tables);
        all_skeletons.extend(multi_relocation_skeletons);
    } else {
        all_skeletons.retain(|skeleton| skeleton.kind.is_single_insertion());
    }
    let skeletons = finalize_skeleton_beam(all_skeletons, skeleton_beam_limit);

    let mut inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut inserted_candidates, &reverse_scramble_canonical);
    let single_best = all_candidates
        .iter()
        .chain(inserted_candidates.iter())
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    let (
        mut multi_inserted_candidates,
        multi_insertion_transition_count,
        multi_insertion_pair_count,
    ) = if enable_multi_insertion {
        optimize_multi_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables)
    } else {
        (Vec::new(), 0, 0)
    };
    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut multi_inserted_candidates,
        &reverse_scramble_canonical,
    );
    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);

    let mixed_insertion_candidate_count = inserted_candidates
        .iter()
        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Corner2Edge2))
        .count();
    let slice_insertion_candidate_count = inserted_candidates
        .iter()
        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Slice))
        .count();
    let multi_insertion_candidate_count = multi_inserted_candidates.len();
    let insertion_candidate_count = inserted_candidates.len() + multi_insertion_candidate_count;
    all_candidates.extend(inserted_candidates);
    all_candidates.extend(multi_inserted_candidates);

    // Sort by final move count, preferring an insertion result on exact ties.
    all_candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.skeleton_kind.is_none(),
            candidate.source_tag,
            candidate.axis,
        )
    });

    // Deduplicate by final solution.
    let mut seen = std::collections::HashSet::new();
    all_candidates.retain(|candidate| seen.insert(candidate.moves.clone()));
    // Keep a wider raw frontier until the public verifier rejects or repairs
    // malformed premove-NISS flattenings. The caller re-ranks verified results.
    all_candidates.truncate(32);

    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
        insertion_candidate_count,
        mixed_insertion_candidate_count,
        multi_insertion_candidate_count,
        multi_insertion_transition_count,
        multi_insertion_pair_count,
        slice_insertion_candidate_count,
        multi_switch_niss_candidate_count,
        reverse_scramble_rejected_count,
    }
}

fn fmc_result_best_move_count(result: &FmcResult) -> usize {
    result
        .candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX)
}

/// Run the selected human FMC frontier. L3 performs additional independent
/// variants inside the same method; no alternate solver or EO-depth fallback runs.
pub fn solve_fmc(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    deep_component_mask: u8,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
) -> FmcResult {
    let requested_eo_depth = FMC_MAX_EO_DEPTH.saturating_add(search_level.min(3));
    let primary = solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        deep_component_mask,
        search_level,
        search_variant,
        incumbent_move_count,
        requested_eo_depth,
    );
    if !primary.ok {
        return primary;
    }

    let mut best_result = primary;
    let mut best_count = fmc_result_best_move_count(&best_result);

    if search_level >= 3 && best_count > FMC_EXTREME_RETRY_TARGET {
        let secondary_variant = solve_fmc_with_eo_depth(
            scramble,
            tables,
            fmc_tables,
            max_premove_sets,
            force_rzp,
            enable_multi_insertion,
            enable_htr_skeletons,
            enable_slice_insertion,
            enable_multi_switch_niss,
            enable_deep_multi_switch_niss,
            deep_component_mask,
            search_level,
            search_variant.wrapping_add(FMC_EXTREME_RETRY_VARIANT_OFFSET),
            incumbent_move_count,
            requested_eo_depth,
        );
        let secondary_count = fmc_result_best_move_count(&secondary_variant);
        if secondary_variant.ok && secondary_count < best_count {
            best_result = secondary_variant;
            best_count = secondary_count;
        }
    }

    if search_level >= 3 && best_count > FMC_EXTREME_SUB20_TARGET {
        let sub20_variant = solve_fmc_with_eo_depth(
            scramble,
            tables,
            fmc_tables,
            max_premove_sets,
            force_rzp,
            enable_multi_insertion,
            enable_htr_skeletons,
            enable_slice_insertion,
            enable_multi_switch_niss,
            enable_deep_multi_switch_niss,
            deep_component_mask,
            search_level,
            search_variant.wrapping_add(FMC_EXTREME_SUB20_VARIANT_OFFSET),
            incumbent_move_count,
            requested_eo_depth,
        );
        let sub20_count = fmc_result_best_move_count(&sub20_variant);
        if sub20_variant.ok && sub20_count < best_count {
            best_result = sub20_variant;
        }
    }

    best_result
}

/// Convert FmcCandidate to a JSON-friendly representation.
pub fn candidate_to_json(candidate: &FmcCandidate, tables: &TwophaseTables) -> serde_json::Value {
    let solution = solution_string_from_path(&candidate.moves, &tables.move_data);
    let premove_str = if candidate.premove_moves.is_empty() {
        String::new()
    } else {
        solution_string_from_path(&candidate.premove_moves, &tables.move_data)
    };
    let premove_index = if candidate.premove_moves.is_empty() {
        None
    } else {
        FMC_PREMOVE_SETS
            .iter()
            .position(|premove| premove.moves == candidate.premove_moves)
    };
    let base_source = match candidate.source_tag {
        0 => format!("FMC_EO_{}", AXIS_NAMES[candidate.axis as usize]),
        1 => format!("FMC_NISS_{}", AXIS_NAMES[candidate.axis as usize]),
        2 => format!("FMC_PREMOVE_{}", AXIS_NAMES[candidate.axis as usize]),
        3 => format!("FMC_PREMOVE_NISS_{}", AXIS_NAMES[candidate.axis as usize]),
        4 => format!("FMC_HTR_EO_{}", AXIS_NAMES[candidate.axis as usize]),
        5 => format!("FMC_HTR_NISS_{}", AXIS_NAMES[candidate.axis as usize]),
        6 => format!("FMC_HTR_PREMOVE_{}", AXIS_NAMES[candidate.axis as usize]),
        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        8 => format!(
            "FMC_MULTI_NISS_EO_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        9 => format!(
            "FMC_MULTI_NISS_DR_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        10 => format!(
            "FMC_MULTI_NISS_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        11 => format!(
            "FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        13 => format!(
            "FMC_COMPLEMENTARY_NORMAL_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        14 => format!(
            "FMC_PRE_EO_NISS_INVERSE_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        15 => format!(
            "FMC_PRE_EO_NISS_DIRECT_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
        _ => "FMC_UNKNOWN".into(),
    };
    let source = if let Some(kind) = candidate.skeleton_kind {
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

    let eo_moves_str: Vec<&str> = candidate
        .eo_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let dr_moves_str: Vec<&str> = candidate
        .dr_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let finish_moves_str: Vec<&str> = candidate
        .finish_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let skeleton_solution = if candidate.skeleton_moves.is_empty() {
        String::new()
    } else {
        solution_string_from_path(&candidate.skeleton_moves, &tables.move_data)
    };
    let raw_insertion_move_count = candidate.skeleton_moves.len()
        + candidate
            .insertion_steps
            .iter()
            .map(|step| step.moves.len())
            .sum::<usize>();
    let cancellation_count = raw_insertion_move_count.saturating_sub(candidate.moves.len());

    let mut value = serde_json::json!({
        "ok": true,
        "solution": solution,
        "moveCount": candidate.moves.len(),
        "eoLength": candidate.eo_len,
        "drLength": candidate.dr_len,
        "p2Length": candidate.p2_len,
        "eoMoves": eo_moves_str,
        "drMoves": dr_moves_str,
        "finishMoves": finish_moves_str,
        "axisName": AXIS_NAMES[candidate.axis as usize],
        "source": source,
        "premoves": premove_str,
        "premoveIndex": premove_index,
        "moves": solution.split_whitespace().collect::<Vec<_>>(),
        "rzpUsed": candidate.rzp_used,
    });

    if let (Some(kind), Some(position)) = (candidate.skeleton_kind, candidate.insertion_position) {
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
        object.insert(
            "skeletonSolution".into(),
            serde_json::json!(skeleton_solution),
        );
        object.insert(
            "skeletonMoveCount".into(),
            serde_json::json!(candidate.skeleton_moves.len()),
        );
        object.insert(
            "rawInsertionMoveCount".into(),
            serde_json::json!(raw_insertion_move_count),
        );
        object.insert(
            "cancellationCount".into(),
            serde_json::json!(cancellation_count),
        );
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

    value
}

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
        4 => format!("FMC_HTR_EO_{}", AXIS_NAMES[skeleton.axis as usize]),
        5 => format!("FMC_HTR_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        6 => format!("FMC_HTR_PREMOVE_{}", AXIS_NAMES[skeleton.axis as usize]),
        7 => format!(
            "FMC_HTR_PREMOVE_NISS_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        8 => format!(
            "FMC_MULTI_NISS_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        9 => format!(
            "FMC_MULTI_NISS_DR_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        10 => format!(
            "FMC_MULTI_NISS_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        11 => format!(
            "FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        13 => format!(
            "FMC_COMPLEMENTARY_NORMAL_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
        _ => "FMC_UNKNOWN".into(),
    };
    let (corner_defect_positions, edge_defect_positions) = match skeleton.kind {
        FmcSkeletonKind::Corner3 => (skeleton.defect_positions.clone(), vec![]),
        FmcSkeletonKind::Edge3 => (vec![], skeleton.defect_positions.clone()),
        FmcSkeletonKind::Corner2Edge2 => (
            skeleton.defect_positions[..2].to_vec(),
            skeleton.defect_positions[2..].to_vec(),
        ),
        FmcSkeletonKind::Slice => (vec![], skeleton.defect_positions.clone()),
        FmcSkeletonKind::Corner4 => (skeleton.defect_positions.clone(), vec![]),
        FmcSkeletonKind::Edge4 => (vec![], skeleton.defect_positions.clone()),
        FmcSkeletonKind::Corner3Edge3 => (
            skeleton.defect_positions[..3].to_vec(),
            skeleton.defect_positions[3..].to_vec(),
        ),
    };
    let estimated_insertion_cost = skeleton.kind.estimated_insertion_cost();
    let eo_moves: Vec<&str> = skeleton
        .eo_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let dr_moves: Vec<&str> = skeleton
        .dr_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let finish_moves: Vec<&str> = skeleton
        .finish_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();

    serde_json::json!({
        "kind": skeleton.kind.as_str(),
        "solution": solution,
        "moveCount": skeleton.moves.len(),
        "estimatedInsertionCost": estimated_insertion_cost,
        "estimatedFinalMoveCount": skeleton.moves.len() + estimated_insertion_cost,
        "defectPositions": skeleton.defect_positions,
        "cornerDefectPositions": corner_defect_positions,
        "edgeDefectPositions": edge_defect_positions,
        "eoLength": skeleton.eo_len,
        "drLength": skeleton.dr_len,
        "p2PrefixLength": skeleton.p2_len,
        "eoMoves": eo_moves,
        "drMoves": dr_moves,
        "finishMoves": finish_moves,
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
            classify_insertion_leftover(&state),
            Some((FmcSkeletonKind::Corner3, vec![0, 1, 2]))
        );
    }

    #[test]
    fn classifies_pure_edge_three_cycle() {
        let mut state = CubeState::solved();
        state.ep[4] = 5;
        state.ep[5] = 6;
        state.ep[6] = 4;
        assert_eq!(
            classify_insertion_leftover(&state),
            Some((FmcSkeletonKind::Edge3, vec![4, 5, 6]))
        );
    }

    #[test]
    fn classifies_orientation_preserving_two_corner_two_edge_swap() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 0;
        state.ep[4] = 5;
        state.ep[5] = 4;
        assert_eq!(
            classify_insertion_leftover(&state),
            Some((FmcSkeletonKind::Corner2Edge2, vec![0, 1, 4, 5]))
        );
    }

    #[test]
    fn cube_state_inverse_and_composition_cancel() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 2;
        state.cp[2] = 0;
        state.ep[4] = 5;
        state.ep[5] = 6;
        state.ep[6] = 4;
        let inverse = invert_cube_state(&state);
        assert!(compose_cube_states(&state, &inverse).is_solved());
        assert!(compose_cube_states(&inverse, &state).is_solved());
    }

    #[test]
    fn relative_state_reconstructs_target() {
        let mut from = CubeState::solved();
        from.cp[0] = 1;
        from.cp[1] = 2;
        from.cp[2] = 0;
        let mut to = CubeState::solved();
        to.ep[0] = 1;
        to.ep[1] = 2;
        to.ep[2] = 0;
        let relative = relative_cube_state(&from, &to);
        assert_eq!(compose_cube_states(&from, &relative), to);
    }

    #[test]
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
            Some((FmcSkeletonKind::Corner3Edge3, vec![0, 1, 2, 4, 5, 6]))
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
        oriented.cp[0] = 1;
        oriented.cp[1] = 2;
        oriented.cp[2] = 0;
        oriented.co[0] = 1;
        assert_eq!(classify_insertion_leftover(&oriented), None);
    }

    #[test]
    fn recognizes_reverse_scramble_notation_under_axis_commutation() {
        let reverse = vec![3, 10, 1, 4]; // R D' U' R'
        let reverse_canonical = canonicalize_commuting_axis_blocks(&reverse);
        assert!(is_trivial_reverse_solution(
            &[3, 1, 10, 4], // R U' D' R'
            &reverse_canonical,
        ));
        assert_eq!(
            canonicalize_commuting_axis_blocks(&[4, 0, 9, 1]), // R' U D U'
            canonicalize_commuting_axis_blocks(&[4, 9]),       // R' D
        );
        assert!(!is_trivial_reverse_solution(
            &[3, 1, 11, 4], // R U' D2 R'
            &reverse_canonical,
        ));
    }
}
