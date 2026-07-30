from pathlib import Path

path = Path("solver-wasm/src/fmc_insertion.rs")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "use std::collections::HashMap;\n",
    "use std::collections::{hash_map::Entry, HashMap};\n",
    "HashMap import",
)

replace_once(
    """fn is_half_turn(m: u8) -> bool {
    m % 3 == 2
}

// ---------------------------------------------------------------------------
// Bidirectional BFS frontier
""",
    """fn is_half_turn(m: u8) -> bool {
    m % 3 == 2
}

const INSERTION_LAST_FACE_COUNT: usize = LAST_FACE_FREE as usize + 1;
type InsertionAllowedMoves = [Vec<u8>; INSERTION_LAST_FACE_COUNT];

fn build_allowed_moves(move_face_table: &[u8]) -> InsertionAllowedMoves {
    std::array::from_fn(|last_face| {
        let mut allowed = Vec::with_capacity(MOVE_COUNT);
        for m in 0..MOVE_COUNT as u8 {
            let face = move_face_table[m as usize];
            if last_face < LAST_FACE_FREE as usize && face == last_face as u8 {
                continue;
            }
            if last_face < LAST_FACE_FREE as usize
                && OPPOSITE_FACE[face as usize] == last_face as u8
                && face < last_face as u8
            {
                continue;
            }
            allowed.push(m);
        }
        allowed
    })
}

// ---------------------------------------------------------------------------
// Bidirectional BFS frontier
""",
    "precompute insertion move lists",
)

replace_once(
    """    backward: bool,
    move_face_table: &[u8],
    move_data: &crate::minmove_core::MoveData,
) -> HashMap<StateKey, Vec<u8>> {
""",
    """    backward: bool,
    move_face_table: &[u8],
    allowed_moves_by_last_face: &InsertionAllowedMoves,
    move_data: &crate::minmove_core::MoveData,
) -> HashMap<StateKey, Vec<u8>> {
""",
    "BFS allowed-move parameter",
)

replace_once(
    """        for node in &queue {
            for m in 0..MOVE_COUNT as u8 {
                let face = move_face_table[m as usize];
                let last = node.last_face;
                // Skip same face
                if last < LAST_FACE_FREE && face == last {
                    continue;
                }
                // Skip canonical duplicate for opposite-face pairs
                if last < LAST_FACE_FREE && OPPOSITE_FACE[face as usize] == last && face < last {
                    continue;
                }

                let apply_m = if backward { MOVE_INVERSE[m as usize] } else { m };
                let next_state = node.state.apply_move(apply_m as usize, move_data);
                let key = state_key(&next_state);
                if map.contains_key(&key) {
                    continue;
                }

                let path: Vec<u8> = if backward {
                    // prepend m so the path reads: meeting_point → root
                    let mut p = vec![m];
                    p.extend_from_slice(&node.path);
                    p
                } else {
                    let mut p = node.path.clone();
                    p.push(m);
                    p
                };

                map.insert(key, path.clone());
                // next_queue last_face uses the actual applied face for pruning
                let next_last_face = face; // face of m == face of MOVE_INVERSE[m]
                next_queue.push(Node {
                    state: next_state,
                    path,
                    last_face: next_last_face,
                });
            }
        }
""",
    """        for node in &queue {
            for &m in &allowed_moves_by_last_face[node.last_face as usize] {
                let face = move_face_table[m as usize];
                let apply_m = if backward { MOVE_INVERSE[m as usize] } else { m };
                let next_state = node.state.apply_move(apply_m as usize, move_data);
                let key = state_key(&next_state);

                match map.entry(key) {
                    Entry::Occupied(_) => continue,
                    Entry::Vacant(entry) => {
                        let path: Vec<u8> = if backward {
                            // prepend m so the path reads: meeting_point → root
                            let mut p = Vec::with_capacity(node.path.len() + 1);
                            p.push(m);
                            p.extend_from_slice(&node.path);
                            p
                        } else {
                            let mut p = Vec::with_capacity(node.path.len() + 1);
                            p.extend_from_slice(&node.path);
                            p.push(m);
                            p
                        };

                        entry.insert(path.clone());
                        // last_face uses the actual applied face; inverse moves share the face.
                        next_queue.push(Node {
                            state: next_state,
                            path,
                            last_face: face,
                        });
                    }
                }
            }
        }
""",
    "BFS hot loop",
)

replace_once(
    """    cache: &mut InsertionCache,
    move_face_table: &[u8],
    move_data: &crate::minmove_core::MoveData,
) -> Option<Vec<u8>> {
""",
    """    cache: &mut InsertionCache,
    move_face_table: &[u8],
    allowed_moves_by_last_face: &InsertionAllowedMoves,
    move_data: &crate::minmove_core::MoveData,
) -> Option<Vec<u8>> {
""",
    "segment allowed-move parameter",
)

replace_once(
    """    let fwd_map = bfs_frontier(start, fwd_depth, false, move_face_table, move_data);
    let bwd_map = bfs_frontier(target, bwd_depth, true, move_face_table, move_data);
""",
    """    let fwd_map = bfs_frontier(
        start,
        fwd_depth,
        false,
        move_face_table,
        allowed_moves_by_last_face,
        move_data,
    );
    let bwd_map = bfs_frontier(
        target,
        bwd_depth,
        true,
        move_face_table,
        allowed_moves_by_last_face,
        move_data,
    );
""",
    "BFS call sites",
)

replace_once(
    """    let scramble_state = CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
    let move_face_table = &tables.move_data.move_face;

    // Per-call MITM cache to avoid recomputing identical (start, target) pairs across passes
""",
    """    let scramble_state = CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
    let move_face_table = &tables.move_data.move_face;
    let allowed_moves_by_last_face = build_allowed_moves(move_face_table);

    // Per-call MITM cache to avoid recomputing identical (start, target) pairs across passes
""",
    "build allowed moves once",
)

replace_once(
    """                &mut cache,
                move_face_table,
                &tables.move_data,
            );
""",
    """                &mut cache,
                move_face_table,
                &allowed_moves_by_last_face,
                &tables.move_data,
            );
""",
    "pass allowed moves",
)

path.write_text(text, encoding="utf-8")
