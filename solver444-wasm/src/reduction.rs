use core::fmt;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
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
            && !self.parity_signature().oll
            && !self.parity_signature().pll
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ParitySignature {
    pub oll: bool,
    pub pll: bool,
}

impl ParitySignature {
    fn bits(self) -> u8 {
        u8::from(self.oll) | (u8::from(self.pll) << 1)
    }

    fn xor(self, other: Self) -> Self {
        Self {
            oll: self.oll ^ other.oll,
            pll: self.pll ^ other.pll,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ParityNormalizeResult {
    pub moves: Vec<Move444>,
    pub before: ParitySignature,
    pub after: ParitySignature,
    pub virtual_state: Virtual333State,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReductionError {
    CentersNotSolved,
    EdgesNotPaired,
    InvalidVirtualCornerInventory,
    InvalidVirtualEdgeInventory,
    InvalidCornerOrientation,
    ParityMacroBreaksCenters(&'static str),
    ParityMacroBreaksEdges(&'static str),
    ParityBasisIncomplete {
        oll_signature: ParitySignature,
        pll_signature: ParitySignature,
        target: ParitySignature,
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
            Self::InvalidVirtualCornerInventory => write!(formatter, "invalid virtual 3x3 corner inventory"),
            Self::InvalidVirtualEdgeInventory => write!(formatter, "invalid virtual 3x3 edge inventory"),
            Self::InvalidCornerOrientation => write!(formatter, "invalid virtual 3x3 corner orientation sum"),
            Self::ParityMacroBreaksCenters(name) => write!(formatter, "parity macro {name} breaks centers"),
            Self::ParityMacroBreaksEdges(name) => write!(formatter, "parity macro {name} breaks paired edges"),
            Self::ParityBasisIncomplete {
                oll_signature,
                pll_signature,
                target,
            } => write!(
                formatter,
                "parity basis incomplete: oll={oll_signature:?}, pll={pll_signature:?}, target={target:?}"
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

fn decode_corners(facelets: &[u8; VIRTUAL_FACELET_COUNT]) -> Result<([u8; 8], [u8; 8]), ReductionError> {
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

fn decode_edges(facelets: &[u8; VIRTUAL_FACELET_COUNT]) -> Result<([u8; 12], [u8; 12]), ReductionError> {
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

fn oll_parity_macro() -> Vec<Move444> {
    vec![
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::R, true, 3),
        mv(Face::F, false, 2),
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::R, true, 1),
        mv(Face::U, false, 2),
        mv(Face::R, true, 3),
        mv(Face::F, false, 2),
    ]
}

fn pll_parity_macro() -> Vec<Move444> {
    // 2R2 U2 2R2 2U2 2R2 2U2, expanded with 2R = Rw R'
    // and 2U = Uw U'. For half turns the outer layers cancel.
    vec![
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, false, 2),
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, true, 2),
        mv(Face::U, false, 2),
        mv(Face::R, true, 2),
        mv(Face::R, false, 2),
        mv(Face::U, true, 2),
        mv(Face::U, false, 2),
    ]
}

fn verified_macro_signature(
    name: &'static str,
    moves: &[Move444],
) -> Result<ParitySignature, ReductionError> {
    let mut state = Cube444::solved();
    state.apply_moves(moves);
    if !state.centers_solved() {
        return Err(ReductionError::ParityMacroBreaksCenters(name));
    }
    if !state.edges_paired() {
        return Err(ReductionError::ParityMacroBreaksEdges(name));
    }
    Ok(state.virtual333_state()?.parity_signature())
}

pub fn normalize_parity(state: &Cube444) -> Result<ParityNormalizeResult, ReductionError> {
    let initial_virtual = state.virtual333_state()?;
    let before = initial_virtual.parity_signature();
    if before == ParitySignature::default() {
        return Ok(ParityNormalizeResult {
            moves: Vec::new(),
            before,
            after: before,
            virtual_state: initial_virtual,
        });
    }

    let oll_moves = oll_parity_macro();
    let pll_moves = pll_parity_macro();
    let oll_signature = verified_macro_signature("oll", &oll_moves)?;
    let pll_signature = verified_macro_signature("pll", &pll_moves)?;

    let candidates: [(u8, Vec<Move444>); 4] = [
        (0, Vec::new()),
        (1, oll_moves.clone()),
        (2, pll_moves.clone()),
        (3, {
            let mut both = oll_moves.clone();
            both.extend_from_slice(&pll_moves);
            both
        }),
    ];
    let selected = candidates.into_iter().find(|(mask, _)| {
        let mut signature = ParitySignature::default();
        if mask & 1 != 0 {
            signature = signature.xor(oll_signature);
        }
        if mask & 2 != 0 {
            signature = signature.xor(pll_signature);
        }
        signature == before
    });
    let Some((_, moves)) = selected else {
        return Err(ReductionError::ParityBasisIncomplete {
            oll_signature,
            pll_signature,
            target: before,
        });
    };

    let mut normalized = state.clone();
    normalized.apply_moves(&moves);
    if !normalized.centers_solved() {
        return Err(ReductionError::ParityMacroBreaksCenters("selected"));
    }
    if !normalized.edges_paired() {
        return Err(ReductionError::ParityMacroBreaksEdges("selected"));
    }
    let virtual_state = normalized.virtual333_state()?;
    let after = virtual_state.parity_signature();
    if after != ParitySignature::default() {
        return Err(ReductionError::ParityNormalizationFailed { before, after });
    }

    Ok(ParityNormalizeResult {
        moves,
        before,
        after,
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
        assert_eq!(Cube444::solved().virtual333_state().unwrap(), Virtual333State::solved());
    }

    #[test]
    fn outer_turns_remain_legal_virtual_333_states() {
        for face in Face::ALL {
            for amount in 1..=3 {
                let mut state = Cube444::solved();
                state.apply_move(Move444::new(face, false, amount));
                let virtual_state = state.virtual333_state().unwrap();
                assert!(virtual_state.is_legal(), "illegal virtual state after {face:?}{amount}");
            }
        }
    }

    #[test]
    fn parity_macros_form_a_two_bit_basis() {
        let oll_moves = oll_parity_macro();
        let pll_moves = pll_parity_macro();
        let oll_signature = verified_macro_signature("oll", &oll_moves).unwrap();
        let pll_signature = verified_macro_signature("pll", &pll_moves).unwrap();
        println!("OLL macro signature: {oll_signature:?}");
        println!("PLL macro signature: {pll_signature:?}");
        assert_ne!(oll_signature.bits(), 0);
        assert_ne!(pll_signature.bits(), 0);
        assert_ne!(oll_signature, pll_signature);
    }

    #[test]
    fn normalization_cancels_each_generated_parity_class() {
        let oll = oll_parity_macro();
        let pll = pll_parity_macro();
        for mask in 0..4u8 {
            let mut state = Cube444::solved();
            if mask & 1 != 0 {
                state.apply_moves(&oll);
            }
            if mask & 2 != 0 {
                state.apply_moves(&pll);
            }
            let result = normalize_parity(&state).unwrap();
            assert_eq!(result.after, ParitySignature::default());
            let mut verified = state.clone();
            verified.apply_moves(&result.moves);
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
            let before = state.virtual333_state().unwrap().parity_signature();
            let result = normalize_parity(&state).unwrap();
            assert_eq!(result.before, before);
            assert_eq!(result.after, ParitySignature::default());
            assert!(result.virtual_state.is_legal());
        }
    }
}
