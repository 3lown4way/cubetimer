use serde_json::json;
use solver_wasm::fmc_search::{build_fmc_tables, FmcTables, MOVE_INVERSE, OPPOSITE_FACE};
use solver_wasm::minmove_core::{
    encode_co, encode_eo, encode_perm8, encode_slice_from_ep, parse_scramble, CubeState,
    LAST_FACE_FREE, SLICE_SIZE,
};
use solver_wasm::twophase_bundle::{load_bundle, TwophaseTables};
use std::collections::{HashMap, HashSet};

const MOVE_FACE_TO_JS: [usize; 6] = [0, 2, 4, 1, 3, 5];
const JS_TO_MOVE_FACE: [usize; 6] = [0, 3, 1, 4, 2, 5];
const COMPLEMENTARY_MAP_JS: [u8; 6] = [0, 1, 4, 5, 3, 2];
const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];

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
        .map(|&m| MOVE_INVERSE[m as usize])
        .collect()
}

fn invert_state(state: &CubeState) -> CubeState {
    let mut inv = CubeState::solved();
    for i in 0..8 {
        let j = state.cp[i] as usize;
        inv.cp[j] = i as u8;
        inv.co[j] = (3 - state.co[i] % 3) % 3;
    }
    for i in 0..12 {
        let j = state.ep[i] as usize;
        inv.ep[j] = i as u8;
        inv.eo[j] = state.eo[i];
    }
    inv
}

fn move_names(moves: &[u8], tables: &TwophaseTables) -> Vec<String> {
    moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].clone())
        .collect()
}

fn state_key(state: &CubeState) -> [u8; 40] {
    let mut key = [0u8; 40];
    key[..8].copy_from_slice(&state.cp);
    key[8..16].copy_from_slice(&state.co);
    key[16..28].copy_from_slice(&state.ep);
    key[28..40].copy_from_slice(&state.eo);
    key
}

fn find_eo_sequences(
    eo_start: usize,
    tables: &TwophaseTables,
    fmc: &FmcTables,
    max_depth: u8,
    limit: usize,
) -> Vec<Vec<u8>> {
    fn dfs(
        eo: usize,
        depth: u8,
        bound: u8,
        last_face: u8,
        path: &mut Vec<u8>,
        output: &mut Vec<Vec<u8>>,
        limit: usize,
        tables: &TwophaseTables,
        fmc: &FmcTables,
    ) {
        if output.len() >= limit {
            return;
        }
        let h = fmc.eo_dist[eo];
        if depth.saturating_add(h) > bound {
            return;
        }
        if eo == 0 {
            output.push(path.clone());
            return;
        }
        for &m in &tables.phase1_allowed_moves_by_last_face[last_face as usize] {
            if output.len() >= limit {
                break;
            }
            path.push(m);
            let next_eo = tables.eo_move.get(eo, m as usize) as usize;
            let face = tables.move_data.move_face[m as usize];
            dfs(
                next_eo,
                depth + 1,
                bound,
                face,
                path,
                output,
                limit,
                tables,
                fmc,
            );
            path.pop();
        }
    }

    if eo_start == 0 {
        return vec![vec![]];
    }
    let min_depth = fmc.eo_dist[eo_start];
    let mut output = Vec::new();
    let mut path = Vec::new();
    for bound in min_depth..=max_depth {
        dfs(
            eo_start,
            0,
            bound,
            LAST_FACE_FREE,
            &mut path,
            &mut output,
            limit.saturating_mul(4),
            tables,
            fmc,
        );
        if output.len() >= limit.saturating_mul(4) {
            break;
        }
    }
    output.sort_by_key(|moves| (moves.len(), moves.clone()));
    output.dedup();
    output.truncate(limit);
    output
}

fn solve_dr(
    co_start: usize,
    slice_start: usize,
    fmc: &FmcTables,
    tables: &TwophaseTables,
    max_depth: u8,
) -> Option<Vec<u8>> {
    let solved_slice = tables.solved_slice as usize;
    if co_start == 0 && slice_start == solved_slice {
        return Some(vec![]);
    }
    let key = co_start * SLICE_SIZE + slice_start;
    if fmc.co_slice_dist[key] > max_depth {
        return None;
    }
    let mut co = co_start;
    let mut slice = slice_start;
    let mut path = Vec::new();
    while co != 0 || slice != solved_slice {
        let key = co * SLICE_SIZE + slice;
        let m = fmc.co_slice_first_move[key];
        if m == 255 || path.len() >= max_depth as usize {
            return None;
        }
        path.push(m);
        co = tables.co_move.get(co, m as usize) as usize;
        slice = tables.slice_move.get(slice, m as usize) as usize;
    }
    Some(path)
}

#[derive(Clone)]
struct DrRoute {
    moves: Vec<u8>,
    setup_len: usize,
}

fn rzp_priority(state: &CubeState) -> bool {
    let bad_c = state.co.iter().filter(|&&ori| ori != 0).count() as u8;
    let bad_e_ud = (0..8).filter(|&pos| state.ep[pos] >= 8).count() as u8;
    let bad_e_slice = (8..12).filter(|&pos| state.ep[pos] < 8).count() as u8;
    matches!(
        (bad_c, bad_e_ud + bad_e_slice),
        (0, 0) | (3, 2) | (4, 2) | (4, 4) | (7, 8) | (8, 8)
    )
}

fn dr_routes(
    state_after_eo: &CubeState,
    fmc: &FmcTables,
    tables: &TwophaseTables,
    max_depth: u8,
    last_face_before_dr: u8,
) -> Vec<DrRoute> {
    let co0 = encode_co(&state_after_eo.co);
    let slice0 = encode_slice_from_ep(&state_after_eo.ep);
    let direct = solve_dr(co0, slice0, fmc, tables, max_depth);
    let direct_len = direct.as_ref().map_or(usize::MAX, Vec::len);
    let slack_limit = direct_len.saturating_add(3);
    let mut routes = Vec::new();
    let mut seen = HashSet::new();
    if let Some(moves) = direct {
        seen.insert(moves.clone());
        routes.push(DrRoute { moves, setup_len: 0 });
    }

    fn dfs(
        state: CubeState,
        setup: &mut Vec<u8>,
        routes: &mut Vec<DrRoute>,
        seen: &mut HashSet<Vec<u8>>,
        fmc: &FmcTables,
        tables: &TwophaseTables,
        max_depth: u8,
        slack_limit: usize,
        depth_left: u8,
        last_face: u8,
    ) {
        if routes.len() >= 8 {
            return;
        }
        if rzp_priority(&state) && setup.len() <= max_depth as usize {
            let remaining = max_depth.saturating_sub(setup.len() as u8);
            let co = encode_co(&state.co);
            let slice = encode_slice_from_ep(&state.ep);
            if let Some(tail) = solve_dr(co, slice, fmc, tables, remaining) {
                let mut full = setup.clone();
                full.extend_from_slice(&tail);
                if full.len() <= max_depth as usize
                    && full.len() <= slack_limit
                    && seen.insert(full.clone())
                {
                    routes.push(DrRoute {
                        moves: full,
                        setup_len: setup.len(),
                    });
                }
            }
        }
        if depth_left == 0 {
            return;
        }
        for &m in &fmc.dr_eo_allowed_by_last_face[last_face as usize] {
            let next = state.apply_move(m as usize, &tables.move_data);
            setup.push(m);
            let face = tables.move_data.move_face[m as usize];
            dfs(
                next,
                setup,
                routes,
                seen,
                fmc,
                tables,
                max_depth,
                slack_limit,
                depth_left - 1,
                face,
            );
            setup.pop();
            if routes.len() >= 8 {
                break;
            }
        }
    }

    dfs(
        *state_after_eo,
        &mut Vec::new(),
        &mut routes,
        &mut seen,
        fmc,
        tables,
        max_depth,
        slack_limit,
        2,
        last_face_before_dr,
    );
    routes.sort_by_key(|route| (route.moves.len(), route.setup_len, route.moves.clone()));
    routes.truncate(8);
    routes
}

fn encode_perm4(perm: &[u8; 4]) -> usize {
    let mut index = 0usize;
    for i in 0..4 {
        let mut smaller = 0usize;
        for j in (i + 1)..4 {
            if perm[j] < perm[i] {
                smaller += 1;
            }
        }
        index += smaller * FACTORIAL_4[3 - i];
    }
    index
}

fn p2_indices(state: &CubeState) -> Option<(usize, usize, usize)> {
    if (0..8).any(|i| state.ep[i] >= 8) || (8..12).any(|i| state.ep[i] < 8) {
        return None;
    }
    let cp = encode_perm8(&state.cp);
    let ep8 = [
        state.ep[0], state.ep[1], state.ep[2], state.ep[3],
        state.ep[4], state.ep[5], state.ep[6], state.ep[7],
    ];
    let ep = encode_perm8(&ep8);
    let sep4 = [
        state.ep[8] - 8,
        state.ep[9] - 8,
        state.ep[10] - 8,
        state.ep[11] - 8,
    ];
    Some((cp, ep, encode_perm4(&sep4)))
}

fn last_face(moves: &[u8], tables: &TwophaseTables) -> u8 {
    moves
        .last()
        .map(|&m| tables.move_data.move_face[m as usize])
        .unwrap_or(LAST_FACE_FREE)
}

fn main() {
    let bytes = std::fs::read("public/solver-wasm/twophase/twophase-333-v1.bin")
        .expect("read twophase bundle");
    let tables = load_bundle(&bytes).expect("load twophase bundle");
    let fmc = build_fmc_tables(&tables);

    let scramble = "R' U' F D2 L2 F R2 U2 R2 B D2 L B2 D' B2 L' R' B D2 B U2 L U2 R' U' F";
    let inverse_eo = "U D' F R";
    let continuation_text = "D2 F' D2 U2 F' L2 D R2 D B2 F L2";

    let scramble_moves = parse_scramble(scramble, &tables.move_data).unwrap();
    let inverse_scramble = invert_moves(&scramble_moves);
    let boundary = map_moves(&parse_scramble(inverse_eo, &tables.move_data).unwrap());
    let continuation = map_moves(&parse_scramble(continuation_text, &tables.move_data).unwrap());
    let inverse_state = CubeState::solved()
        .apply_moves(&map_moves(&inverse_scramble), &tables.move_data);
    let boundary_state = inverse_state.apply_moves(&boundary, &tables.move_data);
    let switched = invert_state(&boundary_state);
    let exact_solved = switched
        .apply_moves(&continuation, &tables.move_data)
        .is_solved();

    let mut prefixes = Vec::new();
    let mut first_eo = None;
    let mut first_dr = None;
    for split in 0..=continuation.len() {
        let state = switched.apply_moves(&continuation[..split], &tables.move_data);
        let eo = encode_eo(&state.eo);
        let co = encode_co(&state.co);
        let slice = encode_slice_from_ep(&state.ep);
        let p2 = p2_indices(&state);
        let lower = p2.map(|(cp, ep, sep)| {
            tables
                .phase2_cp_sep_joint
                .get(cp * FACTORIAL_4[4] + sep)
                .max(tables.phase2_ep.get(ep))
        });
        if eo == 0 && first_eo.is_none() {
            first_eo = Some(split);
        }
        if eo == 0 && co == 0 && slice == tables.solved_slice as usize && first_dr.is_none() {
            first_dr = Some(split);
        }
        prefixes.push(json!({
            "split": split,
            "prefix": move_names(&continuation[..split], &tables),
            "eo": eo,
            "co": co,
            "slice": slice,
            "drDistance": if eo == 0 { Some(fmc.co_slice_dist[co * SLICE_SIZE + slice]) } else { None },
            "p2Ready": p2.is_some(),
            "p2LowerBound": lower,
            "solved": state.is_solved(),
        }));
    }

    let eo_pool = find_eo_sequences(encode_eo(&switched.eo), &tables, &fmc, 7, 512);
    let eo_split = first_eo.expect("known continuation must reach EO");
    let dr_split = first_dr.expect("known continuation must reach DR");
    let known_eo = continuation[..eo_split].to_vec();
    let known_eo_state = switched.apply_moves(&known_eo, &tables.move_data);
    let known_eo_key = state_key(&known_eo_state);
    let eo_exact_rank = eo_pool.iter().position(|moves| moves == &known_eo);
    let eo_state_rank = eo_pool.iter().position(|moves| {
        state_key(&switched.apply_moves(moves, &tables.move_data)) == known_eo_key
    });

    let known_dr = continuation[eo_split..dr_split].to_vec();
    let known_dr_state = known_eo_state.apply_moves(&known_dr, &tables.move_data);
    let known_dr_key = state_key(&known_dr_state);
    let routes = dr_routes(
        &known_eo_state,
        &fmc,
        &tables,
        14,
        last_face(&known_eo, &tables),
    );
    let dr_exact_rank = routes.iter().position(|route| route.moves == known_dr);
    let dr_state_rank = routes.iter().position(|route| {
        state_key(&known_eo_state.apply_moves(&route.moves, &tables.move_data)) == known_dr_key
    });
    let route_rows: Vec<_> = routes
        .iter()
        .enumerate()
        .map(|(rank, route)| {
            let endpoint = known_eo_state.apply_moves(&route.moves, &tables.move_data);
            let lower = p2_indices(&endpoint).map(|(cp, ep, sep)| {
                tables
                    .phase2_cp_sep_joint
                    .get(cp * FACTORIAL_4[4] + sep)
                    .max(tables.phase2_ep.get(ep))
            });
            json!({
                "rank": rank,
                "moves": move_names(&route.moves, &tables),
                "length": route.moves.len(),
                "setupLength": route.setup_len,
                "p2LowerBound": lower,
            })
        })
        .collect();

    let known_p2 = continuation[dr_split..].to_vec();
    let p2_lower = p2_indices(&known_dr_state).map(|(cp, ep, sep)| {
        tables
            .phase2_cp_sep_joint
            .get(cp * FACTORIAL_4[4] + sep)
            .max(tables.phase2_ep.get(ep))
    });
    let known_p2_solves = known_dr_state
        .apply_moves(&known_p2, &tables.move_data)
        .is_solved();

    println!(
        "WR16_CONTINUATION_DIAGNOSTIC {}",
        json!({
            "boundaryFrame": move_names(&boundary, &tables),
            "continuationFrame": move_names(&continuation, &tables),
            "boundaryEoAfter": encode_eo(&boundary_state.eo),
            "switchedInitialEo": encode_eo(&switched.eo),
            "exactContinuationSolvesSwitchedState": exact_solved,
            "firstEoSplit": first_eo,
            "firstDrSplit": first_dr,
            "prefixes": prefixes,
            "eoGeneration": {
                "poolCount": eo_pool.len(),
                "known": move_names(&known_eo, &tables),
                "knownLength": known_eo.len(),
                "exactRank": eo_exact_rank,
                "stateRank": eo_state_rank,
                "firstCandidates": eo_pool.iter().take(12).map(|m| move_names(m, &tables)).collect::<Vec<_>>(),
            },
            "drGeneration": {
                "known": move_names(&known_dr, &tables),
                "knownLength": known_dr.len(),
                "routeCount": routes.len(),
                "exactRank": dr_exact_rank,
                "stateRank": dr_state_rank,
                "routes": route_rows,
            },
            "p2": {
                "known": move_names(&known_p2, &tables),
                "knownLength": known_p2.len(),
                "lowerBound": p2_lower,
                "knownSolves": known_p2_solves,
            }
        })
    );
}
