#!/usr/bin/env bash
set -euo pipefail

node tools/.fmc-six-frame-dev.mjs /tmp/mitm-dev-before.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/mitm-general-before.json

python3 - <<'PY'
from pathlib import Path

path = Path('solver-wasm/src/fmc_search.rs')
text = path.read_text()

constants_anchor = 'const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;\n'
constants_insert = '''const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;

/// Deep-Extreme rescue for complementary EO frames. A cached reverse frontier
/// joins one-move P2 finishes to a bounded forward DR search, preserving longer
/// DR routes whose endpoint is globally better than the canonical shortest DR.
const FMC_COMPLEMENTARY_MITM_TARGET_TOTAL: usize = 20;
const FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH: usize = 5;
const FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH: usize = 6;
const FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT: usize = 600_000;
'''
if constants_anchor not in text:
    raise SystemExit('constants anchor not found')
text = text.replace(constants_anchor, constants_insert, 1)

maps_anchor = '''const AXIS_SOLUTION_MAPS_JS: [[u8; 6]; 3] = [
    [0, 1, 2, 3, 4, 5], // UD: identity
    [4, 5, 2, 3, 1, 0], // FB: U→F, D→B, R→R, L→L, F→D, B→U
    [3, 2, 0, 1, 4, 5], // RL: U→L, D→R, R→U, L→D, F→F, B→B
];
'''
maps_insert = maps_anchor + '''
/// The second EO frame available for each DR axis. Existing axis tables cover
/// only one of the two EO axes compatible with each DR axis.
const COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS: [[u8; 6]; 3] = [
    [0, 1, 4, 5, 3, 2],
    [2, 3, 4, 5, 0, 1],
    [4, 5, 1, 0, 3, 2],
];

const COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS: [[u8; 6]; 3] = [
    [0, 1, 5, 4, 2, 3],
    [4, 5, 0, 1, 2, 3],
    [3, 2, 5, 4, 0, 1],
];
'''
if maps_anchor not in text:
    raise SystemExit('maps anchor not found')
text = text.replace(maps_anchor, maps_insert, 1)

struct_anchor = 'pub struct FmcTables {\n'
struct_prefix = r'''#[derive(Clone, Copy, Debug)]
struct FmcComplementaryTail {
    dr_moves: [u8; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
    dr_len: u8,
    p2_move: u8,
}

impl FmcComplementaryTail {
    fn solved() -> Self {
        Self {
            dr_moves: [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: 255,
        }
    }

    fn total_len(&self) -> usize {
        self.dr_len as usize + usize::from(self.p2_move != 255)
    }

    fn dr_slice(&self) -> &[u8] {
        &self.dr_moves[..self.dr_len as usize]
    }

    fn p2_moves(&self) -> Vec<u8> {
        if self.p2_move == 255 {
            Vec::new()
        } else {
            vec![self.p2_move]
        }
    }

    fn prepend_dr(&self, move_index: u8) -> Option<Self> {
        let old_len = self.dr_len as usize;
        if old_len >= FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH {
            return None;
        }
        let mut dr_moves = [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH];
        dr_moves[0] = move_index;
        if old_len > 0 {
            dr_moves[1..=old_len].copy_from_slice(&self.dr_moves[..old_len]);
        }
        Some(Self {
            dr_moves,
            dr_len: self.dr_len + 1,
            p2_move: self.p2_move,
        })
    }
}

fn complementary_compact_state_key(state: &CubeState) -> u128 {
    let mut key = 0u128;
    let mut shift = 0u32;
    for &value in &state.cp {
        key |= (value as u128) << shift;
        shift += 3;
    }
    for &value in &state.co {
        key |= (value as u128) << shift;
        shift += 2;
    }
    for &value in &state.ep {
        key |= (value as u128) << shift;
        shift += 4;
    }
    for &value in &state.eo {
        key |= (value as u128) << shift;
        shift += 1;
    }
    key
}

fn complementary_tail_order(tail: &FmcComplementaryTail) -> (usize, u8, [u8; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH], u8) {
    (tail.total_len(), tail.dr_len, tail.dr_moves, tail.p2_move)
}

fn retain_complementary_tail(
    tails: &mut std::collections::HashMap<u128, FmcComplementaryTail>,
    state: &CubeState,
    candidate: FmcComplementaryTail,
) -> bool {
    let key = complementary_compact_state_key(state);
    match tails.get(&key) {
        None => {
            tails.insert(key, candidate);
            true
        }
        Some(current) if complementary_tail_order(&candidate) < complementary_tail_order(current) => {
            tails.insert(key, candidate);
            true
        }
        _ => false,
    }
}

fn build_complementary_short_p2_tails(
    tables: &TwophaseTables,
) -> std::collections::HashMap<u128, FmcComplementaryTail> {
    let solved = CubeState::solved();
    let mut tails = std::collections::HashMap::<u128, FmcComplementaryTail>::new();
    let solved_tail = FmcComplementaryTail::solved();
    retain_complementary_tail(&mut tails, &solved, solved_tail);

    let mut frontier = vec![(solved, solved_tail)];
    for &global_move in &tables.phase2_move_indices {
        let state = solved.apply_move(global_move as usize, &tables.move_data);
        let tail = FmcComplementaryTail {
            dr_moves: [255; FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH],
            dr_len: 0,
            p2_move: MOVE_INVERSE[global_move as usize],
        };
        if retain_complementary_tail(&mut tails, &state, tail) {
            frontier.push((state, tail));
        }
    }

    for _ in 0..FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in frontier {
            for &move_index in &DR_EO_MOVE_INDICES {
                let predecessor = state.apply_move(move_index as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_dr(MOVE_INVERSE[move_index as usize]) else {
                    continue;
                };
                if retain_complementary_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        frontier = next;
    }
    tails
}

'''
if struct_anchor not in text:
    raise SystemExit('FmcTables anchor not found')
text = text.replace(struct_anchor, struct_prefix + struct_anchor, 1)

field_anchor = '    htr_first_move: OnceCell<std::collections::HashMap<u128, u8>>,\n'
field_insert = field_anchor + '    complementary_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcComplementaryTail>>,\n'
if field_anchor not in text:
    raise SystemExit('FmcTables field anchor not found')
text = text.replace(field_anchor, field_insert, 1)

init_anchor = '        htr_first_move: OnceCell::new(),\n'
init_insert = init_anchor + '        complementary_short_p2_tails: OnceCell::new(),\n'
if init_anchor not in text:
    raise SystemExit('FmcTables init anchor not found')
text = text.replace(init_anchor, init_insert, 1)

function_anchor = '// --- Single-Axis EO→DR→P2 Pipeline ---\n'
helper = r'''fn solve_complementary_short_p2_mitm(
    start: &CubeState,
    tails: &std::collections::HashMap<u128, FmcComplementaryTail>,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
) -> Option<(Vec<u8>, Vec<u8>)> {
    #[derive(Clone)]
    struct ForwardNode {
        state: CubeState,
        path: [u8; FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH],
        len: u8,
        last_face: u8,
    }

    let mut frontier = vec![ForwardNode {
        state: *start,
        path: [255; FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH],
        len: 0,
        last_face: LAST_FACE_FREE,
    }];
    let mut seen = std::collections::HashMap::<(u128, u8), u8>::new();
    seen.insert((complementary_compact_state_key(start), LAST_FACE_FREE), 0);
    let mut node_count = 1usize;

    for depth in 0..=FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH {
        for node in &frontier {
            if let Some(tail) = tails.get(&complementary_compact_state_key(&node.state)) {
                let tail_dr = tail.dr_slice();
                let p2_moves = tail.p2_moves();
                let solved = node
                    .state
                    .apply_moves(tail_dr, &tables.move_data)
                    .apply_moves(&p2_moves, &tables.move_data)
                    .is_solved();
                if solved {
                    let mut dr_moves = node.path[..node.len as usize].to_vec();
                    dr_moves.extend_from_slice(tail_dr);
                    return Some((dr_moves, p2_moves));
                }
            }
        }
        if depth == FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH {
            break;
        }

        let mut next_frontier = Vec::new();
        for node in frontier {
            let co = encode_co(&node.state.co);
            let slice = encode_slice_from_ep(&node.state.ep);
            let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
            let forward_left = FMC_COMPLEMENTARY_MITM_FORWARD_DEPTH - depth;
            if dr_distance == 255
                || dr_distance > forward_left + FMC_COMPLEMENTARY_MITM_REVERSE_DR_DEPTH
            {
                continue;
            }

            let mut children = Vec::new();
            for &move_index in &fmc_tables.dr_eo_allowed_by_last_face[node.last_face as usize] {
                let state = node.state.apply_move(move_index as usize, &tables.move_data);
                let key = complementary_compact_state_key(&state);
                let next_co = encode_co(&state.co);
                let next_slice = encode_slice_from_ep(&state.ep);
                let distance = fmc_tables.co_slice_dist[next_co * SLICE_SIZE + next_slice];
                children.push((!tails.contains_key(&key), distance, move_index, state, key));
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
                node_count += 1;
                if node_count >= FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT {
                    return None;
                }
            }
        }
        frontier = next_frontier;
    }
    None
}

'''
if function_anchor not in text:
    raise SystemExit('single-axis function anchor not found')
text = text.replace(function_anchor, helper + function_anchor, 1)

phase_anchor = '    // --- Phase 3: Premove sweep ---\n'
phase = r'''    // --- Phase 2c: complementary-frame short-P2 MITM rescue ---
    let completed_best_before_complementary = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if enable_deep_multi_switch_niss
        && search_level >= 3
        && completed_best_before_complementary > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
    {
        let complementary_tails = fmc_tables
            .complementary_short_p2_tails
            .get_or_init(|| build_complementary_short_p2_tails(tables));
        let complementary_scramble_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SCRAMBLE_MAPS_JS[axis])
        });
        let complementary_solution_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
            build_move_conjugation(&COMPLEMENTARY_AXIS_SOLUTION_MAPS_JS[axis])
        });

        for axis in 0..3usize {
            let conjugated_inverse: Vec<u8> = inv_scramble_moves
                .iter()
                .map(|&move_index| complementary_scramble_maps[axis][move_index as usize])
                .collect();
            let inverse_state =
                CubeState::solved().apply_moves(&conjugated_inverse, &tables.move_data);
            let eo_sequences = find_eo_sequences(
                encode_eo(&inverse_state.eo),
                tables,
                fmc_tables,
                max_eo_depth,
                1,
                0,
            );

            for eo_moves in eo_sequences.into_iter().take(1) {
                if eo_moves.is_empty()
                    || eo_moves.len() >= FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
                {
                    continue;
                }
                let boundary_state = inverse_state.apply_moves(&eo_moves, &tables.move_data);
                let switched_state = invert_state(&boundary_state);
                let Some((dr_moves, p2_moves)) = solve_complementary_short_p2_mitm(
                    &switched_state,
                    complementary_tails,
                    fmc_tables,
                    tables,
                ) else {
                    continue;
                };

                let mut continuation = dr_moves.clone();
                continuation.extend_from_slice(&p2_moves);
                let inverse_continuation = invert_moves(&continuation);
                let mut flattened = eo_moves.clone();
                flattened.extend_from_slice(&inverse_continuation);
                let flattened = simplify_moves(&flattened);
                if flattened.is_empty()
                    || flattened.len() > FMC_COMPLEMENTARY_MITM_TARGET_TOTAL
                    || !inverse_state
                        .apply_moves(&flattened, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }

                let convert = |moves: &[u8]| -> Vec<u8> {
                    moves
                        .iter()
                        .map(|&move_index| complementary_solution_maps[axis][move_index as usize])
                        .collect()
                };
                let effective_inverse_solution = convert(&flattened);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > raw_exploration_limit
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }

                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_moves.len() as u8,
                    dr_len: dr_moves.len() as u8,
                    p2_len: p2_moves.len() as u8,
                    eo_moves: convert(&eo_moves),
                    dr_moves: convert(&dr_moves),
                    finish_moves: convert(&p2_moves),
                    axis: axis as u8,
                    source_tag: 12,
                    premove_moves: vec![],
                    rzp_used: false,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
            }
        }
    }

'''
if phase_anchor not in text:
    raise SystemExit('phase anchor not found')
text = text.replace(phase_anchor, phase + phase_anchor, 1)

text = text.replace(
    '/// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS.',
    '/// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS; 12 is complementary-frame short-P2 MITM rescue.',
    1,
)

candidate_anchor = '''        11 => format!(
            "FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
'''
if text.count(candidate_anchor) != 1:
    raise SystemExit(f'candidate source anchor count={text.count(candidate_anchor)}')
text = text.replace(candidate_anchor, candidate_anchor + '''        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[candidate.axis as usize]
        ),
''', 1)

skeleton_anchor = '''        11 => format!(
            "FMC_MULTI_NISS_INVERSE_DR_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
'''
if text.count(skeleton_anchor) != 1:
    raise SystemExit(f'skeleton source anchor count={text.count(skeleton_anchor)}')
text = text.replace(skeleton_anchor, skeleton_anchor + '''        12 => format!(
            "FMC_COMPLEMENTARY_MITM_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
''', 1)

path.write_text(text)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
cargo install wasm-pack --locked --version 0.13.1 >/dev/null 2>&1 || true
wasm-pack build solver-wasm --target web --out-dir ../public/solver-wasm
git diff --check

node tools/.fmc-six-frame-dev.mjs /tmp/mitm-dev-after.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/mitm-general-before.json \
    --out /tmp/mitm-general-after.json

node --input-type=module <<'JS'
import fs from 'node:fs';
const before = JSON.parse(fs.readFileSync('/tmp/mitm-dev-before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('/tmp/mitm-dev-after.json', 'utf8'));
const general = JSON.parse(fs.readFileSync('/tmp/mitm-general-after.json', 'utf8'));
const wrBefore = before.rows.find((row) => row.id.includes('16'));
const wrAfter = after.rows.find((row) => row.id.includes('16'));
if (!wrBefore || !wrAfter) throw new Error('WR16_ROW_MISSING');
if (wrAfter.found > 20 || wrAfter.found >= wrBefore.found) {
  throw new Error(`WR16_NOT_IMPROVED:${wrBefore.found}->${wrAfter.found}`);
}
if (!general.gate?.passed) {
  throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
console.log(`COMPLEMENTARY_MITM_ACCEPTED WR16=${wrBefore.found}->${wrAfter.found}`);
console.log(`MITM_DEV_AFTER ${JSON.stringify(after)}`);
console.log(`MITM_GENERAL_AFTER ${JSON.stringify(general.comparison)}`);
JS

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git fetch origin main
# Restore the normal CI file and remove all temporary experiment assets.
git checkout origin/main -- .github/workflows/cfop-speedup-benchmark.yml
git rm -f --ignore-unmatch \
  .github/workflows/fmc-complementary-joint-depth.yml \
  tools/.fmc-complementary-joint-depth-experiment.sh \
  tools/.fmc-complementary-joint-depth-v2.sh \
  tools/.fmc-complementary-mitm-experiment.sh \
  solver-wasm/src/bin/wr16_mitm_diag.rs

git add solver-wasm/src/fmc_search.rs public/solver-wasm/solver_wasm_bg.wasm \
  .github/workflows/cfop-speedup-benchmark.yml
git commit -m "Add complementary-frame short-P2 MITM rescue"
git push origin HEAD:agent/fmc-extreme-independent-frontier-v2
