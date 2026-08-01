#!/usr/bin/env bash
set -euo pipefail

node tools/.fmc-six-frame-dev.mjs /tmp/dev-before.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/general-before.json

python3 - <<'PY'
from pathlib import Path

path = Path('solver-wasm/src/fmc_search.rs')
text = path.read_text()

constants_anchor = 'const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;\n'
constants_insert = '''const FMC_MULTI_NISS_RESULT_LIMIT_PER_AXIS: usize = 4;

/// Complementary-frame rescue is deliberately confined to deep Extreme. It
/// jointly searches DR endpoints and their P2 tails instead of discarding a
/// longer DR route solely because the canonical DR endpoint is shorter.
const FMC_COMPLEMENTARY_NISS_TARGET_TOTAL: usize = 20;
const FMC_COMPLEMENTARY_NISS_MAX_CONTINUATION: usize = 16;
const FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH: usize = 12;
const FMC_COMPLEMENTARY_NISS_NODE_LIMIT: u64 = 4_000_000;
const FMC_COMPLEMENTARY_NISS_P2_NODE_LIMIT: u64 = 2_000_000;
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
/// The second EO frame available for each DR axis. The existing three frames
/// cover only one of the two EO axes compatible with a chosen DR axis.
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

function_anchor = '// --- Single-Axis EO→DR→P2 Pipeline ---\n'
helper = r'''fn phase2_lower_bound(input: &Phase2Input, tables: &TwophaseTables) -> u8 {
    tables
        .phase2_cp_sep_joint
        .get(input.cp_idx * FACTORIAL_4[4] + input.sep_idx)
        .max(tables.phase2_ep.get(input.ep_idx))
}

fn search_joint_dr_p2_bound(
    state: CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    p2_cache: &mut FmcP2Cache,
    path: &mut Vec<u8>,
    last_face: u8,
    total_bound: usize,
    max_dr_depth: usize,
    nodes: &mut u64,
    p2_calls: &mut usize,
    seen: &mut std::collections::HashMap<FmcStateKey, usize>,
) -> Option<(Vec<u8>, Vec<u8>)> {
    if *nodes >= FMC_COMPLEMENTARY_NISS_NODE_LIMIT {
        return None;
    }
    *nodes += 1;

    let depth = path.len();
    let co = encode_co(&state.co);
    let slice = encode_slice_from_ep(&state.ep);
    let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
    if dr_distance == 255
        || depth.saturating_add(dr_distance) > total_bound
        || depth.saturating_add(dr_distance) > max_dr_depth
    {
        return None;
    }

    if co == 0 && slice == tables.solved_slice as usize {
        if let Some(input) = build_p2_input(&state) {
            let remaining = total_bound.saturating_sub(depth);
            let lower_bound = phase2_lower_bound(&input, tables) as usize;
            if lower_bound <= remaining && *p2_calls < 2048 {
                *p2_calls += 1;
                if let Some(local_moves) = p2_cache.solve(
                    &input,
                    tables,
                    remaining.min(FMC_MAX_P2_DEPTH as usize) as u8,
                    FMC_COMPLEMENTARY_NISS_P2_NODE_LIMIT,
                ) {
                    let global_moves = local_moves
                        .iter()
                        .map(|&local| tables.phase2_move_indices[local as usize])
                        .collect();
                    return Some((path.clone(), global_moves));
                }
            }
        }
    }

    if depth >= max_dr_depth || depth >= total_bound {
        return None;
    }

    let remaining_budget = total_bound - depth;
    let key = fmc_state_key(&state);
    if seen
        .get(&key)
        .is_some_and(|&previous_budget| previous_budget >= remaining_budget)
    {
        return None;
    }
    seen.insert(key, remaining_budget);

    let mut next_moves = Vec::new();
    for &move_index in &fmc_tables.dr_eo_allowed_by_last_face[last_face as usize] {
        let next = state.apply_move(move_index as usize, &tables.move_data);
        let next_co = encode_co(&next.co);
        let next_slice = encode_slice_from_ep(&next.ep);
        let next_distance = fmc_tables.co_slice_dist[next_co * SLICE_SIZE + next_slice];
        next_moves.push((next_distance, move_index, next));
    }
    next_moves.sort_by_key(|(distance, move_index, _)| (*distance, *move_index));

    for (_, move_index, next) in next_moves {
        let face = tables.move_data.move_face[move_index as usize];
        path.push(move_index);
        if let Some(result) = search_joint_dr_p2_bound(
            next,
            tables,
            fmc_tables,
            p2_cache,
            path,
            face,
            total_bound,
            max_dr_depth,
            nodes,
            p2_calls,
            seen,
        ) {
            return Some(result);
        }
        path.pop();
        if *nodes >= FMC_COMPLEMENTARY_NISS_NODE_LIMIT {
            break;
        }
    }
    None
}

fn solve_joint_dr_p2_rescue(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    p2_cache: &mut FmcP2Cache,
    max_total_depth: usize,
) -> Option<(Vec<u8>, Vec<u8>)> {
    if encode_eo(&state.eo) != 0 {
        return None;
    }
    let co = encode_co(&state.co);
    let slice = encode_slice_from_ep(&state.ep);
    let initial_bound = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
    if initial_bound == 255 {
        return None;
    }

    let mut nodes = 0u64;
    let mut p2_calls = 0usize;
    for total_bound in initial_bound..=max_total_depth {
        let mut path = Vec::with_capacity(FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH);
        let mut seen = std::collections::HashMap::new();
        if let Some(result) = search_joint_dr_p2_bound(
            *state,
            tables,
            fmc_tables,
            p2_cache,
            &mut path,
            LAST_FACE_FREE,
            total_bound,
            FMC_COMPLEMENTARY_NISS_MAX_DR_DEPTH.min(total_bound),
            &mut nodes,
            &mut p2_calls,
            &mut seen,
        ) {
            return Some(result);
        }
        if nodes >= FMC_COMPLEMENTARY_NISS_NODE_LIMIT {
            break;
        }
    }
    None
}

'''
if function_anchor not in text:
    raise SystemExit('function anchor not found')
text = text.replace(function_anchor, helper + function_anchor, 1)

phase_anchor = '    // --- Phase 3: Premove sweep ---\n'
phase = r'''    // --- Phase 2c: complementary-frame inverse EO rescue ---
    if enable_deep_multi_switch_niss && search_level >= 3 {
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
                if eo_moves.is_empty() || eo_moves.len() >= FMC_COMPLEMENTARY_NISS_TARGET_TOTAL {
                    continue;
                }
                let boundary_state = inverse_state.apply_moves(&eo_moves, &tables.move_data);
                let switched_state = invert_state(&boundary_state);
                let max_continuation = FMC_COMPLEMENTARY_NISS_MAX_CONTINUATION
                    .min(FMC_COMPLEMENTARY_NISS_TARGET_TOTAL.saturating_sub(eo_moves.len()));
                let Some((dr_moves, p2_moves)) = solve_joint_dr_p2_rescue(
                    &switched_state,
                    tables,
                    fmc_tables,
                    &mut p2_cache,
                    max_continuation,
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
                    || flattened.len() > FMC_COMPLEMENTARY_NISS_TARGET_TOTAL
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
                    dr_moves: vec![],
                    finish_moves: convert(&inverse_continuation),
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
    '/// 0=direct, 1=niss, 2=premove_direct, 3=premove_niss; 8..=11 are stage-boundary NISS; 12 is complementary-frame inverse EO rescue.',
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
            "FMC_COMPLEMENTARY_NISS_INVERSE_EO_BOUNDARY_{}",
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
            "FMC_COMPLEMENTARY_NISS_INVERSE_EO_BOUNDARY_{}",
            AXIS_NAMES[skeleton.axis as usize]
        ),
''', 1)

path.write_text(text)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
cargo install wasm-pack --locked --version 0.13.1 >/dev/null 2>&1 || true
wasm-pack build solver-wasm --target web --out-dir ../public/solver-wasm
git diff --check

node tools/.fmc-six-frame-dev.mjs /tmp/dev-after.json
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --baseline /tmp/general-before.json --out /tmp/general-after.json

node --input-type=module <<'JS'
import fs from 'node:fs';
const before = JSON.parse(fs.readFileSync('/tmp/dev-before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('/tmp/dev-after.json', 'utf8'));
const general = JSON.parse(fs.readFileSync('/tmp/general-after.json', 'utf8'));
const wrBefore = before.rows.find((row) => row.id.includes('16'));
const wrAfter = after.rows.find((row) => row.id.includes('16'));
if (!wrBefore || !wrAfter) throw new Error('WR16_ROW_MISSING');
if (wrAfter.found > 20 || wrAfter.found >= wrBefore.found) {
  throw new Error(`WR16_NOT_IMPROVED:${wrBefore.found}->${wrAfter.found}`);
}
if (!general.gate?.passed) {
  throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
}
console.log(`JOINT_RESCUE_ACCEPTED WR16=${wrBefore.found}->${wrAfter.found}`);
console.log(`DEV_AFTER ${JSON.stringify(after)}`);
console.log(`GENERAL_AFTER ${JSON.stringify(general.comparison)}`);
JS

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git rm -f .github/workflows/fmc-complementary-joint-depth.yml tools/.fmc-complementary-joint-depth-experiment.sh
git add solver-wasm/src/fmc_search.rs public/solver-wasm/solver_wasm_bg.wasm public/solver-wasm/solver_wasm.js public/solver-wasm/solver_wasm.d.ts public/solver-wasm/solver_wasm_bg.wasm.d.ts
git commit -m "Add bounded complementary-frame joint DR and P2 rescue"
git push origin HEAD:agent/fmc-extreme-independent-frontier-v2
