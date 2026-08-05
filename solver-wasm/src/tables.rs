// Precomputed move tables for 2x2 corners.
// Move order: U, U2, U', F, F2, F', R, R2, R'.
// Tables are generated from the three quarter-turn definitions so half turns
// and inverse turns cannot accidentally be interpreted as unrelated 4-cycles.

use crate::permutation::permutation_to_index;
use once_cell::sync::Lazy;

pub const NMOVES: usize = 9;
pub const NPERM: usize = 40320; // 8!
pub const NORI: usize = 2187; // 3^7

pub struct MoveTable {
    pub perm: Vec<[u32; NMOVES]>,
}

pub static MOVE_TABLE: Lazy<MoveTable> = Lazy::new(build_move_table);

// Destination-position orientation deltas for one clockwise quarter turn.
// Corner order is shared with the permutation cycles below.
pub const QUARTER_ORI_DELTA: [[u8; 8]; 3] = [
    [0, 0, 0, 0, 0, 0, 0, 0], // U
    [2, 0, 0, 1, 1, 2, 0, 0], // F
    [1, 2, 0, 0, 2, 1, 0, 0], // R
];

// Clockwise quarter-turn cycles for U, F and R.
pub const QUARTER_CYCLES: [[usize; 4]; 3] = [
    [0, 1, 2, 3], // U
    [0, 4, 5, 3], // F
    [0, 1, 4, 5], // R
];

fn build_move_table() -> MoveTable {
    let mut perm = vec![[0u32; NMOVES]; NPERM];
    for idx in 0..NPERM {
        let original = index_to_perm(idx as u32);
        for mv in 0..NMOVES {
            let mut moved = original;
            let face = mv / 3;
            let turns = match mv % 3 {
                0 => 1,
                1 => 2,
                _ => 3,
            };
            for _ in 0..turns {
                apply_cycle(&mut moved, QUARTER_CYCLES[face]);
            }
            perm[idx][mv] = perm_to_index(&moved);
        }
    }
    MoveTable { perm }
}

pub fn apply_cycle<T: Copy>(values: &mut [T; 8], cyc: [usize; 4]) {
    let tmp = values[cyc[0]];
    values[cyc[0]] = values[cyc[3]];
    values[cyc[3]] = values[cyc[2]];
    values[cyc[2]] = values[cyc[1]];
    values[cyc[1]] = tmp;
}

fn index_to_perm(mut idx: u32) -> [u8; 8] {
    let mut elems = [0u8; 8];
    let mut used = [false; 8];
    for i in (0..8).rev() {
        let fact = factorial(i as u32);
        let pos = (idx / fact) as usize;
        idx %= fact;
        let mut count = 0;
        for n in 0..8 {
            if !used[n] {
                if count == pos {
                    elems[7 - i] = n as u8;
                    used[n] = true;
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