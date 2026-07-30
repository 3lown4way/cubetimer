from pathlib import Path

path = Path("solver-wasm/src/fmc_insertion.rs")
text = path.read_text(encoding="utf-8")

old_frontier = '''fn bfs_frontier(
    root: &CubeState,
    depth: u8,
    backward: bool,
    move_face_table: &[u8],
    move_data: &crate::minmove_core::MoveData,
) -> HashMap<StateKey, Vec<u8>> {
    let mut map: HashMap<StateKey, Vec<u8>> = HashMap::with_capacity(1 << (depth * 4).min(20));
    map.insert(state_key(root), vec![]);
    if depth == 0 {
        return map;
    }

    struct Node {
        state: CubeState,
        path: Vec<u8>,
        last_face: u8,
    }

    let mut queue = vec![Node {
        state: *root,
        path: vec![],
        last_face: LAST_FACE_FREE,
    }];

    for _ in 0..depth {
        let mut next_queue = Vec::with_capacity(queue.len() * 10);
        for node in &queue {
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

                let apply_m = if backward {
                    MOVE_INVERSE[m as usize]
                } else {
                    m
                };
                let next_state = node.state.apply_move(apply_m as usize, move_data);
                let key = state_key(&next_state);
                let Entry::Vacant(entry) = map.entry(key) else {
                    continue;
                };

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

                entry.insert(path.clone());
                // next_queue last_face uses the actual applied face for pruning
                let next_last_face = face; // face of m == face of MOVE_INVERSE[m]
                next_queue.push(Node {
                    state: next_state,
                    path,
                    last_face: next_last_face,
                });
            }
        }
        queue = next_queue;
    }

    map
}
'''

new_frontier = '''#[derive(Clone, Copy)]
struct FrontierNode {
    state: CubeState,
    parent: u32,
    via_move: u8,
    depth: u8,
    last_face: u8,
}

struct BfsFrontier {
    by_state: HashMap<StateKey, u32>,
    nodes: Vec<FrontierNode>,
    backward: bool,
}

impl BfsFrontier {
    #[inline(always)]
    fn path_len(&self, node_index: u32) -> usize {
        self.nodes[node_index as usize].depth as usize
    }

    fn reconstruct_path(&self, node_index: u32) -> Vec<u8> {
        let mut path = Vec::with_capacity(self.path_len(node_index));
        let mut cursor = node_index;
        while cursor != 0 {
            let node = self.nodes[cursor as usize];
            path.push(node.via_move);
            cursor = node.parent;
        }
        if !self.backward {
            path.reverse();
        }
        path
    }
}

fn bfs_frontier(
    root: &CubeState,
    depth: u8,
    backward: bool,
    move_face_table: &[u8],
    move_data: &crate::minmove_core::MoveData,
) -> BfsFrontier {
    let mut by_state: HashMap<StateKey, u32> =
        HashMap::with_capacity(1 << (depth * 4).min(20));
    let mut nodes = Vec::with_capacity(1 << (depth * 4).min(20));
    nodes.push(FrontierNode {
        state: *root,
        parent: 0,
        via_move: 0,
        depth: 0,
        last_face: LAST_FACE_FREE,
    });
    by_state.insert(state_key(root), 0);

    let mut queue = vec![0u32];
    for _ in 0..depth {
        let mut next_queue = Vec::with_capacity(queue.len() * 10);
        for &node_index in &queue {
            let node = nodes[node_index as usize];
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

                let apply_m = if backward {
                    MOVE_INVERSE[m as usize]
                } else {
                    m
                };
                let next_state = node.state.apply_move(apply_m as usize, move_data);
                let key = state_key(&next_state);
                let Entry::Vacant(entry) = by_state.entry(key) else {
                    continue;
                };

                let next_index = nodes.len() as u32;
                entry.insert(next_index);
                nodes.push(FrontierNode {
                    state: next_state,
                    parent: node_index,
                    via_move: m,
                    depth: node.depth + 1,
                    // face of m == face of MOVE_INVERSE[m]
                    last_face: face,
                });
                next_queue.push(next_index);
            }
        }
        queue = next_queue;
    }

    BfsFrontier {
        by_state,
        nodes,
        backward,
    }
}
'''

old_intersection = '''    let fwd_map = bfs_frontier(start, fwd_depth, false, move_face_table, move_data);
    let bwd_map = bfs_frontier(target, bwd_depth, true, move_face_table, move_data);

    let mut best: Option<Vec<u8>> = None;
    for (key, left) in &fwd_map {
        if let Some(right) = bwd_map.get(key) {
            let total_len = left.len() + right.len();
            if total_len < current_len {
                if best.is_none() || total_len < best.as_ref().unwrap().len() {
                    let mut combined = left.clone();
                    combined.extend_from_slice(right);
                    best = Some(combined);
                }
            }
        }
    }
'''

new_intersection = '''    let fwd_frontier = bfs_frontier(start, fwd_depth, false, move_face_table, move_data);
    let bwd_frontier = bfs_frontier(target, bwd_depth, true, move_face_table, move_data);

    let mut best: Option<Vec<u8>> = None;
    for (key, &left_index) in &fwd_frontier.by_state {
        if let Some(&right_index) = bwd_frontier.by_state.get(key) {
            let total_len =
                fwd_frontier.path_len(left_index) + bwd_frontier.path_len(right_index);
            if total_len < current_len {
                if best.is_none() || total_len < best.as_ref().unwrap().len() {
                    let mut combined = fwd_frontier.reconstruct_path(left_index);
                    combined.extend_from_slice(&bwd_frontier.reconstruct_path(right_index));
                    best = Some(combined);
                }
            }
        }
    }
'''

for old, new, label in [
    (old_frontier, new_frontier, "frontier implementation"),
    (old_intersection, new_intersection, "intersection logic"),
]:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one {label} match, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
