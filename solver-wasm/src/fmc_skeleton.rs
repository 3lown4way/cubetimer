use crate::fmc_leftover::classify_leftovers;
use crate::fmc_search::OPPOSITE_FACE;
use crate::minmove_core::{CubeState, LAST_FACE_FREE, MOVE_COUNT};
use crate::twophase_bundle::TwophaseTables;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkeletonCandidate {
    pub skeleton_moves: Vec<u8>,
    pub leftover_type: String,
    pub leftover_signature: String,
}

struct SkeletonSearchCtx<'a> {
    tables: &'a TwophaseTables,
    max_depth: u8,
    top_k: usize,
    path: Vec<u8>,
    results: Vec<SkeletonCandidate>,
}

impl<'a> SkeletonSearchCtx<'a> {
    fn dfs(&mut self, state: &CubeState, depth: u8, last_face: u8) {
        if self.results.len() >= self.top_k {
            return;
        }

        let info = classify_leftovers(state);
        if info.kind == "3C" {
            self.results.push(SkeletonCandidate {
                skeleton_moves: self.path.clone(),
                leftover_type: info.kind,
                leftover_signature: info.signature,
            });
            if self.results.len() >= self.top_k {
                return;
            }
        }

        if depth >= self.max_depth {
            return;
        }

        for mv in 0..MOVE_COUNT {
            let move_idx = mv as u8;
            let face = self.tables.move_data.move_face[mv];
            if last_face != LAST_FACE_FREE {
                if face == last_face {
                    continue;
                }
                if face == OPPOSITE_FACE[last_face as usize] && face < last_face {
                    continue;
                }
            }

            self.path.push(move_idx);
            let next = state.apply_move(mv, &self.tables.move_data);
            self.dfs(&next, depth + 1, face);
            self.path.pop();

            if self.results.len() >= self.top_k {
                return;
            }
        }
    }
}

pub fn search_skeleton_3c(
    start: &CubeState,
    tables: &TwophaseTables,
    max_depth: u8,
    top_k: usize,
) -> Vec<SkeletonCandidate> {
    if top_k == 0 {
        return Vec::new();
    }

    let mut ctx = SkeletonSearchCtx {
        tables,
        max_depth,
        top_k,
        path: Vec::with_capacity(max_depth as usize),
        results: Vec::new(),
    };
    ctx.dfs(start, 0, LAST_FACE_FREE);
    ctx.results
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minmove_bundle::{MoveTable, PackedTable};
    use crate::minmove_core::{MoveData, CORNER_COUNT, EDGE_COUNT};

    fn test_tables_with_3c_move() -> TwophaseTables {
        let move_names = [
            "U", "U'", "U2", "R", "R'", "R2", "F", "F'", "F2", "D", "D'", "D2", "L",
            "L'", "L2", "B", "B'", "B2",
        ]
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();

        let mut corner_perm_map = vec![0u8; MOVE_COUNT * CORNER_COUNT];
        let mut edge_perm_map = vec![0u8; MOVE_COUNT * EDGE_COUNT];
        for m in 0..MOVE_COUNT {
            for pos in 0..CORNER_COUNT {
                corner_perm_map[m * CORNER_COUNT + pos] = pos as u8;
            }
            for pos in 0..EDGE_COUNT {
                edge_perm_map[m * EDGE_COUNT + pos] = pos as u8;
            }
        }

        corner_perm_map[0] = 1;
        corner_perm_map[1] = 2;
        corner_perm_map[2] = 0;

        TwophaseTables {
            move_data: MoveData {
                move_names,
                move_face: vec![0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5],
                corner_perm_map,
                corner_ori_delta: vec![0; MOVE_COUNT * CORNER_COUNT],
                edge_perm_map,
                edge_ori_delta: vec![0; MOVE_COUNT * EDGE_COUNT],
                edge_new_pos_map: vec![0; MOVE_COUNT * EDGE_COUNT],
            },
            phase1_allowed_moves_by_last_face: vec![vec![]],
            phase2_allowed_moves_by_last_face: vec![vec![]],
            phase2_move_indices: [0; 10],
            phase2_move_faces: [0; 10],
            co: PackedTable { count: 0, max_distance: 0, nibble_packed: false, payload: vec![] },
            eo: PackedTable { count: 0, max_distance: 0, nibble_packed: false, payload: vec![] },
            slice: PackedTable { count: 0, max_distance: 0, nibble_packed: false, payload: vec![] },
            phase2_ep: PackedTable { count: 0, max_distance: 0, nibble_packed: false, payload: vec![] },
            phase2_cp_sep_joint: PackedTable { count: 0, max_distance: 0, nibble_packed: false, payload: vec![] },
            co_move: MoveTable { states: 0, moves: 0, values: vec![] },
            eo_move: MoveTable { states: 0, moves: 0, values: vec![] },
            slice_move: MoveTable { states: 0, moves: 0, values: vec![] },
            phase2_cp_move: MoveTable { states: 0, moves: 0, values: vec![] },
            phase2_ep_move: MoveTable { states: 0, moves: 0, values: vec![] },
            phase2_sep_move: MoveTable { states: 0, moves: 0, values: vec![] },
            solved_slice: 0,
        }
    }

    #[test]
    fn skeleton_search_is_deterministic_and_bounded() {
        let tables = test_tables_with_3c_move();
        let start = CubeState::solved();

        let first = search_skeleton_3c(&start, &tables, 2, 2);
        let second = search_skeleton_3c(&start, &tables, 2, 2);

        assert_eq!(first, second);
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].skeleton_moves, vec![0]);
        assert_eq!(first[0].leftover_type, "3C");
        assert!(!first[0].leftover_signature.is_empty());
    }
}
