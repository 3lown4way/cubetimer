use crate::tables::{MOVE_ORI_DELTA, MOVE_PERM_MAP, MOVE_TABLE};

// 2x2 state packed into u64: lower 32 bits for permutation (factorial base),
// upper 32 bits for orientation base-3 (7 corners, last determined).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct State(pub u64);

impl State {
    pub fn solved() -> Self {
        State(0)
    }

    pub fn from_scramble_indices(perm_index: u32, ori_index: u32) -> Self {
        let packed = (ori_index as u64) << 32 | perm_index as u64;
        State(packed)
    }

    pub fn perm_index(self) -> u32 {
        self.0 as u32
    }

    pub fn ori_index(self) -> u32 {
        (self.0 >> 32) as u32
    }

    pub fn apply_move(self, mv: usize) -> Self {
        let new_perm = MOVE_TABLE.perm[self.perm_index() as usize][mv];
        let new_ori = apply_ori(self.ori_index(), mv);
        State::from_scramble_indices(new_perm, new_ori)
    }
}

fn decode_ori(mut index: u32) -> [u8; 8] {
    let mut ori = [0u8; 8];
    let mut sum = 0u8;
    for value in ori.iter_mut().take(7) {
        *value = (index % 3) as u8;
        index /= 3;
        sum = (sum + *value) % 3;
    }
    ori[7] = (3 - sum) % 3;
    ori
}

fn encode_ori(ori: &[u8; 8]) -> u32 {
    let mut result = 0u32;
    let mut factor = 1u32;
    for &value in ori.iter().take(7) {
        result += u32::from(value) * factor;
        factor *= 3;
    }
    result
}

fn apply_ori(ori_index: u32, mv: usize) -> u32 {
    debug_assert!(mv < MOVE_PERM_MAP.len());
    let ori = decode_ori(ori_index);
    let mut next = [0u8; 8];
    for new_position in 0..8 {
        let old_position = MOVE_PERM_MAP[mv][new_position];
        next[new_position] = (ori[old_position] + MOVE_ORI_DELTA[mv][new_position]) % 3;
    }
    encode_ori(&next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solved_state_is_restored_by_move_and_inverse() {
        for (mv, inverse) in [(0usize, 2usize), (3, 5), (6, 8)] {
            let state = State::solved().apply_move(mv).apply_move(inverse);
            assert_eq!(state, State::solved());
        }
    }

    #[test]
    fn half_turns_square_to_solved() {
        for mv in [1usize, 4, 7] {
            let state = State::solved().apply_move(mv).apply_move(mv);
            assert_eq!(state, State::solved());
        }
    }

    #[test]
    fn orientation_constraint_is_preserved() {
        let mut state = State::solved();
        for mv in [3usize, 6, 5, 8, 1, 4, 7] {
            state = state.apply_move(mv);
            let ori = decode_ori(state.ori_index());
            assert_eq!(ori.iter().map(|&v| u32::from(v)).sum::<u32>() % 3, 0);
        }
    }
}
