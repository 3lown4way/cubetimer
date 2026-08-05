// Precomputed move tables for 2x2 corners.
// Move order: U, U2, U', F, F2, F', R, R2, R'.
// The raw position maps and orientation deltas are generated from the vendored
// cubing.js cube2x2x2 definition by tools/export-2x2-rust-moves.mjs.

use crate::permutation::permutation_to_index;
use once_cell::sync::Lazy;

include!("generated_2x2_moves.rs");

pub const NMOVES: usize = 9;
pub const NPERM: usize = 40320; // 8!, with only the fixed-corner subgroup reachable.
pub const NORI: usize = 2187; // 3^7, with only the fixed-corner subgroup reachable.

pub struct MoveTable {
    pub perm: Vec<[u32; NMOVES]>,
}

pub static MOVE_TABLE: Lazy<MoveTable> = Lazy::new(build_move_table);

fn build_move_table() -> MoveTable {
    let mut perm = vec![[0u32; NMOVES]; NPERM];
    for idx in 0..NPERM {
        let original = index_to_perm(idx as u32);
        for mv in 0..NMOVES {
            let mut moved = [0u8; 8];
            for new_position in 0..8 {
                let old_position = MOVE_PERM_MAP[mv][new_position];
                moved[new_position] = original[old_position];
            }
            perm[idx][mv] = perm_to_index(&moved);
        }
    }
    MoveTable { perm }
}

fn index_to_perm(mut idx: u32) -> [u8; 8] {
    let mut elems = [0u8; 8];
    let mut used = [false; 8];
    for i in (0..8).rev() {
        let fact = factorial(i as u32);
        let pos = (idx / fact) as usize;
        idx %= fact;
        let mut count = 0;
        for (n, is_used) in used.iter_mut().enumerate() {
            if !*is_used {
                if count == pos {
                    elems[7 - i] = n as u8;
                    *is_used = true;
                    break;
                }
                count += 1;
            }
        }
    }
    elems
}

fn perm_to_index(p: &[u8; 8]) -> u32 {
    permutation_to_index(p.iter().map(|&x| x as usize)) as u32
}

fn factorial(n: u32) -> u32 {
    (1..=n).product::<u32>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_move_maps_are_permutations() {
        for map in MOVE_PERM_MAP {
            let mut sorted = map;
            sorted.sort_unstable();
            assert_eq!(sorted, [0usize, 1, 2, 3, 4, 5, 6, 7]);
        }
    }

    #[test]
    fn half_turns_square_to_identity() {
        for mv in [1usize, 4, 7] {
            let once = MOVE_TABLE.perm[0][mv] as usize;
            assert_eq!(MOVE_TABLE.perm[once][mv], 0);
        }
    }

    #[test]
    fn quarter_turns_have_order_four() {
        for mv in [0usize, 3, 6] {
            let mut state = 0usize;
            for _ in 0..4 {
                state = MOVE_TABLE.perm[state][mv] as usize;
            }
            assert_eq!(state, 0);
        }
    }
}
