use core::fmt;
use std::collections::VecDeque;
use std::sync::OnceLock;

use crate::geometry::{move_permutation, sticker_geometry, Vec3, FACELET_COUNT};
use crate::{Cube444, Face, Move444};

const WING_COUNT: usize = 24;
const EDGE_TYPE_COUNT: usize = 12;
const PAIR_PHASE_COUNT: usize = 8;
const LAST_EDGE_COUNT: usize = 4;
const LAST_POSITION_COUNT: usize = 8;
const MACRO_LEN: usize = 6;
const LAST_DISTANCE_COUNT: usize = 2520 * 256;
const UNVISITED: u8 = u8::MAX;

const EDGE_COLOR_PAIRS: [[u8; 2]; EDGE_TYPE_COUNT] = [
    [0, 1],
    [0, 2],
    [0, 4],
    [0, 5],
    [1, 2],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 4],
    [3, 4],
    [3, 5],
    [4, 5],
];

const EDGE_SLOTS: [[u8; 2]; EDGE_TYPE_COUNT] = [
    [22, 23],
    [11, 15],
    [6, 7],
    [10, 14],
    [19, 21],
    [16, 17],
    [18, 20],
    [9, 13],
    [3, 5],
    [0, 1],
    [8, 12],
    [2, 4],
];

const LAST_POSITIONS: [u8; LAST_POSITION_COUNT] = [0, 1, 2, 3, 4, 5, 8, 12];
const EXPECTED_PAIR_REACHABLE: [usize; PAIR_PHASE_COUNT] = [552, 462, 380, 306, 240, 182, 132, 90];
const EXPECTED_PAIR_MAX_DEPTH: [u8; PAIR_PHASE_COUNT] = [8, 7, 9, 8, 8, 8, 8, 5];
const EXPECTED_LAST_REACHABLE: usize = 40_320;
const EXPECTED_LAST_MAX_DEPTH: u8 = 10;

const fn m(face: Face, wide: bool, amount: u8) -> Move444 {
    Move444::new(face, wide, amount)
}

const PHASE0_MACROS: [[Move444; MACRO_LEN]; 5] = [
    [
        m(Face::R, false, 2),
        m(Face::U, true, 1),
        m(Face::L, false, 1),
        m(Face::U, false, 3),
        m(Face::L, false, 3),
        m(Face::U, true, 3),
    ],
    [
        m(Face::R, false, 2),
        m(Face::L, true, 2),
        m(Face::U, false, 2),
        m(Face::L, false, 1),
        m(Face::U, false, 2),
        m(Face::L, true, 2),
    ],
    [
        m(Face::F, false, 2),
        m(Face::U, true, 1),
        m(Face::L, false, 2),
        m(Face::D, false, 3),
        m(Face::L, false, 2),
        m(Face::U, true, 3),
    ],
    [
        m(Face::B, true, 2),
        m(Face::R, false, 1),
        m(Face::F, false, 2),
        m(Face::R, false, 3),
        m(Face::B, true, 2),
        m(Face::R, false, 3),
    ],
    [
        m(Face::D, true, 3),
        m(Face::L, false, 3),
        m(Face::D, false, 2),
        m(Face::L, false, 1),
        m(Face::D, true, 1),
        m(Face::L, false, 2),
    ],
];

const PHASE1_MACROS: [[Move444; MACRO_LEN]; 5] = [
    [
        m(Face::B, true, 1),
        m(Face::D, false, 2),
        m(Face::F, false, 1),
        m(Face::D, false, 2),
        m(Face::F, false, 1),
        m(Face::B, true, 3),
    ],
    [
        m(Face::D, true, 3),
        m(Face::F, false, 3),
        m(Face::D, false, 3),
        m(Face::F, false, 1),
        m(Face::D, true, 1),
        m(Face::F, false, 2),
    ],
    [
        m(Face::D, true, 1),
        m(Face::R, false, 3),
        m(Face::U, false, 1),
        m(Face::R, false, 1),
        m(Face::D, true, 3),
        m(Face::B, false, 3),
    ],
    [
        m(Face::F, true, 3),
        m(Face::B, false, 1),
        m(Face::U, false, 2),
        m(Face::F, false, 1),
        m(Face::U, false, 2),
        m(Face::F, true, 1),
    ],
    [
        m(Face::D, true, 3),
        m(Face::L, false, 3),
        m(Face::D, false, 3),
        m(Face::L, false, 1),
        m(Face::D, true, 1),
        m(Face::F, false, 3),
    ],
];

const PHASE2_MACROS: [[Move444; MACRO_LEN]; 4] = [
    [
        m(Face::L, false, 1),
        m(Face::F, true, 3),
        m(Face::U, false, 2),
        m(Face::B, false, 3),
        m(Face::U, false, 2),
        m(Face::F, true, 1),
    ],
    [
        m(Face::R, true, 3),
        m(Face::L, false, 2),
        m(Face::F, false, 2),
        m(Face::L, false, 3),
        m(Face::F, false, 2),
        m(Face::R, true, 1),
    ],
    [
        m(Face::F, true, 3),
        m(Face::R, false, 1),
        m(Face::B, false, 1),
        m(Face::R, false, 3),
        m(Face::F, true, 1),
        m(Face::L, false, 3),
    ],
    [
        m(Face::B, true, 1),
        m(Face::U, false, 2),
        m(Face::F, false, 3),
        m(Face::U, false, 2),
        m(Face::B, true, 3),
        m(Face::D, false, 2),
    ],
];

const PHASE3_MACROS: [[Move444; MACRO_LEN]; 4] = [
    [
        m(Face::F, true, 1),
        m(Face::D, false, 1),
        m(Face::B, false, 1),
        m(Face::D, false, 3),
        m(Face::F, true, 3),
        m(Face::B, false, 1),
    ],
    [
        m(Face::D, false, 3),
        m(Face::B, true, 3),
        m(Face::U, false, 2),
        m(Face::F, false, 2),
        m(Face::U, false, 2),
        m(Face::B, true, 1),
    ],
    [
        m(Face::U, true, 2),
        m(Face::D, false, 2),
        m(Face::B, false, 3),
        m(Face::D, false, 1),
        m(Face::B, false, 1),
        m(Face::U, true, 2),
    ],
    [
        m(Face::F, true, 1),
        m(Face::R, false, 2),
        m(Face::F, false, 3),
        m(Face::R, false, 2),
        m(Face::F, true, 3),
        m(Face::B, false, 1),
    ],
];

const PHASE4_MACROS: [[Move444; MACRO_LEN]; 4] = [
    [
        m(Face::U, true, 2),
        m(Face::L, false, 1),
        m(Face::D, false, 1),
        m(Face::L, false, 3),
        m(Face::U, true, 2),
        m(Face::D, false, 2),
    ],
    [
        m(Face::D, true, 3),
        m(Face::F, false, 2),
        m(Face::L, false, 1),
        m(Face::F, false, 2),
        m(Face::L, false, 3),
        m(Face::D, true, 1),
    ],
    [
        m(Face::F, true, 2),
        m(Face::U, false, 2),
        m(Face::B, false, 3),
        m(Face::U, false, 2),
        m(Face::F, true, 2),
        m(Face::D, false, 3),
    ],
    [
        m(Face::U, true, 1),
        m(Face::R, false, 1),
        m(Face::D, false, 2),
        m(Face::R, false, 3),
        m(Face::U, true, 3),
        m(Face::D, false, 2),
    ],
];

const PHASE5_MACROS: [[Move444; MACRO_LEN]; 3] = [
    [
        m(Face::R, true, 1),
        m(Face::U, false, 2),
        m(Face::L, false, 2),
        m(Face::U, false, 2),
        m(Face::R, true, 3),
        m(Face::D, false, 1),
    ],
    [
        m(Face::D, false, 3),
        m(Face::F, true, 1),
        m(Face::U, false, 2),
        m(Face::B, false, 1),
        m(Face::U, false, 2),
        m(Face::F, true, 3),
    ],
    [
        m(Face::R, true, 3),
        m(Face::L, false, 1),
        m(Face::F, false, 1),
        m(Face::L, false, 3),
        m(Face::F, false, 3),
        m(Face::R, true, 1),
    ],
];

const PHASE6_MACROS: [[Move444; MACRO_LEN]; 4] = [
    [
        m(Face::F, false, 1),
        m(Face::B, true, 2),
        m(Face::L, false, 2),
        m(Face::F, false, 3),
        m(Face::L, false, 2),
        m(Face::B, true, 2),
    ],
    [
        m(Face::U, true, 2),
        m(Face::D, false, 1),
        m(Face::B, false, 3),
        m(Face::D, false, 3),
        m(Face::B, false, 1),
        m(Face::U, true, 2),
    ],
    [
        m(Face::U, true, 3),
        m(Face::D, false, 1),
        m(Face::B, false, 3),
        m(Face::D, false, 3),
        m(Face::B, false, 1),
        m(Face::U, true, 1),
    ],
    [
        m(Face::R, true, 3),
        m(Face::L, false, 1),
        m(Face::D, false, 1),
        m(Face::L, false, 3),
        m(Face::D, false, 3),
        m(Face::R, true, 1),
    ],
];

const PHASE7_MACROS: [[Move444; MACRO_LEN]; 4] = [
    [
        m(Face::U, true, 1),
        m(Face::F, false, 1),
        m(Face::L, false, 1),
        m(Face::F, false, 3),
        m(Face::L, false, 3),
        m(Face::U, true, 3),
    ],
    [
        m(Face::U, true, 3),
        m(Face::D, false, 1),
        m(Face::L, false, 1),
        m(Face::D, false, 3),
        m(Face::L, false, 3),
        m(Face::U, true, 1),
    ],
    [
        m(Face::R, true, 3),
        m(Face::F, false, 1),
        m(Face::L, false, 2),
        m(Face::F, false, 3),
        m(Face::R, true, 1),
        m(Face::L, false, 2),
    ],
    [
        m(Face::U, true, 1),
        m(Face::D, false, 2),
        m(Face::F, false, 3),
        m(Face::D, false, 2),
        m(Face::F, false, 1),
        m(Face::U, true, 3),
    ],
];

const LAST4_MACROS: [[Move444; MACRO_LEN]; 3] = [
    [
        m(Face::U, true, 3),
        m(Face::D, false, 1),
        m(Face::B, false, 1),
        m(Face::D, false, 3),
        m(Face::B, false, 3),
        m(Face::U, true, 1),
    ],
    [
        m(Face::U, true, 1),
        m(Face::L, false, 3),
        m(Face::D, false, 3),
        m(Face::L, false, 1),
        m(Face::U, true, 3),
        m(Face::D, false, 1),
    ],
    [
        m(Face::F, true, 3),
        m(Face::D, false, 2),
        m(Face::B, false, 1),
        m(Face::D, false, 2),
        m(Face::F, true, 1),
        m(Face::B, false, 3),
    ],
];

fn phase_macro_specs(phase: usize) -> &'static [[Move444; MACRO_LEN]] {
    match phase {
        0 => &PHASE0_MACROS,
        1 => &PHASE1_MACROS,
        2 => &PHASE2_MACROS,
        3 => &PHASE3_MACROS,
        4 => &PHASE4_MACROS,
        5 => &PHASE5_MACROS,
        6 => &PHASE6_MACROS,
        7 => &PHASE7_MACROS,
        _ => &[],
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WingAction {
    permutation: [u8; WING_COUNT],
    flips: [u8; WING_COUNT],
}

impl WingAction {
    fn identity() -> Self {
        Self {
            permutation: core::array::from_fn(|index| index as u8),
            flips: [0; WING_COUNT],
        }
    }

    fn compose(self, next: Self) -> Self {
        let mut permutation = [0u8; WING_COUNT];
        let mut flips = [0u8; WING_COUNT];
        for old in 0..WING_COUNT {
            let middle = self.permutation[old] as usize;
            permutation[old] = next.permutation[middle];
            flips[old] = self.flips[old] ^ next.flips[middle];
        }
        Self { permutation, flips }
    }

    fn inverse(self) -> Self {
        let mut permutation = [0u8; WING_COUNT];
        let mut flips = [0u8; WING_COUNT];
        for old in 0..WING_COUNT {
            let new = self.permutation[old] as usize;
            permutation[new] = old as u8;
            flips[new] = self.flips[old];
        }
        Self { permutation, flips }
    }
}

#[derive(Clone, Debug)]
struct WingMacro {
    moves: [Move444; MACRO_LEN],
    action: WingAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PairState {
    first_position: u8,
    first_orientation: u8,
    second_position: u8,
    second_orientation: u8,
}

impl PairState {
    fn new(first: (u8, u8), second: (u8, u8)) -> Self {
        debug_assert_ne!(first.0, second.0);
        if first.0 < second.0 {
            Self {
                first_position: first.0,
                first_orientation: first.1,
                second_position: second.0,
                second_orientation: second.1,
            }
        } else {
            Self {
                first_position: second.0,
                first_orientation: second.1,
                second_position: first.0,
                second_orientation: first.1,
            }
        }
    }

    fn apply(self, action: WingAction) -> Self {
        let first_position = action.permutation[self.first_position as usize];
        let second_position = action.permutation[self.second_position as usize];
        Self::new(
            (
                first_position,
                self.first_orientation ^ action.flips[self.first_position as usize],
            ),
            (
                second_position,
                self.second_orientation ^ action.flips[self.second_position as usize],
            ),
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LastState {
    values: [u8; LAST_POSITION_COUNT],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct LocalWingAction {
    permutation: [u8; LAST_POSITION_COUNT],
    flips: [u8; LAST_POSITION_COUNT],
}

impl LastState {
    fn apply(self, action: LocalWingAction) -> Self {
        let mut values = [0u8; LAST_POSITION_COUNT];
        for old in 0..LAST_POSITION_COUNT {
            let value = self.values[old];
            let label = value >> 1;
            let orientation = (value & 1) ^ action.flips[old];
            values[action.permutation[old] as usize] = (label << 1) | orientation;
        }
        Self { values }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Debug)]
struct PairPhase {
    target_type: u8,
    local_by_global: [u8; WING_COUNT],
    macros: Vec<WingMacro>,
    distance: Vec<u8>,
    reachable: usize,
    max_depth: u8,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Debug)]
struct LastPhase {
    macros: Vec<WingMacro>,
    local_actions: Vec<LocalWingAction>,
    distance: Vec<u8>,
    reachable: usize,
    max_depth: u8,
}

#[derive(Clone, Debug)]
struct EdgeTables {
    pair_phases: Vec<PairPhase>,
    last_phase: LastPhase,
    build_ms: f64,
}

static EDGE_TABLES: OnceLock<EdgeTables> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct EdgeSolveResult {
    pub moves: Vec<Move444>,
    pub table_build_ms: f64,
    pub search_ms: f64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EdgeSolveError {
    DeadlineReached,
    CentersNotSolved,
    InvalidWingInventory,
    MacroBreaksCenters(&'static str),
    MacroBreaksLockedEdges(&'static str),
    TableStateCount {
        phase: &'static str,
        expected: usize,
        actual: usize,
    },
    TableDepth {
        phase: &'static str,
        expected: u8,
        actual: u8,
    },
    CoordinateNotReachable(&'static str),
    NoDescendingMacro(&'static str),
    VerificationFailed,
}

impl fmt::Display for EdgeSolveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DeadlineReached => write!(formatter, "4x4 edge deadline reached"),
            Self::CentersNotSolved => write!(formatter, "4x4 edges require solved centers"),
            Self::InvalidWingInventory => write!(formatter, "invalid 4x4 wing coordinate"),
            Self::MacroBreaksCenters(phase) => {
                write!(formatter, "4x4 edge macro breaks centers in {phase}")
            }
            Self::MacroBreaksLockedEdges(phase) => {
                write!(formatter, "4x4 edge macro breaks locked pairs in {phase}")
            }
            Self::TableStateCount {
                phase,
                expected,
                actual,
            } => write!(
                formatter,
                "4x4 edge {phase} table size mismatch: expected {expected}, got {actual}"
            ),
            Self::TableDepth {
                phase,
                expected,
                actual,
            } => write!(
                formatter,
                "4x4 edge {phase} max depth mismatch: expected {expected}, got {actual}"
            ),
            Self::CoordinateNotReachable(phase) => {
                write!(formatter, "4x4 edge {phase} coordinate is unreachable")
            }
            Self::NoDescendingMacro(phase) => {
                write!(formatter, "4x4 edge {phase} has no descending macro")
            }
            Self::VerificationFailed => write!(formatter, "4x4 edge verification failed"),
        }
    }
}

impl std::error::Error for EdgeSolveError {}

#[derive(Clone, Debug)]
struct WingInventory {
    edge_type: [u8; WING_COUNT],
    orientation: [u8; WING_COUNT],
}

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

fn check_deadline(deadline_ts: f64) -> Result<(), EdgeSolveError> {
    if deadline_reached(deadline_ts) {
        Err(EdgeSolveError::DeadlineReached)
    } else {
        Ok(())
    }
}

fn piece_kind(position: Vec3) -> usize {
    [position.x, position.y, position.z]
        .into_iter()
        .filter(|coordinate| coordinate.abs() == 3)
        .count()
}

fn wing_positions() -> [Vec3; WING_COUNT] {
    let mut positions = Vec::with_capacity(WING_COUNT);
    for facelet in 0..FACELET_COUNT {
        let position = sticker_geometry(facelet).pos;
        if piece_kind(position) == 2 && !positions.contains(&position) {
            positions.push(position);
        }
    }
    positions.sort_unstable();
    positions
        .try_into()
        .unwrap_or_else(|_| panic!("invalid 4x4 wing geometry"))
}

fn wing_facelets() -> [[usize; 2]; WING_COUNT] {
    let positions = wing_positions();
    let mut result = [[0usize; 2]; WING_COUNT];
    for (wing, position) in positions.into_iter().enumerate() {
        let mut facelets = Vec::with_capacity(2);
        for facelet in 0..FACELET_COUNT {
            if sticker_geometry(facelet).pos == position {
                facelets.push(facelet);
            }
        }
        facelets.sort_unstable_by_key(|&facelet| (facelet / 16, facelet));
        assert_eq!(facelets.len(), 2, "invalid 4x4 wing facelet count");
        result[wing] = [facelets[0], facelets[1]];
    }
    result
}

fn wing_action_for_move(mv: Move444) -> WingAction {
    let positions = wing_positions();
    let facelets = wing_facelets();
    let facelet_permutation = move_permutation(mv);
    let mut action = WingAction::identity();

    for old in 0..WING_COUNT {
        let mapped = [
            facelet_permutation[facelets[old][0]] as usize,
            facelet_permutation[facelets[old][1]] as usize,
        ];
        let target_position = sticker_geometry(mapped[0]).pos;
        debug_assert_eq!(sticker_geometry(mapped[1]).pos, target_position);
        let target = positions
            .iter()
            .position(|&position| position == target_position)
            .expect("wing moved outside wing orbit");
        action.permutation[old] = target as u8;
        action.flips[old] = if mapped == facelets[target] {
            0
        } else if mapped == [facelets[target][1], facelets[target][0]] {
            1
        } else {
            panic!("invalid wing orientation mapping for {mv}");
        };
    }
    action
}

fn wing_action_for_moves(moves: &[Move444; MACRO_LEN]) -> WingAction {
    let mut action = WingAction::identity();
    for &mv in moves {
        action = action.compose(wing_action_for_move(mv));
    }
    action
}

fn build_macros(specs: &[[Move444; MACRO_LEN]]) -> Vec<WingMacro> {
    specs
        .iter()
        .map(|&moves| WingMacro {
            moves,
            action: wing_action_for_moves(&moves),
        })
        .collect()
}

fn edge_type_for_pair(pair: [u8; 2]) -> Option<u8> {
    EDGE_COLOR_PAIRS
        .iter()
        .position(|&candidate| candidate == pair)
        .map(|index| index as u8)
}

fn wing_inventory(state: &Cube444) -> Result<WingInventory, EdgeSolveError> {
    let facelets = wing_facelets();
    let mut edge_type = [u8::MAX; WING_COUNT];
    let mut orientation = [0u8; WING_COUNT];
    let mut counts = [0usize; EDGE_TYPE_COUNT];

    for wing in 0..WING_COUNT {
        let colors = [
            state.stickers()[facelets[wing][0]],
            state.stickers()[facelets[wing][1]],
        ];
        if colors[0] == colors[1] {
            return Err(EdgeSolveError::InvalidWingInventory);
        }
        let pair = if colors[0] < colors[1] {
            colors
        } else {
            [colors[1], colors[0]]
        };
        let kind = edge_type_for_pair(pair).ok_or(EdgeSolveError::InvalidWingInventory)?;
        edge_type[wing] = kind;
        orientation[wing] = u8::from(colors != pair);
        counts[kind as usize] += 1;
    }

    if counts.into_iter().any(|count| count != 2) {
        return Err(EdgeSolveError::InvalidWingInventory);
    }

    Ok(WingInventory {
        edge_type,
        orientation,
    })
}

fn edge_home_paired(inventory: &WingInventory, edge_type: usize) -> bool {
    let [first, second] = EDGE_SLOTS[edge_type];
    inventory.edge_type[first as usize] == edge_type as u8
        && inventory.edge_type[second as usize] == edge_type as u8
        && inventory.orientation[first as usize] == inventory.orientation[second as usize]
}

impl Cube444 {
    pub fn edges_paired(&self) -> bool {
        let Ok(inventory) = wing_inventory(self) else {
            return false;
        };
        EDGE_SLOTS.iter().all(|&[first, second]| {
            inventory.edge_type[first as usize] == inventory.edge_type[second as usize]
                && inventory.orientation[first as usize] == inventory.orientation[second as usize]
        })
    }
}

fn action_preserves_locked(action: WingAction, locked_count: usize) -> bool {
    for &[first, second] in EDGE_SLOTS.iter().take(locked_count) {
        let mapped = [
            action.permutation[first as usize],
            action.permutation[second as usize],
        ];
        if !((mapped[0] == first && mapped[1] == second)
            || (mapped[0] == second && mapped[1] == first))
        {
            return false;
        }
        if action.flips[first as usize] != action.flips[second as usize] {
            return false;
        }
    }
    true
}

fn verify_macro(
    wing_macro: &WingMacro,
    locked_count: usize,
    phase: &'static str,
) -> Result<(), EdgeSolveError> {
    let mut state = Cube444::solved();
    state.apply_moves(&wing_macro.moves);
    if !state.centers_solved() {
        return Err(EdgeSolveError::MacroBreaksCenters(phase));
    }
    if !action_preserves_locked(wing_macro.action, locked_count) {
        return Err(EdgeSolveError::MacroBreaksLockedEdges(phase));
    }
    Ok(())
}

fn pair_phase_name(phase: usize) -> &'static str {
    match phase {
        0 => "pair1",
        1 => "pair2",
        2 => "pair3",
        3 => "pair4",
        4 => "pair5",
        5 => "pair6",
        6 => "pair7",
        7 => "pair8",
        _ => "pair",
    }
}

fn pair_rank(state: PairState, local_by_global: &[u8; WING_COUNT]) -> usize {
    let first = local_by_global[state.first_position as usize];
    let second = local_by_global[state.second_position as usize];
    debug_assert_ne!(first, u8::MAX);
    debug_assert_ne!(second, u8::MAX);
    debug_assert!(first < second);
    let pair = (second as usize * (second as usize - 1)) / 2 + first as usize;
    pair * 4 + state.first_orientation as usize * 2 + state.second_orientation as usize
}

fn pair_state_for_type(
    inventory: &WingInventory,
    target_type: u8,
) -> Result<PairState, EdgeSolveError> {
    let mut pieces = Vec::with_capacity(2);
    for position in 0..WING_COUNT {
        if inventory.edge_type[position] == target_type {
            pieces.push((position as u8, inventory.orientation[position]));
        }
    }
    if pieces.len() != 2 {
        return Err(EdgeSolveError::InvalidWingInventory);
    }
    Ok(PairState::new(pieces[0], pieces[1]))
}

fn build_pair_phase(phase: usize, deadline_ts: f64) -> Result<PairPhase, EdgeSolveError> {
    let phase_name = pair_phase_name(phase);
    let macros = build_macros(phase_macro_specs(phase));
    for wing_macro in &macros {
        verify_macro(wing_macro, phase, phase_name)?;
    }

    let mut local_by_global = [u8::MAX; WING_COUNT];
    let mut remaining = Vec::with_capacity(WING_COUNT - phase * 2);
    for (position, local) in local_by_global.iter_mut().enumerate() {
        let locked = EDGE_SLOTS
            .iter()
            .take(phase)
            .any(|pair| pair.contains(&(position as u8)));
        if !locked {
            *local = remaining.len() as u8;
            remaining.push(position as u8);
        }
    }

    let theoretical = remaining.len() * (remaining.len() - 1) / 2 * 4;
    let mut distance = vec![UNVISITED; theoretical];
    let target = EDGE_SLOTS[phase];
    let goals = [
        PairState::new((target[0], 0), (target[1], 0)),
        PairState::new((target[0], 1), (target[1], 1)),
    ];
    let mut queue = VecDeque::with_capacity(EXPECTED_PAIR_REACHABLE[phase]);
    let mut reachable = 0usize;
    for goal in goals {
        let rank = pair_rank(goal, &local_by_global);
        if distance[rank] == UNVISITED {
            distance[rank] = 0;
            queue.push_back(goal);
            reachable += 1;
        }
    }

    let inverse_actions: Vec<_> = macros
        .iter()
        .map(|wing_macro| wing_macro.action.inverse())
        .collect();
    let mut expanded = 0usize;
    while let Some(state) = queue.pop_front() {
        if expanded & 0x03ff == 0 {
            check_deadline(deadline_ts)?;
        }
        expanded += 1;
        let current = distance[pair_rank(state, &local_by_global)];
        for &action in &inverse_actions {
            let next = state.apply(action);
            let rank = pair_rank(next, &local_by_global);
            if distance[rank] == UNVISITED {
                distance[rank] = current + 1;
                queue.push_back(next);
                reachable += 1;
            }
        }
    }

    if reachable != EXPECTED_PAIR_REACHABLE[phase] {
        return Err(EdgeSolveError::TableStateCount {
            phase: phase_name,
            expected: EXPECTED_PAIR_REACHABLE[phase],
            actual: reachable,
        });
    }
    let max_depth = distance
        .iter()
        .copied()
        .filter(|&value| value != UNVISITED)
        .max()
        .unwrap_or(0);
    if max_depth != EXPECTED_PAIR_MAX_DEPTH[phase] {
        return Err(EdgeSolveError::TableDepth {
            phase: phase_name,
            expected: EXPECTED_PAIR_MAX_DEPTH[phase],
            actual: max_depth,
        });
    }

    Ok(PairPhase {
        target_type: phase as u8,
        local_by_global,
        macros,
        distance,
        reachable,
        max_depth,
    })
}

fn local_last_action(action: WingAction) -> Result<LocalWingAction, EdgeSolveError> {
    let mut global_to_local = [u8::MAX; WING_COUNT];
    for (local, &global) in LAST_POSITIONS.iter().enumerate() {
        global_to_local[global as usize] = local as u8;
    }
    let mut permutation = [0u8; LAST_POSITION_COUNT];
    let mut flips = [0u8; LAST_POSITION_COUNT];
    for (local, &global) in LAST_POSITIONS.iter().enumerate() {
        let target = action.permutation[global as usize];
        let target_local = global_to_local[target as usize];
        if target_local == u8::MAX {
            return Err(EdgeSolveError::MacroBreaksLockedEdges("last4"));
        }
        permutation[local] = target_local;
        flips[local] = action.flips[global as usize];
    }
    Ok(LocalWingAction { permutation, flips })
}

fn choose_two_rank(first: usize, second: usize) -> usize {
    debug_assert!(first < second);
    second * (second - 1) / 2 + first
}

fn last_rank(state: LastState) -> usize {
    let mut available: Vec<usize> = (0..LAST_POSITION_COUNT).collect();
    let mut ranks = [0usize; 3];

    for label in 0..3u8 {
        let selected: Vec<usize> = available
            .iter()
            .enumerate()
            .filter_map(|(local, &position)| {
                if state.values[position] >> 1 == label {
                    Some(local)
                } else {
                    None
                }
            })
            .collect();
        debug_assert_eq!(selected.len(), 2);
        ranks[label as usize] = choose_two_rank(selected[0], selected[1]);
        available.retain(|&position| state.values[position] >> 1 != label);
    }

    let label_rank = (ranks[0] * 15 + ranks[1]) * 6 + ranks[2];
    let orientation_bits = state
        .values
        .iter()
        .enumerate()
        .fold(0usize, |bits, (position, value)| {
            bits | (((value & 1) as usize) << position)
        });
    label_rank * 256 + orientation_bits
}

fn last_goal_states() -> Vec<LastState> {
    let mut global_to_local = [u8::MAX; WING_COUNT];
    for (local, &global) in LAST_POSITIONS.iter().enumerate() {
        global_to_local[global as usize] = local as u8;
    }

    let mut goals = Vec::with_capacity(16);
    for orientation_mask in 0..16u8 {
        let mut values = [0u8; LAST_POSITION_COUNT];
        for label in 0..LAST_EDGE_COUNT {
            let orientation = (orientation_mask >> label) & 1;
            for &global in &EDGE_SLOTS[PAIR_PHASE_COUNT + label] {
                let local = global_to_local[global as usize];
                values[local as usize] = ((label as u8) << 1) | orientation;
            }
        }
        goals.push(LastState { values });
    }
    goals
}

fn last_state_from_inventory(inventory: &WingInventory) -> Result<LastState, EdgeSolveError> {
    let mut values = [0u8; LAST_POSITION_COUNT];
    for (local, &global) in LAST_POSITIONS.iter().enumerate() {
        let edge_type = inventory.edge_type[global as usize] as usize;
        if !(PAIR_PHASE_COUNT..EDGE_TYPE_COUNT).contains(&edge_type) {
            return Err(EdgeSolveError::CoordinateNotReachable("last4"));
        }
        let label = (edge_type - PAIR_PHASE_COUNT) as u8;
        values[local] = (label << 1) | inventory.orientation[global as usize];
    }
    Ok(LastState { values })
}

fn build_last_phase(deadline_ts: f64) -> Result<LastPhase, EdgeSolveError> {
    let macros = build_macros(&LAST4_MACROS);
    for wing_macro in &macros {
        verify_macro(wing_macro, PAIR_PHASE_COUNT, "last4")?;
    }
    let local_actions: Vec<_> = macros
        .iter()
        .map(|wing_macro| local_last_action(wing_macro.action))
        .collect::<Result<_, _>>()?;
    let inverse_actions: Vec<_> = macros
        .iter()
        .map(|wing_macro| local_last_action(wing_macro.action.inverse()))
        .collect::<Result<_, _>>()?;

    let mut distance = vec![UNVISITED; LAST_DISTANCE_COUNT];
    let mut queue = VecDeque::with_capacity(EXPECTED_LAST_REACHABLE);
    let mut reachable = 0usize;
    for goal in last_goal_states() {
        let rank = last_rank(goal);
        if distance[rank] == UNVISITED {
            distance[rank] = 0;
            queue.push_back(goal);
            reachable += 1;
        }
    }

    let mut expanded = 0usize;
    while let Some(state) = queue.pop_front() {
        if expanded & 0x03ff == 0 {
            check_deadline(deadline_ts)?;
        }
        expanded += 1;
        let current = distance[last_rank(state)];
        for &action in &inverse_actions {
            let next = state.apply(action);
            let rank = last_rank(next);
            if distance[rank] == UNVISITED {
                distance[rank] = current + 1;
                queue.push_back(next);
                reachable += 1;
            }
        }
    }

    if reachable != EXPECTED_LAST_REACHABLE {
        return Err(EdgeSolveError::TableStateCount {
            phase: "last4",
            expected: EXPECTED_LAST_REACHABLE,
            actual: reachable,
        });
    }
    let max_depth = distance
        .iter()
        .copied()
        .filter(|&value| value != UNVISITED)
        .max()
        .unwrap_or(0);
    if max_depth != EXPECTED_LAST_MAX_DEPTH {
        return Err(EdgeSolveError::TableDepth {
            phase: "last4",
            expected: EXPECTED_LAST_MAX_DEPTH,
            actual: max_depth,
        });
    }

    Ok(LastPhase {
        macros,
        local_actions,
        distance,
        reachable,
        max_depth,
    })
}

impl EdgeTables {
    fn build(deadline_ts: f64) -> Result<Self, EdgeSolveError> {
        let started = now_ms();
        check_deadline(deadline_ts)?;
        let mut pair_phases = Vec::with_capacity(PAIR_PHASE_COUNT);
        for phase in 0..PAIR_PHASE_COUNT {
            pair_phases.push(build_pair_phase(phase, deadline_ts)?);
        }
        let last_phase = build_last_phase(deadline_ts)?;
        check_deadline(deadline_ts)?;
        Ok(Self {
            pair_phases,
            last_phase,
            build_ms: (now_ms() - started).max(0.0),
        })
    }
}

fn get_tables(deadline_ts: f64) -> Result<&'static EdgeTables, EdgeSolveError> {
    if let Some(tables) = EDGE_TABLES.get() {
        return Ok(tables);
    }
    let tables = EdgeTables::build(deadline_ts)?;
    let _ = EDGE_TABLES.set(tables);
    EDGE_TABLES
        .get()
        .ok_or(EdgeSolveError::CoordinateNotReachable("table-cache"))
}

fn descend_pair_phase(
    working: &mut Cube444,
    output: &mut Vec<Move444>,
    phase: &PairPhase,
    phase_name: &'static str,
    deadline_ts: f64,
) -> Result<(), EdgeSolveError> {
    let inventory = wing_inventory(working)?;
    let mut state = pair_state_for_type(&inventory, phase.target_type)?;
    let mut current = phase.distance[pair_rank(state, &phase.local_by_global)];
    if current == UNVISITED {
        return Err(EdgeSolveError::CoordinateNotReachable(phase_name));
    }

    while current > 0 {
        check_deadline(deadline_ts)?;
        let mut selected = None;
        for wing_macro in &phase.macros {
            let next = state.apply(wing_macro.action);
            let next_distance = phase.distance[pair_rank(next, &phase.local_by_global)];
            if next_distance != UNVISITED && next_distance + 1 == current {
                selected = Some((wing_macro, next, next_distance));
                break;
            }
        }
        let (wing_macro, next, next_distance) =
            selected.ok_or(EdgeSolveError::NoDescendingMacro(phase_name))?;
        working.apply_moves(&wing_macro.moves);
        output.extend_from_slice(&wing_macro.moves);
        state = next;
        current = next_distance;
    }

    let inventory = wing_inventory(working)?;
    if !edge_home_paired(&inventory, phase.target_type as usize) || !working.centers_solved() {
        return Err(EdgeSolveError::VerificationFailed);
    }
    Ok(())
}

fn descend_last_phase(
    working: &mut Cube444,
    output: &mut Vec<Move444>,
    phase: &LastPhase,
    deadline_ts: f64,
) -> Result<(), EdgeSolveError> {
    let inventory = wing_inventory(working)?;
    let mut state = last_state_from_inventory(&inventory)?;
    let mut current = phase.distance[last_rank(state)];
    if current == UNVISITED {
        return Err(EdgeSolveError::CoordinateNotReachable("last4"));
    }

    while current > 0 {
        check_deadline(deadline_ts)?;
        let mut selected = None;
        for (index, wing_macro) in phase.macros.iter().enumerate() {
            let next = state.apply(phase.local_actions[index]);
            let next_distance = phase.distance[last_rank(next)];
            if next_distance != UNVISITED && next_distance + 1 == current {
                selected = Some((wing_macro, next, next_distance));
                break;
            }
        }
        let (wing_macro, next, next_distance) =
            selected.ok_or(EdgeSolveError::NoDescendingMacro("last4"))?;
        working.apply_moves(&wing_macro.moves);
        output.extend_from_slice(&wing_macro.moves);
        state = next;
        current = next_distance;
    }
    Ok(())
}

pub fn solve_edges(state: &Cube444, deadline_ts: f64) -> Result<EdgeSolveResult, EdgeSolveError> {
    check_deadline(deadline_ts)?;
    if !state.centers_solved() {
        return Err(EdgeSolveError::CentersNotSolved);
    }
    // Reduction requires twelve paired dedges, not each dedge in its home slot.
    // Outer turns preserve pairing and must therefore require no pairing macros.
    if state.edges_paired() {
        return Ok(EdgeSolveResult {
            moves: Vec::new(),
            table_build_ms: 0.0,
            search_ms: 0.0,
        });
    }

    let tables_were_ready = EDGE_TABLES.get().is_some();
    let tables = get_tables(deadline_ts)?;
    let search_started = now_ms();
    let mut working = state.clone();
    let mut moves = Vec::with_capacity(384);

    for (index, phase) in tables.pair_phases.iter().enumerate() {
        descend_pair_phase(
            &mut working,
            &mut moves,
            phase,
            pair_phase_name(index),
            deadline_ts,
        )?;
    }
    descend_last_phase(&mut working, &mut moves, &tables.last_phase, deadline_ts)?;
    check_deadline(deadline_ts)?;

    let mut verified = state.clone();
    verified.apply_moves(&moves);
    if !verified.centers_solved() || !verified.edges_paired() || verified.validate().is_err() {
        return Err(EdgeSolveError::VerificationFailed);
    }

    Ok(EdgeSolveResult {
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
    use crate::solve_centers;

    fn centered_state(scramble: &str) -> Cube444 {
        let mut state = Cube444::solved();
        state.apply_alg(scramble).unwrap();
        let centers = solve_centers(&state, 0.0).unwrap();
        state.apply_moves(&centers.moves);
        assert!(state.centers_solved());
        state
    }

    fn apply_and_verify(scramble: &str) -> EdgeSolveResult {
        let mut state = centered_state(scramble);
        let result = solve_edges(&state, 0.0).unwrap();
        state.apply_moves(&result.moves);
        assert!(state.centers_solved(), "centers broke for {scramble}");
        assert!(state.edges_paired(), "edges not paired for {scramble}");
        assert_eq!(state.validate(), Ok(()));
        result
    }

    #[test]
    fn solved_cube_has_paired_edges() {
        assert!(Cube444::solved().edges_paired());
        let result = solve_edges(&Cube444::solved(), 0.0).unwrap();
        assert!(result.moves.is_empty());
    }

    #[test]
    fn outer_turns_keep_all_edges_paired_without_reduction_moves() {
        for face in Face::ALL {
            for amount in 1..=3 {
                let mut state = Cube444::solved();
                state.apply_move(Move444::new(face, false, amount));
                assert!(state.centers_solved());
                assert!(state.edges_paired());
                let result = solve_edges(&state, 0.0).unwrap();
                assert!(
                    result.moves.is_empty(),
                    "unexpected pairing moves for {face:?}{amount}"
                );
            }
        }
    }

    #[test]
    fn wing_geometry_and_home_slots_match_the_solved_cube() {
        assert_eq!(wing_positions().len(), WING_COUNT);
        let inventory = wing_inventory(&Cube444::solved()).unwrap();
        for edge_type in 0..EDGE_TYPE_COUNT {
            assert!(edge_home_paired(&inventory, edge_type));
        }
    }

    #[test]
    fn exact_tables_cover_the_expected_center_stabilizer_orbits() {
        let tables = get_tables(0.0).unwrap();
        assert_eq!(tables.pair_phases.len(), PAIR_PHASE_COUNT);
        for (phase, table) in tables.pair_phases.iter().enumerate() {
            assert_eq!(table.reachable, EXPECTED_PAIR_REACHABLE[phase]);
            assert_eq!(table.max_depth, EXPECTED_PAIR_MAX_DEPTH[phase]);
        }
        assert_eq!(tables.last_phase.reachable, EXPECTED_LAST_REACHABLE);
        assert_eq!(tables.last_phase.max_depth, EXPECTED_LAST_MAX_DEPTH);
    }

    #[test]
    fn selected_macros_preserve_centers_and_locked_pairs() {
        let tables = get_tables(0.0).unwrap();
        for (phase, table) in tables.pair_phases.iter().enumerate() {
            for wing_macro in &table.macros {
                verify_macro(wing_macro, phase, pair_phase_name(phase)).unwrap();
            }
        }
        for wing_macro in &tables.last_phase.macros {
            verify_macro(wing_macro, PAIR_PHASE_COUNT, "last4").unwrap();
        }
    }

    #[test]
    fn fixed_scrambles_pair_all_edges() {
        for scramble in [
            "Rw U2 F' Lw D B2",
            "Uw R2 Fw' D L2 Bw U'",
            "Rw2 F U' Bw2 Lw D2 R'",
            "Fw R U2 Rw' B2 Uw L' D",
        ] {
            let result = apply_and_verify(scramble);
            assert!(result.moves.len() <= 438);
        }
    }

    #[test]
    fn deterministic_random_corpus_pairs_edges() {
        let all_moves = Move444::all();
        let mut seed = 0x8b8b_8b8b_cafe_f00du64;
        for case in 0..24 {
            let mut scramble = Vec::with_capacity(36);
            for _ in 0..36 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                scramble.push(all_moves[((seed >> 32) as usize) % all_moves.len()]);
            }
            let mut state = Cube444::solved();
            state.apply_moves(&scramble);
            let centers = solve_centers(&state, 0.0).unwrap();
            state.apply_moves(&centers.moves);
            let edges = solve_edges(&state, 0.0)
                .unwrap_or_else(|error| panic!("edge case {case} failed: {error}"));
            state.apply_moves(&edges.moves);
            assert!(state.centers_solved(), "center regression in case {case}");
            assert!(state.edges_paired(), "edge regression in case {case}");
            assert_eq!(state.validate(), Ok(()));
        }
    }

    #[test]
    fn last_four_macro_states_are_solved_without_fallback() {
        let tables = get_tables(0.0).unwrap();
        for wing_macro in &tables.last_phase.macros {
            let mut state = Cube444::solved();
            for mv in wing_macro.moves.into_iter().rev() {
                state.apply_move(mv.inverse());
            }
            assert!(state.centers_solved());
            let result = solve_edges(&state, 0.0).unwrap();
            state.apply_moves(&result.moves);
            assert!(state.edges_paired());
        }
    }

    #[test]
    fn expired_deadline_is_rejected() {
        let error = solve_edges(&Cube444::solved(), 1.0).unwrap_err();
        assert_eq!(error, EdgeSolveError::DeadlineReached);
    }
}
