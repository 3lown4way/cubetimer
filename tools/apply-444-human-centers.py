from pathlib import Path
import re

p = Path('solver444-wasm/src/centers.rs')
s = p.read_text()

s = s.replace(
'''const PHASE1_STATE_COUNT: usize = 735_471; // C(24, 8)\nconst PHASE2_STATE_COUNT: usize = 70; // C(8, 4)\nconst PHASE3_STATE_COUNT: usize = 12_870; // C(16, 8)\nconst PHASE4_STATE_COUNT: usize = 4_900; // C(8, 4)^2\n''',
'''const PHASE1_STATE_COUNT: usize = 10_626; // C(24, 4): first (cross-color) center\nconst PHASE2_STATE_COUNT: usize = 4_845; // C(20, 4): opposite center while first is locked\nconst PHASE3_STATE_COUNT: usize = 12_870; // C(16, 8)\nconst PAIR_FACE_STATE_COUNT: usize = 70; // C(8, 4)\nconst PHASE4_STATE_COUNT: usize = 4_900; // C(8, 4)^2\n''')
s = s.replace('const L: u8 = 4;\n', 'const L: u8 = 4;\nconst B: u8 = 5;\n')

old_positions = '''const UD_POSITIONS: [u8; 8] = [0, 1, 2, 3, 12, 13, 14, 15];\nconst SIDE_POSITIONS: [u8; 16] = [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23];\nconst RL_POSITIONS: [u8; 8] = [4, 5, 6, 7, 16, 17, 18, 19];\nconst FB_POSITIONS: [u8; 8] = [8, 9, 10, 11, 20, 21, 22, 23];\n\nconst GOAL_UD_GROUP: u32 = bits(&UD_POSITIONS);\nconst GOAL_U: u32 = bits(&[0, 1, 2, 3]);\nconst GOAL_RL_GROUP: u32 = bits(&RL_POSITIONS);\nconst GOAL_R: u32 = bits(&[4, 5, 6, 7]);\nconst GOAL_F: u32 = bits(&[8, 9, 10, 11]);\n'''
new_positions = '''// Logical [U,R,F,D,L,B] -> physical face. The row is selected by the\n// requested physical cross color; logical D is always mapped to that color.\nconst CENTER_FRAME_MAPS: [[u8; 6]; 6] = [\n    [D, R, B, U, L, F], // U cross: x2\n    [L, U, F, R, D, B], // R cross: z\n    [B, R, U, F, L, D], // F cross: x'\n    [U, R, F, D, L, B], // D cross: identity\n    [R, D, F, L, U, B], // L cross: z'\n    [F, R, D, B, L, U], // B cross: x\n];\n'''
if old_positions not in s:
    raise SystemExit('center position block not found')
s = s.replace(old_positions, new_positions)

bits_end = '''const fn bits(positions: &[u8]) -> u32 {\n    let mut mask = 0u32;\n    let mut index = 0usize;\n    while index < positions.len() {\n        mask |= 1u32 << positions[index];\n        index += 1;\n    }\n    mask\n}\n'''
frame_code = r'''

#[derive(Clone, Debug)]
struct CenterFrame {
    cross_color: u8,
    opposite_color: u8,
    side_a_color: u8,
    side_a_opposite_color: u8,
    side_b_color: u8,
    cross_positions: [u8; 4],
    non_cross_positions: [u8; 20],
    side_positions: [u8; 16],
    side_a_pair_positions: [u8; 8],
    side_b_pair_positions: [u8; 8],
    goal_cross: u32,
    goal_opposite: u32,
    goal_side_a_pair: u32,
    goal_side_a: u32,
    goal_side_b: u32,
}

fn face_positions(face: u8) -> [u8; 4] {
    let base = face * 4;
    [base, base + 1, base + 2, base + 3]
}

fn pair_positions(first: u8, second: u8) -> [u8; 8] {
    let a = face_positions(first);
    let b = face_positions(second);
    [a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]]
}

fn positions_excluding(excluded: &[u8]) -> Vec<u8> {
    ALL_CENTER_POSITIONS
        .iter()
        .copied()
        .filter(|position| !excluded.contains(&(position / 4)))
        .collect()
}

impl CenterFrame {
    fn for_cross(cross_color: u8) -> Result<Self, CenterSolveError> {
        if cross_color >= 6 {
            return Err(CenterSolveError::CoordinateNotReachable("cross-color"));
        }
        let map = CENTER_FRAME_MAPS[cross_color as usize];
        debug_assert_eq!(map[D as usize], cross_color);
        let cross_color = map[D as usize];
        let opposite_color = map[U as usize];
        let side_a_color = map[R as usize];
        let side_a_opposite_color = map[L as usize];
        let side_b_color = map[F as usize];
        let side_b_opposite_color = map[B as usize];
        let cross_positions = face_positions(cross_color);
        let opposite_positions = face_positions(opposite_color);
        let non_cross_positions: [u8; 20] = positions_excluding(&[cross_color])
            .try_into()
            .map_err(|_| CenterSolveError::CoordinateNotReachable("cross-frame"))?;
        let side_positions: [u8; 16] = positions_excluding(&[cross_color, opposite_color])
            .try_into()
            .map_err(|_| CenterSolveError::CoordinateNotReachable("side-frame"))?;
        let side_a_pair_positions = pair_positions(side_a_color, side_a_opposite_color);
        let side_b_pair_positions = pair_positions(side_b_color, side_b_opposite_color);
        Ok(Self {
            cross_color,
            opposite_color,
            side_a_color,
            side_a_opposite_color,
            side_b_color,
            cross_positions,
            non_cross_positions,
            side_positions,
            side_a_pair_positions,
            side_b_pair_positions,
            goal_cross: bits(&cross_positions),
            goal_opposite: bits(&opposite_positions),
            goal_side_a_pair: bits(&side_a_pair_positions),
            goal_side_a: bits(&face_positions(side_a_color)),
            goal_side_b: bits(&face_positions(side_b_color)),
        })
    }
}
'''
if frame_code.strip() not in s:
    if bits_end not in s:
        raise SystemExit('bits block not found')
    s = s.replace(bits_end, bits_end + frame_code, 1)

s = s.replace('struct CenterTables {\n', 'struct CenterTables {\n    frame: CenterFrame,\n')
s = s.replace('static CENTER_TABLES: OnceLock<CenterTables> = OnceLock::new();', '''static CENTER_TABLES: [OnceLock<CenterTables>; 6] = [\n    OnceLock::new(),\n    OnceLock::new(),\n    OnceLock::new(),\n    OnceLock::new(),\n    OnceLock::new(),\n    OnceLock::new(),\n];''')
s = s.replace('    let single_count = PHASE2_STATE_COUNT;\n', '    let single_count = PAIR_FACE_STATE_COUNT;\n')

build_re = re.compile(r'''impl CenterTables \{\n    fn build\(deadline_ts: f64\) -> Result<Self, CenterSolveError> \{.*?\n    \}\n\}\n\nfn get_tables\(deadline_ts: f64\) -> Result<&'static CenterTables, CenterSolveError> \{.*?\n\}\n''', re.S)
build_new = r'''impl CenterTables {
    fn build(cross_color: u8, deadline_ts: f64) -> Result<Self, CenterSolveError> {
        let started = now_ms();
        check_deadline(deadline_ts)?;
        let frame = CenterFrame::for_cross(cross_color)?;
        let phase1_moves = all_center_moves();
        let phase2_moves: Vec<_> = phase1_moves
            .iter()
            .filter(|center_move| {
                apply_mask(frame.goal_cross, &center_move.permutation) == frame.goal_cross
            })
            .cloned()
            .collect();
        let phase3_moves: Vec<_> = phase2_moves
            .iter()
            .filter(|center_move| {
                apply_mask(frame.goal_opposite, &center_move.permutation) == frame.goal_opposite
            })
            .cloned()
            .collect();
        let phase4_moves: Vec<_> = phase3_moves
            .iter()
            .filter(|center_move| {
                apply_mask(frame.goal_side_a_pair, &center_move.permutation)
                    == frame.goal_side_a_pair
            })
            .cloned()
            .collect();

        let phase1_distance = build_single_table(
            frame.goal_cross,
            &ALL_CENTER_POSITIONS,
            4,
            &phase1_moves,
            PHASE1_STATE_COUNT,
            "phase1-cross",
            deadline_ts,
        )?;
        let phase2_distance = build_single_table(
            frame.goal_opposite,
            &frame.non_cross_positions,
            4,
            &phase2_moves,
            PHASE2_STATE_COUNT,
            "phase2-opposite",
            deadline_ts,
        )?;
        let phase3_distance = build_single_table(
            frame.goal_side_a_pair,
            &frame.side_positions,
            8,
            &phase3_moves,
            PHASE3_STATE_COUNT,
            "phase3-sides",
            deadline_ts,
        )?;
        let phase4_distance = build_pair_table(
            frame.goal_side_a,
            &frame.side_a_pair_positions,
            frame.goal_side_b,
            &frame.side_b_pair_positions,
            &phase4_moves,
            deadline_ts,
        )?;
        check_deadline(deadline_ts)?;

        Ok(Self {
            frame,
            phase1_moves,
            phase2_moves,
            phase3_moves,
            phase4_moves,
            phase1_distance,
            phase2_distance,
            phase3_distance,
            phase4_distance,
            build_ms: (now_ms() - started).max(0.0),
        })
    }
}

fn get_tables(
    cross_color: u8,
    deadline_ts: f64,
) -> Result<&'static CenterTables, CenterSolveError> {
    if cross_color >= 6 {
        return Err(CenterSolveError::CoordinateNotReachable("cross-color"));
    }
    let slot = &CENTER_TABLES[cross_color as usize];
    if let Some(tables) = slot.get() {
        return Ok(tables);
    }
    let built = CenterTables::build(cross_color, deadline_ts)?;
    let _ = slot.set(built);
    slot.get()
        .ok_or(CenterSolveError::CoordinateNotReachable("table-cache"))
}
'''
s, n = build_re.subn(build_new, s, count=1)
if n != 1:
    raise SystemExit(f'build/get_tables replacement count {n}')

pair_re = re.compile(r'''fn descend_pair\(\n    state: &mut Cube444,\n    output: &mut Vec<Move444>,\n    deadline_ts: f64,\n    tables: &CenterTables,\n\) -> Result<\(\), CenterSolveError> \{.*?\n\}\n\npub fn solve_centers\(''', re.S)
pair_new = r'''fn descend_pair(
    state: &mut Cube444,
    output: &mut Vec<Move444>,
    deadline_ts: f64,
    tables: &CenterTables,
) -> Result<(), CenterSolveError> {
    let frame = &tables.frame;
    let pair_rank = |first: u32, second: u32| {
        coordinate_rank(first, &frame.side_a_pair_positions, 4) * PAIR_FACE_STATE_COUNT
            + coordinate_rank(second, &frame.side_b_pair_positions, 4)
    };
    let mut first = center_color_mask(state, &[frame.side_a_color]);
    let mut second = center_color_mask(state, &[frame.side_b_color]);
    let mut current_distance = tables.phase4_distance[pair_rank(first, second)];
    if current_distance == UNVISITED {
        return Err(CenterSolveError::CoordinateNotReachable("phase4"));
    }

    while current_distance > 0 {
        check_deadline(deadline_ts)?;
        let mut selected = None;
        for center_move in &tables.phase4_moves {
            let next_first = apply_mask(first, &center_move.permutation);
            let next_second = apply_mask(second, &center_move.permutation);
            let next_distance = tables.phase4_distance[pair_rank(next_first, next_second)];
            if next_distance + 1 == current_distance {
                selected = Some((center_move.mv, next_first, next_second, next_distance));
                break;
            }
        }
        let (mv, next_first, next_second, next_distance) =
            selected.ok_or(CenterSolveError::NoDescendingMove("phase4"))?;
        state.apply_move(mv);
        output.push(mv);
        first = next_first;
        second = next_second;
        current_distance = next_distance;
    }
    Ok(())
}

pub fn solve_centers('''
s, n = pair_re.subn(pair_new, s, count=1)
if n != 1:
    raise SystemExit(f'descend_pair replacement count {n}')

solve_re = re.compile(r'''pub fn solve_centers\(\n    state: &Cube444,\n    deadline_ts: f64,\n\) -> Result<CenterSolveResult, CenterSolveError> \{.*?\n\}\n\n#\[cfg\(test\)\]''', re.S)
solve_new = r'''pub fn solve_centers(
    state: &Cube444,
    deadline_ts: f64,
) -> Result<CenterSolveResult, CenterSolveError> {
    solve_centers_for_cross(state, deadline_ts, D)
}

pub fn solve_centers_for_cross(
    state: &Cube444,
    deadline_ts: f64,
    cross_color: u8,
) -> Result<CenterSolveResult, CenterSolveError> {
    check_deadline(deadline_ts)?;
    let tables_were_ready = cross_color < 6 && CENTER_TABLES[cross_color as usize].get().is_some();
    let tables = get_tables(cross_color, deadline_ts)?;
    let search_started = now_ms();
    let mut working = state.clone();
    let mut moves = Vec::with_capacity(36);
    let frame = &tables.frame;

    descend_single(
        &mut working,
        &mut moves,
        &[frame.cross_color],
        &ALL_CENTER_POSITIONS,
        4,
        &tables.phase1_distance,
        &tables.phase1_moves,
        "phase1-cross",
        deadline_ts,
    )?;
    descend_single(
        &mut working,
        &mut moves,
        &[frame.opposite_color],
        &frame.non_cross_positions,
        4,
        &tables.phase2_distance,
        &tables.phase2_moves,
        "phase2-opposite",
        deadline_ts,
    )?;
    descend_single(
        &mut working,
        &mut moves,
        &[frame.side_a_color, frame.side_a_opposite_color],
        &frame.side_positions,
        8,
        &tables.phase3_distance,
        &tables.phase3_moves,
        "phase3-sides",
        deadline_ts,
    )?;
    descend_pair(&mut working, &mut moves, deadline_ts, tables)?;
    check_deadline(deadline_ts)?;

    if !working.centers_solved() || working.validate().is_err() {
        return Err(CenterSolveError::VerificationFailed);
    }

    Ok(CenterSolveResult {
        moves,
        table_build_ms: if tables_were_ready { 0.0 } else { tables.build_ms },
        search_ms: (now_ms() - search_started).max(0.0),
    })
}

#[cfg(test)]'''
s, n = solve_re.subn(solve_new, s, count=1)
if n != 1:
    raise SystemExit(f'solve replacement count {n}')

s = s.replace('let tables = get_tables(0.0).unwrap();', 'let tables = get_tables(D, 0.0).unwrap();')
old_comb = '''        assert_eq!(BINOMIAL[24][8], PHASE1_STATE_COUNT);\n        assert_eq!(BINOMIAL[16][8], PHASE3_STATE_COUNT);\n        assert_eq!(BINOMIAL[8][4], PHASE2_STATE_COUNT);\n        assert_eq!(\n            coordinate_rank(GOAL_UD_GROUP, &ALL_CENTER_POSITIONS, 8),\n            12_375\n        );\n        assert!(coordinate_rank(GOAL_U, &UD_POSITIONS, 4) < PHASE2_STATE_COUNT);\n'''
new_comb = '''        assert_eq!(BINOMIAL[24][4], PHASE1_STATE_COUNT);\n        assert_eq!(BINOMIAL[20][4], PHASE2_STATE_COUNT);\n        assert_eq!(BINOMIAL[16][8], PHASE3_STATE_COUNT);\n        assert_eq!(BINOMIAL[8][4], PAIR_FACE_STATE_COUNT);\n        let frame = CenterFrame::for_cross(D).unwrap();\n        assert!(coordinate_rank(frame.goal_cross, &ALL_CENTER_POSITIONS, 4) < PHASE1_STATE_COUNT);\n        assert!(coordinate_rank(frame.goal_opposite, &frame.non_cross_positions, 4) < PHASE2_STATE_COUNT);\n'''
if old_comb not in s:
    raise SystemExit('combinadic test block missing')
s = s.replace(old_comb, new_comb)
s = s.replace('assert_eq!(tables.phase2_moves.len(), 28);', 'assert_eq!(tables.phase2_moves.len(), 24);')
s = s.replace('assert_eq!(tables.phase1_distance.iter().copied().max(), Some(8));\n        assert_eq!(tables.phase2_distance.iter().copied().max(), Some(5));', 'assert!(tables.phase1_distance.iter().copied().max().unwrap_or(0) <= 8);\n        assert!(tables.phase2_distance.iter().copied().max().unwrap_or(0) <= 8);')
s = s.replace('assert!(result.moves.len() <= 31);', 'assert!(result.moves.len() <= 36);')
s = s.replace('assert!(result.moves.len() <= 31, "case {case} exceeded phase bound");', 'assert!(result.moves.len() <= 36, "case {case} exceeded phase bound");')

marker = '''    #[test]\n    fn expired_deadline_is_rejected() {'''
order_test = r'''    #[test]
    fn selected_cross_center_is_completed_before_its_opposite_for_all_colors() {
        let scramble = "Rw U2 F' Lw D B2 Uw' R2 Fw D' L2 Bw2";
        for cross_color in 0..6u8 {
            let frame = CenterFrame::for_cross(cross_color).unwrap();
            let mut state = Cube444::solved();
            state.apply_alg(scramble).unwrap();
            let result = solve_centers_for_cross(&state, 0.0, cross_color).unwrap();
            let center_facelets = center_facelet_indices();
            let face_solved = |cube: &Cube444, color: u8| {
                face_positions(color).iter().all(|&center| {
                    cube.stickers()[center_facelets[center as usize]] == color
                })
            };
            let mut cross_seen = face_solved(&state, frame.cross_color);
            let mut opposite_seen = false;
            for mv in &result.moves {
                state.apply_move(*mv);
                if face_solved(&state, frame.cross_color) {
                    cross_seen = true;
                }
                if cross_seen {
                    assert!(
                        face_solved(&state, frame.cross_color),
                        "cross center was broken after completion for color {cross_color}"
                    );
                    if face_solved(&state, frame.opposite_color) {
                        opposite_seen = true;
                    }
                }
            }
            assert!(cross_seen, "cross center never completed for color {cross_color}");
            assert!(opposite_seen, "opposite center never completed for color {cross_color}");
            assert!(state.centers_solved());
        }
    }

'''
if order_test.strip() not in s:
    if marker not in s:
        raise SystemExit('test insertion marker missing')
    s = s.replace(marker, order_test + marker, 1)

p.write_text(s)

lib = Path('solver444-wasm/src/lib.rs')
t = lib.read_text()
t = t.replace('pub use centers::{solve_centers, CenterSolveError, CenterSolveResult};', 'pub use centers::{solve_centers, solve_centers_for_cross, CenterSolveError, CenterSolveResult};')
lib.write_text(t)

api = Path('solver444-wasm/src/api.rs')
t = api.read_text()
t = t.replace('normalize_parity, parse_alg444, solve_centers, solve_edges, CenterSolveError, Cube444,', 'normalize_parity, parse_alg444, solve_centers_for_cross, solve_edges, CenterSolveError, Cube444,')
t = t.replace('''    #[serde(default)]\n    scramble: String,\n    #[serde(default)]\n    deadline_ts: f64,\n''', '''    #[serde(default)]\n    scramble: String,\n    #[serde(default = "default_cross_color")]\n    cross_color: String,\n    #[serde(default)]\n    deadline_ts: f64,\n''')
default_marker = 'const API_VERSION: &str = "444-complete-v1";\n'
default_fn = '''\nfn default_cross_color() -> String {\n    "D".to_string()\n}\n\nfn parse_cross_color(value: &str) -> Option<u8> {\n    match value.trim().to_ascii_uppercase().as_str() {\n        "U" => Some(0),\n        "R" => Some(1),\n        "F" => Some(2),\n        "D" => Some(3),\n        "L" => Some(4),\n        "B" => Some(5),\n        _ => None,\n    }\n}\n'''
if 'fn default_cross_color()' not in t:
    t = t.replace(default_marker, default_marker + default_fn, 1)
center_call = '    let center_result = match solve_centers(&state, boundary.deadline_ts) {'
replacement = '''    let cross_color = match parse_cross_color(&request.cross_color) {\n        Some(color) => color,\n        None => {\n            return serialize_response(&empty_response(\n                "invalid",\n                "444_INVALID_CROSS_COLOR",\n                Some(request.cross_color),\n                boundary,\n            ));\n        }\n    };\n\n    let center_result = match solve_centers_for_cross(&state, boundary.deadline_ts, cross_color) {'''
if center_call not in t:
    raise SystemExit('api center call missing')
t = t.replace(center_call, replacement, 1)
api.write_text(t)

worker = Path('solver/solverWorker.js')
t = worker.read_text()
t = t.replace('''        solve444Lazy(scramble, onProgress, {\n          deadlineTs: effective444DeadlineTs,\n        }),''', '''        solve444Lazy(scramble, onProgress, {\n          deadlineTs: effective444DeadlineTs,\n          crossColor,\n        }),''')
worker.write_text(t)

js = Path('solver/solver444.js')
t = js.read_text()
t = t.replace('async function solveCfop333FromCubie(cubieState, onProgress, deadlineTs) {', 'async function solveCfop333FromCubie(cubieState, onProgress, deadlineTs, crossColor = "D") {')
t = t.replace('''    crossColor: "D",\n    solverVersion: "v2",''', '''    crossColor,\n    solverVersion: "v2",''')
t = t.replace('async function preferHumanEdgePairing323(api, reduction, publicScramble, internalScramble, deadlineTs) {', 'async function preferHumanEdgePairing323(api, reduction, publicScramble, internalScramble, crossColor, deadlineTs) {')
t = t.replace('''      scramble: continuationScramble,\n      deadlineTs,\n''', '''      scramble: continuationScramble,\n      crossColor,\n      deadlineTs,\n''', 1)
t = t.replace('''  const deadlineTs = Number(options?.deadlineTs) || 0;\n  const publicScramble = String(scramble || "").trim();''', '''  const deadlineTs = Number(options?.deadlineTs) || 0;\n  const crossColor = /^[URFDLB]$/i.test(String(options?.crossColor || "D"))\n    ? String(options?.crossColor || "D").toUpperCase()\n    : "D";\n  const publicScramble = String(scramble || "").trim();''')
t = t.replace('''      scramble: internalScramble,\n      deadlineTs,\n    }));''', '''      scramble: internalScramble,\n      crossColor,\n      deadlineTs,\n    }));''', 1)
t = t.replace('''    publicScramble,\n    internalScramble,\n    deadlineTs,\n  );''', '''    publicScramble,\n    internalScramble,\n    crossColor,\n    deadlineTs,\n  );''', 1)
t = t.replace('cfop = await solveCfop333FromCubie(result.meta.virtual333, onProgress, deadlineTs);', 'cfop = await solveCfop333FromCubie(result.meta.virtual333, onProgress, deadlineTs, crossColor);')
js.write_text(t)
