use serde_json::json;
use solver_wasm::fmc_search::{build_fmc_tables, FmcTables, MOVE_INVERSE};
use solver_wasm::minmove_core::{
    encode_co, encode_eo, encode_slice_from_ep, parse_scramble, CubeState, LAST_FACE_FREE,
    SLICE_SIZE,
};
use solver_wasm::twophase_bundle::{load_bundle, TwophaseTables};
use std::collections::HashMap;

const MOVE_FACE_TO_JS: [usize; 6] = [0, 2, 4, 1, 3, 5];
const JS_TO_MOVE_FACE: [usize; 6] = [0, 3, 1, 4, 2, 5];
const COMPLEMENTARY_MAP_JS: [u8; 6] = [0, 1, 4, 5, 3, 2];
const DR_MOVES: [u8; 14] = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 17];
const REVERSE_DR_DEPTH: usize = 5;
const FORWARD_DEPTH: usize = 6;
const FORWARD_NODE_LIMIT: usize = 8_000_000;

type StateKey = [u8; 40];

#[derive(Clone, Copy, Debug)]
struct Tail {
    dr: [u8; REVERSE_DR_DEPTH],
    dr_len: u8,
    p2_move: u8,
}

impl Tail {
    fn solved() -> Self {
        Self {
            dr: [255; REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: 255,
        }
    }

    fn total_len(&self) -> usize {
        self.dr_len as usize + usize::from(self.p2_move != 255)
    }

    fn dr_moves(&self) -> Vec<u8> {
        self.dr[..self.dr_len as usize].to_vec()
    }

    fn p2_moves(&self) -> Vec<u8> {
        if self.p2_move == 255 {
            Vec::new()
        } else {
            vec![self.p2_move]
        }
    }

    fn prepend_dr(&self, move_index: u8) -> Option<Self> {
        if self.dr_len as usize >= REVERSE_DR_DEPTH {
            return None;
        }
        let mut dr = [255; REVERSE_DR_DEPTH];
        dr[0] = move_index;
        let old_len = self.dr_len as usize;
        dr[1..=old_len].copy_from_slice(&self.dr[..old_len]);
        Some(Self {
            dr,
            dr_len: self.dr_len + 1,
            p2_move: self.p2_move,
        })
    }
}

#[derive(Clone)]
struct ForwardNode {
    state: CubeState,
    path: [u8; FORWARD_DEPTH],
    len: u8,
    last_face: u8,
}

fn state_key(state: &CubeState) -> StateKey {
    let mut key = [0u8; 40];
    key[..8].copy_from_slice(&state.cp);
    key[8..16].copy_from_slice(&state.co);
    key[16..28].copy_from_slice(&state.ep);
    key[28..40].copy_from_slice(&state.eo);
    key
}

fn map_move(move_index: u8) -> u8 {
    let face = (move_index / 3) as usize;
    let suffix = move_index % 3;
    let js_face = MOVE_FACE_TO_JS[face];
    let mapped_js_face = COMPLEMENTARY_MAP_JS[js_face] as usize;
    let mapped_face = JS_TO_MOVE_FACE[mapped_js_face] as u8;
    mapped_face * 3 + suffix
}

fn map_moves(moves: &[u8]) -> Vec<u8> {
    moves.iter().copied().map(map_move).collect()
}

fn invert_moves(moves: &[u8]) -> Vec<u8> {
    moves
        .iter()
        .rev()
        .map(|&move_index| MOVE_INVERSE[move_index as usize])
        .collect()
}

fn invert_state(state: &CubeState) -> CubeState {
    let mut inverse = CubeState::solved();
    for position in 0..8 {
        let piece = state.cp[position] as usize;
        inverse.cp[piece] = position as u8;
        inverse.co[piece] = (3 - state.co[position] % 3) % 3;
    }
    for position in 0..12 {
        let piece = state.ep[position] as usize;
        inverse.ep[piece] = position as u8;
        inverse.eo[piece] = state.eo[position];
    }
    inverse
}

fn move_names(moves: &[u8], tables: &TwophaseTables) -> Vec<String> {
    moves
        .iter()
        .map(|&move_index| tables.move_data.move_names[move_index as usize].clone())
        .collect()
}

fn tail_order(tail: &Tail) -> (usize, Vec<u8>, u8) {
    (tail.total_len(), tail.dr_moves(), tail.p2_move)
}

fn retain_tail(map: &mut HashMap<StateKey, Tail>, state: &CubeState, candidate: Tail) -> bool {
    let key = state_key(state);
    match map.get(&key) {
        None => {
            map.insert(key, candidate);
            true
        }
        Some(current) if tail_order(&candidate) < tail_order(current) => {
            map.insert(key, candidate);
            true
        }
        _ => false,
    }
}

fn build_reverse_tails(tables: &TwophaseTables) -> (HashMap<StateKey, Tail>, Vec<usize>) {
    let solved = CubeState::solved();
    let mut tails = HashMap::<StateKey, Tail>::new();
    let solved_tail = Tail::solved();
    retain_tail(&mut tails, &solved, solved_tail);

    let mut frontier = vec![(solved, solved_tail)];
    for &global_move in &tables.phase2_move_indices {
        let state = solved.apply_move(global_move as usize, &tables.move_data);
        let tail = Tail {
            dr: [255; REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: MOVE_INVERSE[global_move as usize],
        };
        if retain_tail(&mut tails, &state, tail) {
            frontier.push((state, tail));
        }
    }

    let mut layer_sizes = vec![frontier.len()];
    for _ in 0..REVERSE_DR_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in frontier {
            for &move_index in &DR_MOVES {
                let predecessor = state.apply_move(move_index as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_dr(MOVE_INVERSE[move_index as usize]) else {
                    continue;
                };
                if retain_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        layer_sizes.push(next.len());
        frontier = next;
    }
    (tails, layer_sizes)
}

fn solve_with_tail(
    current: &CubeState,
    forward: &[u8],
    tail: &Tail,
    tables: &TwophaseTables,
) -> Option<(Vec<u8>, Vec<u8>)> {
    let tail_dr = tail.dr_moves();
    let p2 = tail.p2_moves();
    let end = current
        .apply_moves(&tail_dr, &tables.move_data)
        .apply_moves(&p2, &tables.move_data);
    if !end.is_solved() {
        return None;
    }
    let mut dr = forward.to_vec();
    dr.extend_from_slice(&tail_dr);
    Some((dr, p2))
}

fn forward_meet(
    start: CubeState,
    tails: &HashMap<StateKey, Tail>,
    fmc: &FmcTables,
    tables: &TwophaseTables,
) -> (Option<(Vec<u8>, Vec<u8>)>, usize, Vec<usize>) {
    let mut frontier = vec![ForwardNode {
        state: start,
        path: [255; FORWARD_DEPTH],
        len: 0,
        last_face: LAST_FACE_FREE,
    }];
    let mut seen = HashMap::<(StateKey, u8), u8>::new();
    seen.insert((state_key(&start), LAST_FACE_FREE), 0);
    let mut nodes = 1usize;
    let mut layer_sizes = Vec::new();

    for depth in 0..=FORWARD_DEPTH {
        layer_sizes.push(frontier.len());
        for node in &frontier {
            if let Some(tail) = tails.get(&state_key(&node.state)) {
                let forward = &node.path[..node.len as usize];
                if let Some(solution) = solve_with_tail(&node.state, forward, tail, tables) {
                    return (Some(solution), nodes, layer_sizes);
                }
            }
        }
        if depth == FORWARD_DEPTH {
            break;
        }

        let mut next_frontier = Vec::new();
        for node in frontier {
            let co = encode_co(&node.state.co);
            let slice = encode_slice_from_ep(&node.state.ep);
            let dr_distance = fmc.co_slice_dist[co * SLICE_SIZE + slice] as usize;
            let forward_left = FORWARD_DEPTH - depth;
            if dr_distance == 255 || dr_distance > forward_left + REVERSE_DR_DEPTH {
                continue;
            }

            let mut children = Vec::new();
            for &move_index in &fmc.dr_eo_allowed_by_last_face[node.last_face as usize] {
                let state = node
                    .state
                    .apply_move(move_index as usize, &tables.move_data);
                let key = state_key(&state);
                let co = encode_co(&state.co);
                let slice = encode_slice_from_ep(&state.ep);
                let distance = fmc.co_slice_dist[co * SLICE_SIZE + slice];
                let meet = tails.contains_key(&key);
                children.push((!meet, distance, move_index, state, key));
            }
            children.sort_by_key(|(not_meet, distance, move_index, _, _)| {
                (*not_meet, *distance, *move_index)
            });

            for (_, _, move_index, state, key) in children {
                let face = tables.move_data.move_face[move_index as usize];
                let new_depth = (depth + 1) as u8;
                let seen_key = (key, face);
                if seen
                    .get(&seen_key)
                    .is_some_and(|&previous_depth| previous_depth <= new_depth)
                {
                    continue;
                }
                seen.insert(seen_key, new_depth);
                let mut path = node.path;
                path[depth] = move_index;
                next_frontier.push(ForwardNode {
                    state,
                    path,
                    len: new_depth,
                    last_face: face,
                });
                nodes += 1;
                if nodes >= FORWARD_NODE_LIMIT {
                    return (None, nodes, layer_sizes);
                }
            }
        }
        frontier = next_frontier;
    }
    (None, nodes, layer_sizes)
}

fn main() {
    let bytes = std::fs::read("public/solver-wasm/twophase/twophase-333-v1.bin")
        .expect("read twophase bundle");
    let tables = load_bundle(&bytes).expect("load twophase bundle");
    let fmc = build_fmc_tables(&tables);

    let scramble = "R' U' F D2 L2 F R2 U2 R2 B D2 L B2 D' B2 L' R' B D2 B U2 L U2 R' U' F";
    let inverse_eo = "U D' F R";
    let known_continuation = "D2 F' D2 U2 F' L2 D R2 D B2 F L2";

    let scramble_moves = parse_scramble(scramble, &tables.move_data).expect("parse scramble");
    let inverse_scramble = invert_moves(&scramble_moves);
    let inverse_state = CubeState::solved()
        .apply_moves(&map_moves(&inverse_scramble), &tables.move_data);
    let boundary = map_moves(
        &parse_scramble(inverse_eo, &tables.move_data).expect("parse inverse EO"),
    );
    let switched = invert_state(&inverse_state.apply_moves(&boundary, &tables.move_data));
    assert_eq!(encode_eo(&switched.eo), 0, "switched state must preserve EO");

    let known = map_moves(
        &parse_scramble(known_continuation, &tables.move_data)
            .expect("parse known continuation"),
    );
    assert!(
        switched.apply_moves(&known, &tables.move_data).is_solved(),
        "known continuation must solve switched state"
    );

    let (tails, reverse_layers) = build_reverse_tails(&tables);
    let known_meet_state = switched.apply_moves(&known[..FORWARD_DEPTH], &tables.move_data);
    let known_tail = tails.get(&state_key(&known_meet_state));
    let known_tail_json = known_tail.map(|tail| {
        json!({
            "dr": move_names(&tail.dr_moves(), &tables),
            "p2": move_names(&tail.p2_moves(), &tables),
            "total": tail.total_len(),
        })
    });

    let (found, forward_nodes, forward_layers) = forward_meet(switched, &tails, &fmc, &tables);
    let output = found.as_ref().map(|(dr, p2)| {
        let mut full = dr.clone();
        full.extend_from_slice(p2);
        json!({
            "dr": move_names(dr, &tables),
            "p2": move_names(p2, &tables),
            "continuation": move_names(&full, &tables),
            "continuationLength": full.len(),
            "solved": switched.apply_moves(&full, &tables.move_data).is_solved(),
        })
    });

    println!(
        "WR16_MITM_DIAGNOSTIC {}",
        json!({
            "reverseStateCount": tails.len(),
            "reverseLayers": reverse_layers,
            "knownMeetCovered": known_tail.is_some(),
            "knownMeetTail": known_tail_json,
            "forwardNodes": forward_nodes,
            "forwardLayers": forward_layers,
            "found": output,
        })
    );

    assert!(known_tail.is_some(), "reverse frontier missed known tail");
    assert!(found.is_some(), "meet-in-the-middle search missed WR16 continuation");
}
