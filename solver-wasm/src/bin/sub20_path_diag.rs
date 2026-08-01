use serde_json::json;
use solver_wasm::fmc_search::{build_fmc_tables, FmcTables, MOVE_INVERSE};
use solver_wasm::minmove_core::{
    encode_co, encode_eo, encode_perm8, encode_slice_from_ep, parse_scramble, CubeState,
    LAST_FACE_FREE, SLICE_SIZE,
};
use solver_wasm::twophase_bundle::{load_bundle, TwophaseTables};

const MOVE_FACE_TO_JS: [usize; 6] = [0, 2, 4, 1, 3, 5];
const JS_TO_MOVE_FACE: [usize; 6] = [0, 3, 1, 4, 2, 5];
const AXIS_MAPS: [[u8; 6]; 6] = [
    [0, 1, 2, 3, 4, 5],
    [4, 5, 2, 3, 1, 0],
    [3, 2, 0, 1, 4, 5],
    [0, 1, 4, 5, 3, 2],
    [2, 3, 4, 5, 0, 1],
    [4, 5, 1, 0, 3, 2],
];
const AXIS_NAMES: [&str; 6] = ["UD/FB", "FB/UD", "RL/FB", "UD/RL", "FB/RL", "RL/UD"];
const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];

fn map_move(move_index: u8, map: &[u8; 6]) -> u8 {
    let face = (move_index / 3) as usize;
    let suffix = move_index % 3;
    let js_face = MOVE_FACE_TO_JS[face];
    let mapped_js_face = map[js_face] as usize;
    let mapped_face = JS_TO_MOVE_FACE[mapped_js_face] as u8;
    mapped_face * 3 + suffix
}

fn map_moves(moves: &[u8], map: &[u8; 6]) -> Vec<u8> {
    moves.iter().map(|&m| map_move(m, map)).collect()
}

fn invert_moves(moves: &[u8]) -> Vec<u8> {
    moves.iter().rev().map(|&m| MOVE_INVERSE[m as usize]).collect()
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
    moves.iter().map(|&m| tables.move_data.move_names[m as usize].clone()).collect()
}

fn encode_perm4(perm: &[u8; 4]) -> usize {
    let mut index = 0usize;
    for i in 0..4 {
        let mut smaller = 0usize;
        for j in (i + 1)..4 {
            if perm[j] < perm[i] { smaller += 1; }
        }
        index += smaller * FACTORIAL_4[3 - i];
    }
    index
}

fn p2_lower_bound(state: &CubeState, tables: &TwophaseTables) -> Option<u8> {
    if (0..8).any(|i| state.ep[i] >= 8) || (8..12).any(|i| state.ep[i] < 8) {
        return None;
    }
    let ep8 = [state.ep[0], state.ep[1], state.ep[2], state.ep[3], state.ep[4], state.ep[5], state.ep[6], state.ep[7]];
    let sep4 = [state.ep[8] - 8, state.ep[9] - 8, state.ep[10] - 8, state.ep[11] - 8];
    let cp = encode_perm8(&state.cp);
    let ep = encode_perm8(&ep8);
    let sep = encode_perm4(&sep4);
    Some(tables.phase2_cp_sep_joint.get(cp * FACTORIAL_4[4] + sep).max(tables.phase2_ep.get(ep)))
}

fn solve_dr(co_start: usize, slice_start: usize, fmc: &FmcTables, tables: &TwophaseTables, max_depth: usize) -> Option<Vec<u8>> {
    let solved_slice = tables.solved_slice as usize;
    let mut co = co_start;
    let mut slice = slice_start;
    let mut path = Vec::new();
    while co != 0 || slice != solved_slice {
        if path.len() >= max_depth { return None; }
        let key = co * SLICE_SIZE + slice;
        let m = fmc.co_slice_first_move[key];
        if m == 255 { return None; }
        path.push(m);
        co = tables.co_move.get(co, m as usize) as usize;
        slice = tables.slice_move.get(slice, m as usize) as usize;
    }
    Some(path)
}

fn prefix_rows(start: CubeState, moves: &[u8], fmc: &FmcTables, tables: &TwophaseTables) -> Vec<serde_json::Value> {
    let mut rows = Vec::new();
    for split in 0..=moves.len() {
        let state = start.apply_moves(&moves[..split], &tables.move_data);
        let eo = encode_eo(&state.eo);
        let co = encode_co(&state.co);
        let slice = encode_slice_from_ep(&state.ep);
        if eo == 0 || (co == 0 && slice == tables.solved_slice as usize) || state.is_solved() {
            let canonical = if eo == 0 { solve_dr(co, slice, fmc, tables, 20) } else { None };
            rows.push(json!({
                "split": split,
                "prefix": move_names(&moves[..split], tables),
                "eo": eo,
                "co": co,
                "slice": slice,
                "drDistance": if eo == 0 { Some(fmc.co_slice_dist[co * SLICE_SIZE + slice]) } else { None },
                "canonicalDr": canonical.as_ref().map(|m| move_names(m, tables)),
                "p2Lower": p2_lower_bound(&state, tables),
                "solved": state.is_solved(),
            }));
        }
    }
    rows
}

fn last_face(moves: &[u8], tables: &TwophaseTables) -> u8 {
    moves.last().map(|&m| tables.move_data.move_face[m as usize]).unwrap_or(LAST_FACE_FREE)
}

fn main() {
    let bytes = std::fs::read("public/solver-wasm/twophase/twophase-333-v1.bin").expect("bundle");
    let tables = load_bundle(&bytes).expect("load bundle");
    let fmc = build_fmc_tables(&tables);

    let wong_scramble = parse_scramble("R' U' F U2 F' U' F2 U' F2 R2 U' L2 U F2 U' R F' R' F2 R F' L F R' U' F", &tables.move_data).unwrap();
    let wong_solution = parse_scramble("L' F2 R' U2 F U' B U' B' R2 F2 L2 R2 D2 B2 D' F2 D'", &tables.move_data).unwrap();

    let brian_scramble = parse_scramble("R' U' F D2 F D' R2 B2 L2 B2 U' L2 B2 R2 F2 L R' B U L R' U2 R' U' F", &tables.move_data).unwrap();
    let brian_inverse_prefix = parse_scramble("F R' D'", &tables.move_data).unwrap();
    let brian_normal_continuation = parse_scramble("F' U' B D2 R B2 R L' U' D2 R F2 D2 F2", &tables.move_data).unwrap();

    let mut wong = Vec::new();
    let mut brian = Vec::new();
    for (axis, map) in AXIS_MAPS.iter().enumerate() {
        let ws = map_moves(&wong_scramble, map);
        let wsol = map_moves(&wong_solution, map);
        let wstate = CubeState::solved().apply_moves(&ws, &tables.move_data);
        wong.push(json!({
            "axis": AXIS_NAMES[axis],
            "complementary": axis >= 3,
            "rows": prefix_rows(wstate, &wsol, &fmc, &tables),
        }));

        let inv_scramble = map_moves(&invert_moves(&brian_scramble), map);
        let inv_prefix = map_moves(&brian_inverse_prefix, map);
        let normal = map_moves(&brian_normal_continuation, map);
        let inverse_state = CubeState::solved().apply_moves(&inv_scramble, &tables.move_data);
        let switched = invert_state(&inverse_state.apply_moves(&inv_prefix, &tables.move_data));
        brian.push(json!({
            "axis": AXIS_NAMES[axis],
            "complementary": axis >= 3,
            "inversePrefix": move_names(&inv_prefix, &tables),
            "inversePrefixLastFace": last_face(&inv_prefix, &tables),
            "switchEo": encode_eo(&switched.eo),
            "rows": prefix_rows(switched, &normal, &fmc, &tables),
        }));
    }

    println!("SUB20_PATH_DIAGNOSTIC {}", json!({"wong18": wong, "brian17": brian}));
}
