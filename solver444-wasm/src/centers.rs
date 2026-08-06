use core::fmt;
use std::collections::VecDeque;
use std::sync::OnceLock;

use crate::geometry::{move_permutation, sticker_geometry, FACELET_COUNT};
use crate::{Cube444, Move444};

const CENTER_COUNT: usize = 24;
const PHASE1_STATE_COUNT: usize = 735_471; // C(24, 8)
const PHASE2_STATE_COUNT: usize = 70; // C(8, 4)
const PHASE3_STATE_COUNT: usize = 12_870; // C(16, 8)
const PHASE4_STATE_COUNT: usize = 4_900; // C(8, 4)^2
const UNVISITED: u8 = u8::MAX;

const U: u8 = 0;
const R: u8 = 1;
const F: u8 = 2;
const D: u8 = 3;
const L: u8 = 4;

const ALL_CENTER_POSITIONS: [u8; 24] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
];
const UD_POSITIONS: [u8; 8] = [0, 1, 2, 3, 12, 13, 14, 15];
const SIDE_POSITIONS: [u8; 16] = [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23];
const RL_POSITIONS: [u8; 8] = [4, 5, 6, 7, 16, 17, 18, 19];
const FB_POSITIONS: [u8; 8] = [8, 9, 10, 11, 20, 21, 22, 23];

const GOAL_UD_GROUP: u32 = bits(&UD_POSITIONS);
const GOAL_U: u32 = bits(&[0, 1, 2, 3]);
const GOAL_RL_GROUP: u32 = bits(&RL_POSITIONS);
const GOAL_R: u32 = bits(&[4, 5, 6, 7]);
const GOAL_F: u32 = bits(&[8, 9, 10, 11]);

const fn bits(positions: &[u8]) -> u32 {
    let mut mask = 0u32;
    let mut index = 0usize;
    while index < positions.len() {
        mask |= 1u32 << positions[index];
        index += 1;
    }
    mask
}

const fn binomial_table() -> [[usize; 9]; 25] {
    let mut table = [[0usize; 9]; 25];
    let mut n = 0usize;
    while n < 25 {
        table[n][0] = 1;
        let mut k = 1usize;
        while k < 9 {
            table[n][k] = if k > n {
                0
            } else if k == n {
                1
            } else if n == 0 {
                0
            } else {
                table[n - 1][k - 1] + table[n - 1][k]
            };
            k += 1;
        }
        n += 1;
    }
    table
}

const BINOMIAL: [[usize; 9]; 25] = binomial_table();

#[derive(Clone, Debug)]
struct CenterMove {
    mv: Move444,
    permutation: [u8; CENTER_COUNT],
}

#[derive(Debug)]
struct CenterTables {
    phase1_moves: Vec<CenterMove>,
    phase2_moves: Vec<CenterMove>,
    phase3_moves: Vec<CenterMove>,
    phase4_moves: Vec<CenterMove>,
    phase1_distance: Vec<u8>,
    phase2_distance: Vec<u8>,
    phase3_distance: Vec<u8>,
    phase4_distance: Vec<u8>,
    build_ms: f64,
}

static CENTER_TABLES: OnceLock<CenterTables> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct CenterSolveResult {
    pub moves: Vec<Move444>,
    pub table_build_ms: f64,
    pub search_ms: f64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CenterSolveError {
    DeadlineReached,
    TableStateCount {
        phase: &'static str,
        expected: usize,
        actual: usize,
    },
    CoordinateNotReachable(&'static str),
    NoDescendingMove(&'static str),
    VerificationFailed,
}

impl fmt::Display for CenterSolveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DeadlineReached => write!(formatter, "4x4 center deadline reached"),
            Self::TableStateCount {
                phase,
                expected,
                actual,
            } => write!(
                formatter,
                "4x4 center {phase} table size mismatch: expected {expected}, got {actual}"
            ),
            Self::CoordinateNotReachable(phase) => {
                write!(formatter, "4x4 center {phase} coordinate is unreachable")
            }
            Self::NoDescendingMove(phase) => {
                write!(formatter, "4x4 center {phase} has no descending move")
            }
            Self::VerificationFailed => write!(formatter, "4x4 center verification failed"),
        }
    }
}

impl std::error::Error for CenterSolveError {}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

fn deadline_reached(deadline_ts: f64) -> bool {
    deadline_ts.is_finite() && deadline_ts > 0.0 && now_ms() >= deadline_ts
}

fn check_deadline(deadline_ts: f64) -> Result<(), CenterSolveError> {
    if deadline_reached(deadline_ts) {
        Err(CenterSolveError::DeadlineReached)
    } else {
        Ok(())
    }
}

fn center_facelet_indices() -> [usize; CENTER_COUNT] {
    let mut result = [0usize; CENTER_COUNT];
    let mut count = 0usize;
    for facelet in 0..FACELET_COUNT {
        let position = sticker_geometry(facelet).pos;
        let exposed_axes = [position.x, position.y, position.z]
            .into_iter()
            .filter(|coordinate| coordinate.abs() == 3)
            .count();
        if exposed_axes == 1 {
            result[count] = facelet;
            count += 1;
        }
    }
    assert_eq!(count, CENTER_COUNT, "invalid 4x4 center geometry");
    result
}

fn all_center_moves() -> Vec<CenterMove> {
    let center_facelets = center_facelet_indices();
    let mut facelet_to_center = [u8::MAX; FACELET_COUNT];
    for (center, &facelet) in center_facelets.iter().enumerate() {
        facelet_to_center[facelet] = center as u8;
    }

    Move444::all()
        .into_iter()
        .map(|mv| {
            let facelet_permutation = move_permutation(mv);
            let mut permutation = [0u8; CENTER_COUNT];
            for (old_center, &old_facelet) in center_facelets.iter().enumerate() {
                let target_facelet = facelet_permutation[old_facelet] as usize;
                let target_center = facelet_to_center[target_facelet];
                assert_ne!(target_center, u8::MAX, "center moved outside center orbit");
                permutation[old_center] = target_center;
            }
            CenterMove { mv, permutation }
        })
        .collect()
}

fn apply_mask(mask: u32, permutation: &[u8; CENTER_COUNT]) -> u32 {
    let mut remaining = mask;
    let mut result = 0u32;
    while remaining != 0 {
        let old = remaining.trailing_zeros() as usize;
        result |= 1u32 << permutation[old];
        remaining &= remaining - 1;
    }
    result
}

fn coordinate_rank(mask: u32, positions: &[u8], expected_bits: usize) -> usize {
    let mut rank = 0usize;
    let mut selected = 0usize;
    for (local_position, &global_position) in positions.iter().enumerate() {
        if mask & (1u32 << global_position) != 0 {
            selected += 1;
            rank += BINOMIAL[local_position][selected];
        }
    }
    debug_assert_eq!(selected, expected_bits);
    rank
}

fn build_single_table(
    goal: u32,
    positions: &[u8],
    expected_bits: usize,
    moves: &[CenterMove],
    expected_states: usize,
    phase: &'static str,
    deadline_ts: f64,
) -> Result<Vec<u8>, CenterSolveError> {
    let mut distance = vec![UNVISITED; expected_states];
    let goal_rank = coordinate_rank(goal, positions, expected_bits);
    distance[goal_rank] = 0;
    let mut queue = VecDeque::with_capacity(expected_states);
    queue.push_back(goal);
    let mut visited = 1usize;
    let mut expanded = 0usize;

    while let Some(mask) = queue.pop_front() {
        if expanded & 0x0fff == 0 {
            check_deadline(deadline_ts)?;
        }
        expanded += 1;
        let current_distance = distance[coordinate_rank(mask, positions, expected_bits)];
        for center_move in moves {
            let next = apply_mask(mask, &center_move.permutation);
            let rank = coordinate_rank(next, positions, expected_bits);
            if distance[rank] == UNVISITED {
                distance[rank] = current_distance + 1;
                queue.push_back(next);
                visited += 1;
            }
        }
    }

    if visited != expected_states {
        return Err(CenterSolveError::TableStateCount {
            phase,
            expected: expected_states,
            actual: visited,
        });
    }
    Ok(distance)
}

fn build_pair_table(
    goal_first: u32,
    first_positions: &[u8],
    goal_second: u32,
    second_positions: &[u8],
    moves: &[CenterMove],
    deadline_ts: f64,
) -> Result<Vec<u8>, CenterSolveError> {
    let single_count = PHASE2_STATE_COUNT;
    let mut distance = vec![UNVISITED; PHASE4_STATE_COUNT];
    let pair_rank = |first: u32, second: u32| {
        coordinate_rank(first, first_positions, 4) * single_count
            + coordinate_rank(second, second_positions, 4)
    };
    distance[pair_rank(goal_first, goal_second)] = 0;
    let mut queue = VecDeque::with_capacity(PHASE4_STATE_COUNT);
    queue.push_back((goal_first, goal_second));
    let mut visited = 1usize;
    let mut expanded = 0usize;

    while let Some((first, second)) = queue.pop_front() {
        if expanded & 0x03ff == 0 {
            check_deadline(deadline_ts)?;
        }
        expanded += 1;
        let current_distance = distance[pair_rank(first, second)];
        for center_move in moves {
            let next_first = apply_mask(first, &center_move.permutation);
            let next_second = apply_mask(second, &center_move.permutation);
            let rank = pair_rank(next_first, next_second);
            if distance[rank] == UNVISITED {
                distance[rank] = current_distance + 1;
                queue.push_back((next_first, next_second));
                visited += 1;
            }
        }
    }

    if visited != PHASE4_STATE_COUNT {
        return Err(CenterSolveError::TableStateCount {
            phase: "phase4",
            expected: PHASE4_STATE_COUNT,
            actual: visited,
        });
    }
    Ok(distance)
}

impl CenterTables {
    fn build(deadline_ts: f64) -> Result<Self, CenterSolveError> {
        let started = now_ms();
        check_deadline(deadline_ts)?;
        let phase1_moves = all_center_moves();
        let phase2_moves: Vec<_> = phase1_moves
            .iter()
            .filter(|center_move| {
                apply_mask(GOAL_UD_GROUP, &center_move.permutation) == GOAL_UD_GROUP
            })
            .cloned()
            .collect();
        let phase3_moves: Vec<_> = phase2_moves
            .iter()
            .filter(|center_move| apply_mask(GOAL_U, &center_move.permutation) == GOAL_U)
            .cloned()
            .collect();
        let phase4_moves: Vec<_> = phase3_moves
            .iter()
            .filter(|center_move| {
                apply_mask(GOAL_RL_GROUP, &center_move.permutation) == GOAL_RL_GROUP
            })
            .cloned()
            .collect();

        let phase1_distance = build_single_table(
            GOAL_UD_GROUP,
            &ALL_CENTER_POSITIONS,
            8,
            &phase1_moves,
            PHASE1_STATE_COUNT,
            "phase1",
            deadline_ts,
        )?;
        let phase2_distance = build_single_table(
            GOAL_U,
            &UD_POSITIONS,
            4,
            &phase2_moves,
            PHASE2_STATE_COUNT,
            "phase2",
            deadline_ts,
        )?;
        let phase3_distance = build_single_table(
            GOAL_RL_GROUP,
            &SIDE_POSITIONS,
            8,
            &phase3_moves,
            PHASE3_STATE_COUNT,
            "phase3",
            deadline_ts,
        )?;
        let phase4_distance = build_pair_table(
            GOAL_R,
            &RL_POSITIONS,
            GOAL_F,
            &FB_POSITIONS,
            &phase4_moves,
            deadline_ts,
        )?;
        check_deadline(deadline_ts)?;

        Ok(Self {
            phase1_moves,
            phase2_moves,
            phase3_moves,
            phase4_moves,
            phase1_distance,
            phase2_distance,
            phase3_distance,
            phase4_distance,
            build_ms: (now_ms() - started).max(0.0),
        })
    }
}

fn get_tables(deadline_ts: f64) -> Result<&'static CenterTables, CenterSolveError> {
    if let Some(tables) = CENTER_TABLES.get() {
        return Ok(tables);
    }
    let built = CenterTables::build(deadline_ts)?;
    let _ = CENTER_TABLES.set(built);
    CENTER_TABLES
        .get()
        .ok_or(CenterSolveError::CoordinateNotReachable("table-cache"))
}

fn center_color_mask(state: &Cube444, colors: &[u8]) -> u32 {
    let center_facelets = center_facelet_indices();
    let mut mask = 0u32;
    for (center, &facelet) in center_facelets.iter().enumerate() {
        if colors.contains(&state.stickers()[facelet]) {
            mask |= 1u32 << center;
        }
    }
    mask
}

// The phase descriptor is intentionally explicit at this correctness boundary.
#[allow(clippy::too_many_arguments)]
fn descend_single(
    state: &mut Cube444,
    output: &mut Vec<Move444>,
    colors: &[u8],
    positions: &[u8],
    expected_bits: usize,
    distance: &[u8],
    moves: &[CenterMove],
    phase: &'static str,
    deadline_ts: f64,
) -> Result<(), CenterSolveError> {
    let mut mask = center_color_mask(state, colors);
    let mut current_distance = distance[coordinate_rank(mask, positions, expected_bits)];
    if current_distance == UNVISITED {
        return Err(CenterSolveError::CoordinateNotReachable(phase));
    }

    while current_distance > 0 {
        check_deadline(deadline_ts)?;
        let mut selected = None;
        for center_move in moves {
            let next = apply_mask(mask, &center_move.permutation);
            let next_distance = distance[coordinate_rank(next, positions, expected_bits)];
            if next_distance + 1 == current_distance {
                selected = Some((center_move.mv, next, next_distance));
                break;
            }
        }
        let (mv, next, next_distance) =
            selected.ok_or(CenterSolveError::NoDescendingMove(phase))?;
        state.apply_move(mv);
        output.push(mv);
        mask = next;
        current_distance = next_distance;
    }
    Ok(())
}

fn descend_pair(
    state: &mut Cube444,
    output: &mut Vec<Move444>,
    deadline_ts: f64,
    tables: &CenterTables,
) -> Result<(), CenterSolveError> {
    let pair_rank = |first: u32, second: u32| {
        coordinate_rank(first, &RL_POSITIONS, 4) * PHASE2_STATE_COUNT
            + coordinate_rank(second, &FB_POSITIONS, 4)
    };
    let mut first = center_color_mask(state, &[R]);
    let mut second = center_color_mask(state, &[F]);
    let mut current_distance = tables.phase4_distance[pair_rank(first, second)];
    if current_distance == UNVISITED {
        return Err(CenterSolveError::CoordinateNotReachable("phase4"));
    }

    while current_distance > 0 {
        check_deadline(deadline_ts)?;
        let mut selected = None;
        for center_move in &tables.phase4_moves {
            let next_first = apply_mask(first, &center_move.permutation);
            let next_second = apply_mask(second, &center_move.permutation);
            let next_distance = tables.phase4_distance[pair_rank(next_first, next_second)];
            if next_distance + 1 == current_distance {
                selected = Some((center_move.mv, next_first, next_second, next_distance));
                break;
            }
        }
        let (mv, next_first, next_second, next_distance) =
            selected.ok_or(CenterSolveError::NoDescendingMove("phase4"))?;
        state.apply_move(mv);
        output.push(mv);
        first = next_first;
        second = next_second;
        current_distance = next_distance;
    }
    Ok(())
}

pub fn solve_centers(
    state: &Cube444,
    deadline_ts: f64,
) -> Result<CenterSolveResult, CenterSolveError> {
    check_deadline(deadline_ts)?;
    let tables_were_ready = CENTER_TABLES.get().is_some();
    let tables = get_tables(deadline_ts)?;
    let search_started = now_ms();
    let mut working = state.clone();
    let mut moves = Vec::with_capacity(32);

    descend_single(
        &mut working,
        &mut moves,
        &[U, D],
        &ALL_CENTER_POSITIONS,
        8,
        &tables.phase1_distance,
        &tables.phase1_moves,
        "phase1",
        deadline_ts,
    )?;
    descend_single(
        &mut working,
        &mut moves,
        &[U],
        &UD_POSITIONS,
        4,
        &tables.phase2_distance,
        &tables.phase2_moves,
        "phase2",
        deadline_ts,
    )?;
    descend_single(
        &mut working,
        &mut moves,
        &[R, L],
        &SIDE_POSITIONS,
        8,
        &tables.phase3_distance,
        &tables.phase3_moves,
        "phase3",
        deadline_ts,
    )?;
    descend_pair(&mut working, &mut moves, deadline_ts, tables)?;
    check_deadline(deadline_ts)?;

    if !working.centers_solved() || working.validate().is_err() {
        return Err(CenterSolveError::VerificationFailed);
    }

    Ok(CenterSolveResult {
        moves,
        table_build_ms: if tables_were_ready {
            0.0
        } else {
            tables.build_ms
        },
        search_ms: (now_ms() - search_started).max(0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_alg444;

    fn apply_and_verify(scramble: &str) -> CenterSolveResult {
        let mut state = Cube444::solved();
        state.apply_alg(scramble).unwrap();
        let result = solve_centers(&state, 0.0).unwrap();
        state.apply_moves(&result.moves);
        assert!(state.centers_solved(), "centers not solved for {scramble}");
        assert_eq!(state.validate(), Ok(()));
        result
    }

    #[test]
    fn combinadic_ranks_cover_the_expected_ranges() {
        assert_eq!(BINOMIAL[24][8], PHASE1_STATE_COUNT);
        assert_eq!(BINOMIAL[16][8], PHASE3_STATE_COUNT);
        assert_eq!(BINOMIAL[8][4], PHASE2_STATE_COUNT);
        assert_eq!(
            coordinate_rank(GOAL_UD_GROUP, &ALL_CENTER_POSITIONS, 8),
            12_375
        );
        assert!(coordinate_rank(GOAL_U, &UD_POSITIONS, 4) < PHASE2_STATE_COUNT);
    }

    #[test]
    fn move_subgroups_have_the_expected_sizes() {
        let tables = get_tables(0.0).unwrap();
        assert_eq!(tables.phase1_moves.len(), 36);
        assert_eq!(tables.phase2_moves.len(), 28);
        assert_eq!(tables.phase3_moves.len(), 24);
        assert_eq!(tables.phase4_moves.len(), 20);
    }

    #[test]
    fn pruning_tables_cover_every_abstract_state() {
        let tables = get_tables(0.0).unwrap();
        assert_eq!(tables.phase1_distance.len(), PHASE1_STATE_COUNT);
        assert_eq!(tables.phase2_distance.len(), PHASE2_STATE_COUNT);
        assert_eq!(tables.phase3_distance.len(), PHASE3_STATE_COUNT);
        assert_eq!(tables.phase4_distance.len(), PHASE4_STATE_COUNT);
        assert!(tables
            .phase1_distance
            .iter()
            .all(|&value| value != UNVISITED));
        assert!(tables
            .phase2_distance
            .iter()
            .all(|&value| value != UNVISITED));
        assert!(tables
            .phase3_distance
            .iter()
            .all(|&value| value != UNVISITED));
        assert!(tables
            .phase4_distance
            .iter()
            .all(|&value| value != UNVISITED));
        assert_eq!(tables.phase1_distance.iter().copied().max(), Some(8));
        assert_eq!(tables.phase2_distance.iter().copied().max(), Some(5));
        assert_eq!(tables.phase3_distance.iter().copied().max(), Some(9));
        assert_eq!(tables.phase4_distance.iter().copied().max(), Some(9));
    }

    #[test]
    fn solved_state_needs_no_center_moves() {
        let result = solve_centers(&Cube444::solved(), 0.0).unwrap();
        assert!(result.moves.is_empty());
    }

    #[test]
    fn fixed_scrambles_solve_all_centers() {
        for scramble in [
            "Rw U2 F' Lw D B2 Uw' R2 Fw D' L2 Bw2",
            "Uw2 Rw F2 Dw' L B' Rw2 U Fw' D2 Lw B2",
            "R U Rw' F2 Uw L' Dw2 B R2 Fw D' Lw2 U2",
            "Fw Rw2 U' Lw F2 Dw B' Uw2 R L2 Bw' D",
        ] {
            let result = apply_and_verify(scramble);
            assert!(result.moves.len() <= 31);
        }
    }

    #[test]
    fn deterministic_random_corpus_solves_centers() {
        let all_moves = Move444::all();
        let mut seed = 0xa076_1d64_78bd_642fu64;
        for case in 0..40 {
            let mut scramble = Vec::new();
            let mut previous_face = None;
            for _ in 0..40 {
                loop {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    let mv = all_moves[((seed >> 32) as usize) % all_moves.len()];
                    if previous_face != Some(mv.face()) {
                        previous_face = Some(mv.face());
                        scramble.push(mv);
                        break;
                    }
                }
            }
            let mut state = Cube444::solved();
            state.apply_moves(&scramble);
            let result = solve_centers(&state, 0.0).unwrap();
            assert!(result.moves.len() <= 31, "case {case} exceeded phase bound");
            state.apply_moves(&result.moves);
            assert!(state.centers_solved(), "case {case} did not solve centers");
            assert_eq!(state.validate(), Ok(()));
        }
    }

    #[test]
    fn expired_deadline_is_rejected() {
        let state = Cube444::solved();
        assert_eq!(
            solve_centers(&state, 1.0).unwrap_err(),
            CenterSolveError::DeadlineReached
        );
    }

    #[test]
    fn parser_still_accepts_center_solution_notation() {
        let result = apply_and_verify("Rw U Fw' D2 Lw B Uw2 R'");
        let notation = result
            .moves
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(parse_alg444(&notation).unwrap(), result.moves);
    }
}
