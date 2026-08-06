use core::fmt;
use std::collections::BTreeMap;

use crate::geometry::{move_permutation, sticker_geometry, Vec3};
use crate::moves::Move444;
use crate::parser::{parse_alg444, AlgParseError};

pub use crate::geometry::FACELET_COUNT;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cube444 {
    stickers: [u8; FACELET_COUNT],
}

impl Default for Cube444 {
    fn default() -> Self {
        Self::solved()
    }
}

impl Cube444 {
    pub fn solved() -> Self {
        Self {
            stickers: core::array::from_fn(|index| (index / 16) as u8),
        }
    }

    pub fn from_stickers(stickers: [u8; FACELET_COUNT]) -> Result<Self, StateValidationError> {
        let state = Self { stickers };
        state.validate()?;
        Ok(state)
    }

    pub fn stickers(&self) -> &[u8; FACELET_COUNT] {
        &self.stickers
    }

    pub fn apply_move(&mut self, mv: Move444) {
        let permutation = move_permutation(mv);
        let previous = self.stickers;
        for (old_index, &target_index) in permutation.iter().enumerate() {
            self.stickers[target_index as usize] = previous[old_index];
        }
    }

    pub fn apply_moves(&mut self, moves: &[Move444]) {
        for &mv in moves {
            self.apply_move(mv);
        }
    }

    pub fn apply_alg(&mut self, alg: &str) -> Result<(), AlgParseError> {
        let moves = parse_alg444(alg)?;
        self.apply_moves(&moves);
        Ok(())
    }

    pub fn is_solved(&self) -> bool {
        self.stickers
            .chunks_exact(16)
            .all(|face| face.iter().all(|&color| color == face[0]))
    }

    pub fn validate(&self) -> Result<(), StateValidationError> {
        validate_color_counts(&self.stickers)?;
        validate_piece_inventory(&self.stickers)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StateValidationError {
    InvalidColor {
        index: usize,
        color: u8,
    },
    ColorCount {
        color: u8,
        expected: usize,
        actual: usize,
    },
    CornerInventory,
    WingInventory,
    CenterInventory {
        color: u8,
        expected: usize,
        actual: usize,
    },
}

impl fmt::Display for StateValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidColor { index, color } => {
                write!(formatter, "invalid color {color} at facelet {index}")
            }
            Self::ColorCount {
                color,
                expected,
                actual,
            } => write!(
                formatter,
                "color {color} count mismatch: expected {expected}, got {actual}"
            ),
            Self::CornerInventory => write!(formatter, "invalid 4x4 corner inventory"),
            Self::WingInventory => write!(formatter, "invalid 4x4 wing inventory"),
            Self::CenterInventory {
                color,
                expected,
                actual,
            } => write!(
                formatter,
                "center color {color} count mismatch: expected {expected}, got {actual}"
            ),
        }
    }
}

impl std::error::Error for StateValidationError {}

fn validate_color_counts(stickers: &[u8; FACELET_COUNT]) -> Result<(), StateValidationError> {
    let mut counts = [0usize; 6];
    for (index, &color) in stickers.iter().enumerate() {
        if color >= 6 {
            return Err(StateValidationError::InvalidColor { index, color });
        }
        counts[color as usize] += 1;
    }
    for (color, actual) in counts.into_iter().enumerate() {
        if actual != 16 {
            return Err(StateValidationError::ColorCount {
                color: color as u8,
                expected: 16,
                actual,
            });
        }
    }
    Ok(())
}

fn sorted_colors(mut colors: Vec<u8>) -> Vec<u8> {
    colors.sort_unstable();
    colors
}

fn piece_inventory(stickers: &[u8; FACELET_COUNT]) -> BTreeMap<Vec3, Vec<u8>> {
    let mut inventory: BTreeMap<Vec3, Vec<u8>> = BTreeMap::new();
    for (index, &color) in stickers.iter().enumerate() {
        inventory
            .entry(sticker_geometry(index).pos)
            .or_default()
            .push(color);
    }
    inventory
}

fn piece_kind(position: Vec3) -> usize {
    [position.x, position.y, position.z]
        .into_iter()
        .filter(|coordinate| coordinate.abs() == 3)
        .count()
}

fn multiset_by_piece_kind(stickers: &[u8; FACELET_COUNT], kind: usize) -> BTreeMap<Vec<u8>, usize> {
    let mut result = BTreeMap::new();
    for (position, colors) in piece_inventory(stickers) {
        if piece_kind(position) == kind {
            *result.entry(sorted_colors(colors)).or_insert(0) += 1;
        }
    }
    result
}

fn validate_piece_inventory(stickers: &[u8; FACELET_COUNT]) -> Result<(), StateValidationError> {
    let solved = Cube444::solved();
    if multiset_by_piece_kind(stickers, 3) != multiset_by_piece_kind(&solved.stickers, 3) {
        return Err(StateValidationError::CornerInventory);
    }
    if multiset_by_piece_kind(stickers, 2) != multiset_by_piece_kind(&solved.stickers, 2) {
        return Err(StateValidationError::WingInventory);
    }

    let mut center_counts = [0usize; 6];
    for (position, colors) in piece_inventory(stickers) {
        if piece_kind(position) == 1 {
            debug_assert_eq!(colors.len(), 1);
            center_counts[colors[0] as usize] += 1;
        }
    }
    for (color, actual) in center_counts.into_iter().enumerate() {
        if actual != 4 {
            return Err(StateValidationError::CenterInventory {
                color: color as u8,
                expected: 4,
                actual,
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::moves::{Face, Move444};

    fn labelled_state() -> Cube444 {
        Cube444 {
            stickers: core::array::from_fn(|index| index as u8),
        }
    }

    #[test]
    fn solved_state_is_valid() {
        let solved = Cube444::solved();
        assert!(solved.is_solved());
        assert_eq!(solved.validate(), Ok(()));
    }

    #[test]
    fn every_move_and_inverse_restore_the_state() {
        for mv in Move444::all() {
            let mut state = Cube444::solved();
            state.apply_move(mv);
            assert_eq!(state.validate(), Ok(()), "invariant failure after {mv}");
            state.apply_move(mv.inverse());
            assert_eq!(state, Cube444::solved(), "inverse failure for {mv}");
        }
    }

    #[test]
    fn quarter_turns_have_order_four() {
        for face in Face::ALL {
            for wide in [false, true] {
                let mv = Move444::new(face, wide, 1);
                let mut state = labelled_state();
                for _ in 0..4 {
                    state.apply_move(mv);
                }
                assert_eq!(state, labelled_state(), "order-four failure for {mv}");
            }
        }
    }

    #[test]
    fn half_turns_have_order_two() {
        for face in Face::ALL {
            for wide in [false, true] {
                let mv = Move444::new(face, wide, 2);
                let mut state = labelled_state();
                state.apply_move(mv);
                state.apply_move(mv);
                assert_eq!(state, labelled_state(), "order-two failure for {mv}");
            }
        }
    }

    #[test]
    fn r_turn_cycles_the_expected_outer_strips() {
        let before = labelled_state();
        let mut after = before.clone();
        after.apply_move(Move444::new(Face::R, false, 1));
        for row in 0..4 {
            let u = row * 4 + 3;
            let f = 2 * 16 + row * 4 + 3;
            let d = 3 * 16 + row * 4 + 3;
            assert_eq!(after.stickers[f], before.stickers[u]);
            assert_eq!(after.stickers[d], before.stickers[f]);
        }
    }

    #[test]
    fn deterministic_random_sequence_preserves_invariants_and_inverts() {
        let all_moves = Move444::all();
        let mut seed = 0x4d59_5df4_d0f3_3173u64;
        let mut moves = Vec::new();
        let mut state = Cube444::solved();
        for _ in 0..10_000 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let mv = all_moves[((seed >> 32) as usize) % all_moves.len()];
            state.apply_move(mv);
            moves.push(mv);
        }
        assert_eq!(state.validate(), Ok(()));
        for mv in moves.into_iter().rev() {
            state.apply_move(mv.inverse());
        }
        assert_eq!(state, Cube444::solved());
    }

    #[test]
    fn parser_and_state_application_match_manual_moves() {
        let alg = "Rw U2 Fw' L D2 Bw R' Uw2";
        let parsed = parse_alg444(alg).unwrap();
        let mut parsed_state = Cube444::solved();
        parsed_state.apply_moves(&parsed);
        let mut string_state = Cube444::solved();
        string_state.apply_alg(alg).unwrap();
        assert_eq!(parsed_state, string_state);
        assert!(!string_state.is_solved());
        assert_eq!(string_state.validate(), Ok(()));
    }

    #[test]
    fn invalid_color_count_is_rejected() {
        let mut stickers = Cube444::solved().stickers;
        stickers[0] = 1;
        assert!(matches!(
            Cube444::from_stickers(stickers),
            Err(StateValidationError::ColorCount { .. })
        ));
    }

    #[test]
    fn impossible_corner_inventory_is_rejected() {
        let mut stickers = Cube444::solved().stickers;
        // Swap one U corner sticker with one R corner sticker while preserving colors.
        stickers.swap(0, 16 + 3);
        assert!(Cube444::from_stickers(stickers).is_err());
    }
}
