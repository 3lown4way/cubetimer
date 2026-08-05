use crate::state::State;
use crate::tables::{MOVE_TABLE, NMOVES, NORI, NPERM};
use std::cmp::max;

pub fn ida_solve(state: State, max_depth: u8, prune: &PruneTables) -> Option<Vec<usize>> {
    if state == State::solved() {
        return Some(Vec::new());
    }
    let h = prune.heuristic(state);
    let mut bound = max(1, h);
    let mut path = Vec::with_capacity(20);
    while bound <= max_depth {
        if let Some(solution) = search(state, 0, bound, usize::MAX, prune, &mut path) {
            return Some(solution);
        }
        bound += 1;
    }
    None
}

fn search(
    state: State,
    depth: u8,
    bound: u8,
    last_face: usize,
    prune: &PruneTables,
    path: &mut Vec<usize>,
) -> Option<Vec<usize>> {
    let h = prune.heuristic(state);
    let f = depth + h;
    if f > bound {
        return None;
    }
    // Do not infer solvedness from a heuristic value. The explicit state check
    // prevents a malformed or incomplete pruning table from returning a false
    // positive solution.
    if state == State::solved() {
        return Some(path.clone());
    }
    for mv in 0..NMOVES {
        let face = mv / 3; // 0:U, 1:F, 2:R
        if face == last_face {
            continue;
        }
        let next = state.apply_move(mv);
        path.push(mv);
        if let Some(solution) = search(next, depth + 1, bound, face, prune, path) {
            return Some(solution);
        }
        path.pop();
    }
    None
}

pub struct PruneTables {
    // Independent admissible distances for permutation and orientation.
    pub perm: Vec<u8>,
    pub ori: Vec<u8>,
}

impl PruneTables {
    pub fn heuristic(&self, state: State) -> u8 {
        let permutation = self.perm[state.perm_index() as usize];
        let orientation = self.ori[state.ori_index() as usize];
        std::cmp::max(permutation, orientation)
    }
}

pub fn build_prune_tables() -> PruneTables {
    let perm = bfs_prune_perm();
    let ori = bfs_prune_ori();
    PruneTables { perm, ori }
}

fn bfs_prune_perm() -> Vec<u8> {
    let mut dist = vec![255u8; NPERM];
    let mut queue = std::collections::VecDeque::new();
    dist[0] = 0;
    queue.push_back(0u32);
    while let Some(index) = queue.pop_front() {
        let depth = dist[index as usize];
        for mv in 0..NMOVES {
            let next = MOVE_TABLE.perm[index as usize][mv];
            if dist[next as usize] == 255 {
                dist[next as usize] = depth + 1;
                queue.push_back(next);
            }
        }
    }
    dist
}

fn bfs_prune_ori() -> Vec<u8> {
    let mut dist = vec![255u8; NORI];
    let mut queue = std::collections::VecDeque::new();
    dist[0] = 0;
    queue.push_back(0u32);
    while let Some(index) = queue.pop_front() {
        let depth = dist[index as usize];
        for mv in 0..NMOVES {
            // Reuse the production state transition so the pruning table and
            // search can never disagree about orientation permutation.
            let next = State::from_scramble_indices(0, index)
                .apply_move(mv)
                .ori_index();
            if dist[next as usize] == 255 {
                dist[next as usize] = depth + 1;
                queue.push_back(next);
            }
        }
    }
    dist
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solved_state_returns_empty_solution() {
        let prune = build_prune_tables();
        assert_eq!(ida_solve(State::solved(), 0, &prune), Some(Vec::new()));
    }

    #[test]
    fn pruning_tables_cover_every_coordinate() {
        let prune = build_prune_tables();
        assert!(prune.perm.iter().all(|&distance| distance != 255));
        assert!(prune.ori.iter().all(|&distance| distance != 255));
    }
}
