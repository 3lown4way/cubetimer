use core::fmt;

use serde::Serialize;

use crate::{Cube444, Face, Move444};

const CORNER_COUNT: usize = 8;
const EDGE_COUNT: usize = 12;
const VIRTUAL_FACELET_COUNT: usize = 54;

// Kociemba/cubing.js order: URF UFL ULB UBR DFR DLF DBL DRB.
const CORNER_FACELETS: [[usize; 3]; CORNER_COUNT] = [
    [8, 9, 20],
    [6, 18, 38],
    [0, 36, 47],
    [2, 45, 11],
    [29, 26, 15],
    [27, 44, 24],
    [33, 53, 42],
    [35, 17, 51],
];

const CORNER_COLORS: [[u8; 3]; CORNER_COUNT] = [
    [0, 1, 2],
    [0, 2, 4],
    [0, 4, 5],
    [0, 5, 1],
    [3, 2, 1],
    [3, 4, 2],
    [3, 5, 4],
    [3, 1, 5],
];

// Kociemba/cubing.js order: UR UF UL UB DR DF DL DB FR FL BL BR.
const EDGE_FACELETS: [[usize; 2]; EDGE_COUNT] = [
    [5, 10],
    [7, 19],
    [3, 37],
    [1, 46],
    [32, 16],
    [28, 25],
    [30, 43],
    [34, 52],
    [23, 12],
    [21, 41],
    [50, 39],
    [48, 14],
];

const EDGE_COLORS: [[u8; 2]; EDGE_COUNT] = [
    [0, 1],
    [0, 2],
    [0, 4],
    [0, 5],
    [3, 1],
    [3, 2],
    [3, 4],
    [3, 5],
    [2, 1],
    [2, 4],
    [5, 4],
    [5, 1],
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct Virtual333State {
    pub cp: [u8; CORNER_COUNT],
    pub co: [u8; CORNER_COUNT],
    pub ep: [u8; EDGE_COUNT],
    pub eo: [u8; EDGE_COUNT],
}

impl Virtual333State {
    pub fn solved() -> Self {
        Self {
            cp: core::array::from_fn(|index| index as u8),
            co: [0; CORNER_COUNT],
            ep: core::array::from_fn(|index| index as u8),
            eo: [0; EDGE_COUNT],
        }
    }

    pub fn parity_signature(&self) -> ParitySignature {
        let edge_flip_odd = self.eo.iter().map(|&value| value as usize).sum::<usize>() & 1 != 0;
        let permutation_mismatch = permutation_is_odd(&self.cp) != permutation_is_odd(&self.ep);
        ParitySignature {
            oll: edge_flip_odd,
            pll: permutation_mismatch,
        }
    }

    pub fn is_legal(&self) -> bool {
        self.co.iter().map(|&value| value as usize).sum::<usize>() % 3 == 0
            && self.parity_signature() == ParitySignature::default()
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct ParitySignature {
    pub oll: bool,
    pub pll: bool,
}

#[derive(Clone, Debug)]
pub struct ParityNormalizeResult {
    pub moves: Vec<Move444>,
    pub before: ParitySignature,
    pub after: ParitySignature,
    pub applied_oll: bool,
    pub applied_pll: bool,
    pub virtual_state: Virtual333State,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReductionError {
    CentersNotSolved,
    EdgesNotPaired,
    InvalidVirtualCornerInventory,
    InvalidVirtualEdgeInventory,
    InvalidCornerOrientation,
    ParityGeneratorBreaksCenters(&'static str),
    ParityGeneratorBreaksEdges(&'static str),
    ParityGeneratorSignatureMismatch {
        name: &'static str,
        expected: ParitySignature,
        actual: ParitySignature,
    },
    ParityNormalizationFailed {
        before: ParitySignature,
        after: ParitySignature,
    },
}

impl fmt::Display for ReductionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CentersNotSolved => write!(formatter, "4x4 centers are not solved"),
            Self::EdgesNotPaired => write!(formatter, "4x4 edges are not paired"),
            Self::InvalidVirtualCornerInventory => {
                write!(formatter, "invalid virtual 3x3 corner inventory")
            }
            Self::InvalidVirtualEdgeInventory => {
                write!(formatter, "invalid virtual 3x3 edge inventory")
            }
            Self::InvalidCornerOrientation => {
                write!(formatter, "invalid virtual 3x3 corner orientation sum")
            }
            Self::ParityGeneratorBreaksCenters(name) => {
                write!(formatter, "parity generator {name} breaks centers")
            }
            Self::ParityGeneratorBreaksEdges(name) => {
                write!(formatter, "parity generator {name} breaks paired edges")
            }
            Self::ParityGeneratorSignatureMismatch {
                name,
                expected,
                actual,
            } => write!(
                formatter,
                "parity generator {name} has signature {actual:?}, expected {expected:?}"
            ),
            Self::ParityNormalizationFailed { before, after } => write!(
                formatter,
                "parity normalization failed: before={before:?}, after={after:?}"
            ),
        }
    }
}

impl std::error::Error for ReductionError {}

fn virtual_facelets(state: &Cube444) -> [u8; VIRTUAL_FACELET_COUNT] {
    let mut result = [0u8; VIRTUAL_FACELET_COUNT];
    for face in 0..6 {
        for row in 0..3 {
            for col in 0..3 {
                let virtual_index = face * 9 + row * 3 + col;
                result[virtual_index] = if row == 1 && col == 1 {
                    face as u8
                } else {
                    let source_row = match row {
                        0 => 0,
                        1 => 1,
                        2 => 3,
                        _ => unreachable!(),
                    };
                    let source_col = match col {
                        0 => 0,
                        1 => 1,
                        2 => 3,
                        _ => unreachable!(),
                    };
                    state.stickers()[face * 16 + source_row * 4 + source_col]
                };
            }
        }
    }
    result
}

fn decode_corners(
    facelets: &[u8; VIRTUAL_FACELET_COUNT],
) -> Result<([u8; CORNER_COUNT], [u8; CORNER_COUNT]), ReductionError> {
    let mut cp = [u8::MAX; CORNER_COUNT];
    let mut co = [0u8; CORNER_COUNT];
    let mut seen = [false; CORNER_COUNT];

    for position in 0..CORNER_COUNT {
        let colors = [
            facelets[CORNER_FACELETS[position][0]],
            facelets[CORNER_FACELETS[position][1]],
            facelets[CORNER_FACELETS[position][2]],
        ];
        let orientation = colors
            .iter()
            .position(|&color| color == 0 || color == 3)
            .ok_or(ReductionError::InvalidVirtualCornerInventory)?;
        let side1 = colors[(orientation + 1) % 3];
        let side2 = colors[(orientation + 2) % 3];
        let piece = CORNER_COLORS
            .iter()
            .position(|candidate| candidate[1] == side1 && candidate[2] == side2)
            .ok_or(ReductionError::InvalidVirtualCornerInventory)?;
        if seen[piece] {
            return Err(ReductionError::InvalidVirtualCornerInventory);
        }
        seen[piece] = true;
        cp[position] = piece as u8;
        co[position] = orientation as u8;
    }

    if !seen.into_iter().all(|value| value) {
        return Err(ReductionError::InvalidVirtualCornerInventory);
    }
    Ok((cp, co))
}

fn decode_edges(
    facelets: &[u8; VIRTUAL_FACELET_COUNT],
) -> Result<([u8; EDGE_COUNT], [u8; EDGE_COUNT]), ReductionError> {
    let mut ep = [u8::MAX; EDGE_COUNT];
    let mut eo = [0u8; EDGE_COUNT];
    let mut seen = [false; EDGE_COUNT];

    for position in 0..EDGE_COUNT {
        let colors = [
            facelets[EDGE_FACELETS[position][0]],
            facelets[EDGE_FACELETS[position][1]],
        ];
        let mut found = None;
        for (piece, candidate) in EDGE_COLORS.iter().enumerate() {
            if colors == *candidate {
                found = Some((piece, 0));
                break;
            }
            if colors == [candidate[1], candidate[0]] {
                found = Some((piece, 1));
                break;
            }
        }
        let (piece, orientation) = found.ok_or(ReductionError::InvalidVirtualEdgeInventory)?;
        if seen[piece] {
            return Err(ReductionError::InvalidVirtualEdgeInventory);
        }
        seen[piece] = true;
        ep[position] = piece as u8;
        eo[position] = orientation;
    }

    if !seen.into_iter().all(|value| value) {
        return Err(ReductionError::InvalidVirtualEdgeInventory);
    }
    Ok((ep, eo))
}

fn permutation_is_odd<const N: usize>(permutation: &[u8; N]) -> bool {
    let mut odd = false;
    for first in 0..N {
        for second in (first + 1)..N {
            if permutation[first] > permutation[second] {
                odd = !odd;
            }
        }
    }
    odd
}

impl Cube444 {
    pub fn virtual333_state(&self) -> Result<Virtual333State, ReductionError> {
        if !self.centers_solved() {
            return Err(ReductionError::CentersNotSolved);
        }
        if !self.edges_paired() {
            return Err(ReductionError::EdgesNotPaired);
        }
        let facelets = virtual_facelets(self);
        let (cp, co) = decode_corners(&facelets)?;
        let (ep, eo) = decode_edges(&facelets)?;
        let state = Virtual333State { cp, co, ep, eo };
        if state.co.iter().map(|&value| value as usize).sum::<usize>() % 3 != 0 {
            return Err(ReductionError::InvalidCornerOrientation);
        }
        Ok(state)
    }
}

const fn mv(face: Face, wide: bool, amount: u8) -> Move444 {
    Move444::new(face, wide, amount)
}

fn oll_parity_generator() -> Vec<Move444> {
    // The repository's fixed-facelet turn direction is the inverse of the
    // common Rw quarter-turn convention used by the published algorithm.
    // This mirrored form was derived and then verified on the 96-facelet model.
    vec![
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::R, true, 3),
        mv(Face::U, false, 2),
        mv(Face::R, true, 1),
        mv(Face::F, false, 2),
        mv(Face::R, true, 2),
        mv(Face::U, false, 2),
        mv(Face::R, true, 3),
        mv(Face::U, false, 2),
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::F, false, 2),
        mv(Face::R, true, 2),
        mv(Face::F, false, 2),
    ]
}

fn pll_parity_generator() -> Vec<Move444> {
    // 2R2 U2 2R2 Uw2 2R2 Uw2, with inner 2R2 represented as Rw2 R2.
    vec![
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, false, 2),
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, true, 2),
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, true, 2),
    ]
}

fn verify_generator(
    name: &'static str,
    moves: &[Move444],
    expected: ParitySignature,
) -> Result<(), ReductionError> {
    let mut state = Cube444::solved();
    state.apply_moves(moves);
    if !state.centers_solved() {
        return Err(ReductionError::ParityGeneratorBreaksCenters(name));
    }
    if !state.edges_paired() {
        return Err(ReductionError::ParityGeneratorBreaksEdges(name));
    }
    let actual = state.virtual333_state()?.parity_signature();
    if actual != expected {
        return Err(ReductionError::ParityGeneratorSignatureMismatch {
            name,
            expected,
            actual,
        });
    }
    Ok(())
}

pub fn normalize_parity(state: &Cube444) -> Result<ParityNormalizeResult, ReductionError> {
    let initial_virtual = state.virtual333_state()?;
    let before = initial_virtual.parity_signature();
    if before == ParitySignature::default() {
        return Ok(ParityNormalizeResult {
            moves: Vec::new(),
            before,
            after: before,
            applied_oll: false,
            applied_pll: false,
            virtual_state: initial_virtual,
        });
    }

    let oll_moves = oll_parity_generator();
    let pll_moves = pll_parity_generator();
    verify_generator(
        "oll",
        &oll_moves,
        ParitySignature {
            oll: true,
            pll: false,
        },
    )?;
    verify_generator(
        "pll",
        &pll_moves,
        ParitySignature {
            oll: false,
            pll: true,
        },
    )?;

    let mut moves = Vec::new();
    if before.oll {
        moves.extend_from_slice(&oll_moves);
    }
    if before.pll {
        moves.extend_from_slice(&pll_moves);
    }

    let mut normalized = state.clone();
    normalized.apply_moves(&moves);
    if !normalized.centers_solved() {
        return Err(ReductionError::ParityGeneratorBreaksCenters("selected"));
    }
    if !normalized.edges_paired() {
        return Err(ReductionError::ParityGeneratorBreaksEdges("selected"));
    }
    let virtual_state = normalized.virtual333_state()?;
    let after = virtual_state.parity_signature();
    if after != ParitySignature::default() || !virtual_state.is_legal() {
        return Err(ReductionError::ParityNormalizationFailed { before, after });
    }

    Ok(ParityNormalizeResult {
        moves,
        before,
        after,
        applied_oll: before.oll,
        applied_pll: before.pll,
        virtual_state,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_alg444, solve_centers, solve_edges};

    fn reduced_state(scramble: &str) -> Cube444 {
        let mut state = Cube444::solved();
        state.apply_moves(&parse_alg444(scramble).unwrap());
        let centers = solve_centers(&state, 0.0).unwrap();
        state.apply_moves(&centers.moves);
        let edges = solve_edges(&state, 0.0).unwrap();
        state.apply_moves(&edges.moves);
        assert!(state.centers_solved());
        assert!(state.edges_paired());
        state
    }

    #[test]
    fn solved_state_maps_to_solved_virtual_333() {
        assert_eq!(
            Cube444::solved().virtual333_state().unwrap(),
            Virtual333State::solved()
        );
    }

    #[test]
    fn outer_turns_remain_legal_virtual_333_states() {
        for face in Face::ALL {
            for amount in 1..=3 {
                let mut state = Cube444::solved();
                state.apply_move(Move444::new(face, false, amount));
                let virtual_state = state.virtual333_state().unwrap();
                assert!(
                    virtual_state.is_legal(),
                    "illegal virtual state after {face:?}{amount}"
                );
            }
        }
    }

    #[test]
    fn parity_generators_have_exact_independent_signatures() {
        let cases = [
            (
                "oll",
                oll_parity_generator(),
                ParitySignature {
                    oll: true,
                    pll: false,
                },
            ),
            (
                "pll",
                pll_parity_generator(),
                ParitySignature {
                    oll: false,
                    pll: true,
                },
            ),
        ];
        for (name, moves, expected) in cases {
            verify_generator(name, &moves, expected).unwrap();
        }
    }

    #[test]
    fn normalization_cancels_all_generated_parity_classes() {
        for mask in 0..4u8 {
            let mut state = Cube444::solved();
            if mask & 1 != 0 {
                state.apply_moves(&oll_parity_generator());
            }
            if mask & 2 != 0 {
                state.apply_moves(&pll_parity_generator());
            }
            let before = state.virtual333_state().unwrap().parity_signature();
            let result = normalize_parity(&state).unwrap();
            assert_eq!(result.before, before);
            assert_eq!(result.after, ParitySignature::default());
            assert_eq!(result.applied_oll, before.oll);
            assert_eq!(result.applied_pll, before.pll);

            let mut verified = state.clone();
            verified.apply_moves(&result.moves);
            assert!(verified.centers_solved());
            assert!(verified.edges_paired());
            assert!(verified.virtual333_state().unwrap().is_legal());
        }
    }

    #[test]
    fn reduced_scramble_corpus_normalizes_to_legal_virtual_states() {
        let corpus = [
            "Rw U2 F' Lw D B2",
            "U Rw2 F2 D' Lw U2 B R2 Fw'",
            "F Rw U' B2 Lw2 D F2 Uw R'",
            "Rw2 Fw U2 L' B Dw2 R F' U",
            "B2 Uw Rw' D2 F Lw2 U' R2 B'",
            "Lw F2 Uw' R B2 D' Rw2 U F'",
        ];
        for scramble in corpus {
            let state = reduced_state(scramble);
            let result = normalize_parity(&state).unwrap();
            let mut verified = state.clone();
            verified.apply_moves(&result.moves);
            assert!(verified.centers_solved(), "centers broken for {scramble}");
            assert!(verified.edges_paired(), "edges broken for {scramble}");
            assert!(
                verified.virtual333_state().unwrap().is_legal(),
                "illegal virtual state for {scramble}"
            );
        }
    }
}
