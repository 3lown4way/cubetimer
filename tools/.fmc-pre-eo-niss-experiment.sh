#!/usr/bin/env bash
set -euo pipefail

BRANCH="agent/fmc-extreme-independent-frontier-v2"
WORKFLOW=".github/workflows/cfop-speedup-benchmark.yml"
SOURCE="solver-wasm/src/fmc_search.rs"

node tools/.fmc-sub20-dev.mjs | tee /tmp/pre-eo-dev-before.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs --out /tmp/pre-eo-general-before.json | tee /tmp/pre-eo-general-before.log

python3 - <<'PY'
from pathlib import Path
p = Path("solver-wasm/src/fmc_search.rs")
s = p.read_text()

def replace_once(old, new):
    global s
    if old not in s:
        raise SystemExit(f"PATCH_MARKER_NOT_FOUND:\n{old[:160]}")
    s = s.replace(old, new, 1)

replace_once(
"const FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT: usize = 600_000;\n",
"const FMC_COMPLEMENTARY_MITM_FORWARD_NODE_LIMIT: usize = 600_000;\n\n"
"/// Deep-Extreme pre-EO NISS rescue. It explores a short prefix on one side,\n"
"/// switches before EO, then evaluates the opposite-side EO with a bounded\n"
"/// joint DR + short-P2 meet-in-the-middle continuation.\n"
"const FMC_PRE_EO_NISS_TARGET_TOTAL: usize = 20;\n"
"const FMC_PRE_EO_NISS_PREFIX_DEPTH: usize = 3;\n"
"const FMC_PRE_EO_NISS_SWITCH_EO_TOTAL: usize = 6;\n"
"const FMC_PRE_EO_NISS_EO_LIMIT: usize = 8;\n"
"const FMC_PRE_EO_NISS_FRONTIER_LIMIT: usize = 24;\n"
"const FMC_PRE_EO_NISS_P2_REVERSE_DEPTH: usize = 3;\n"
"const FMC_PRE_EO_NISS_DR_REVERSE_DEPTH: usize = 3;\n"
"const FMC_PRE_EO_NISS_DR_FORWARD_DEPTH: usize = 5;\n"
"const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;\n"
)

replace_once(
"    complementary_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcComplementaryTail>>,\n",
"    complementary_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcComplementaryTail>>,\n"
"    pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcPreEoTail>>,\n"
)
replace_once(
"        complementary_short_p2_tails: OnceCell::new(),\n",
"        complementary_short_p2_tails: OnceCell::new(),\n"
"        pre_eo_short_p2_tails: OnceCell::new(),\n"
)

marker = "fn solve_complementary_short_p2_mitm(\n"
insert = r'''
#[derive(Clone, Copy, Debug)]
struct FmcPreEoTail {
    dr_moves: [u8; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
    dr_len: u8,
    p2_moves: [u8; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
    p2_len: u8,
}

impl FmcPreEoTail {
    fn solved() -> Self {
        Self {
            dr_moves: [255; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
            dr_len: 0,
            p2_moves: [255; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
            p2_len: 0,
        }
    }

    fn total_len(&self) -> usize {
        self.dr_len as usize + self.p2_len as usize
    }

    fn dr_slice(&self) -> &[u8] {
        &self.dr_moves[..self.dr_len as usize]
    }

    fn p2_slice(&self) -> &[u8] {
        &self.p2_moves[..self.p2_len as usize]
    }

    fn prepend_dr(&self, move_index: u8) -> Option<Self> {
        let old_len = self.dr_len as usize;
        if old_len >= FMC_PRE_EO_NISS_DR_REVERSE_DEPTH {
            return None;
        }
        let mut next = *self;
        next.dr_moves = [255; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH];
        next.dr_moves[0] = move_index;
        if old_len > 0 {
            next.dr_moves[1..=old_len].copy_from_slice(&self.dr_moves[..old_len]);
        }
        next.dr_len += 1;
        Some(next)
    }

    fn prepend_p2(&self, move_index: u8) -> Option<Self> {
        let old_len = self.p2_len as usize;
        if old_len >= FMC_PRE_EO_NISS_P2_REVERSE_DEPTH {
            return None;
        }
        let mut next = *self;
        next.p2_moves = [255; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH];
        next.p2_moves[0] = move_index;
        if old_len > 0 {
            next.p2_moves[1..=old_len].copy_from_slice(&self.p2_moves[..old_len]);
        }
        next.p2_len += 1;
        Some(next)
    }
}

fn pre_eo_tail_order(
    tail: &FmcPreEoTail,
) -> (
    usize,
    u8,
    [u8; FMC_PRE_EO_NISS_DR_REVERSE_DEPTH],
    u8,
    [u8; FMC_PRE_EO_NISS_P2_REVERSE_DEPTH],
) {
    (
        tail.total_len(),
        tail.dr_len,
        tail.dr_moves,
        tail.p2_len,
        tail.p2_moves,
    )
}

fn retain_pre_eo_tail(
    tails: &mut std::collections::HashMap<u128, FmcPreEoTail>,
    state: &CubeState,
    candidate: FmcPreEoTail,
) -> bool {
    let key = complementary_compact_state_key(state);
    match tails.get(&key) {
        None => {
            tails.insert(key, candidate);
            true
        }
        Some(current) if pre_eo_tail_order(&candidate) < pre_eo_tail_order(current) => {
            tails.insert(key, candidate);
            true
        }
        _ => false,
    }
}

fn build_pre_eo_short_p2_tails(
    tables: &TwophaseTables,
) -> std::collections::HashMap<u128, FmcPreEoTail> {
    let solved = CubeState::solved();
    let solved_tail = FmcPreEoTail::solved();
    let mut tails = std::collections::HashMap::<u128, FmcPreEoTail>::new();
    retain_pre_eo_tail(&mut tails, &solved, solved_tail);

    let mut p2_frontier = vec![(solved, solved_tail)];
    let mut dr_seeds = p2_frontier.clone();
    for _ in 0..FMC_PRE_EO_NISS_P2_REVERSE_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in p2_frontier {
            for &global_move in &tables.phase2_move_indices {
                let predecessor = state.apply_move(global_move as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_p2(MOVE_INVERSE[global_move as usize]) else {
                    continue;
                };
                if retain_pre_eo_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        dr_seeds.extend(next.iter().copied());
        p2_frontier = next;
    }

    let mut frontier = dr_seeds;
    for _ in 0..FMC_PRE_EO_NISS_DR_REVERSE_DEPTH {
        let mut next = Vec::new();
        for (state, tail) in frontier {
            for &move_index in &DR_EO_MOVE_INDICES {
                let predecessor = state.apply_move(move_index as usize, &tables.move_data);
                let Some(candidate) = tail.prepend_dr(MOVE_INVERSE[move_index as usize]) else {
                    continue;
                };
                if retain_pre_eo_tail(&mut tails, &predecessor, candidate) {
                    next.push((predecessor, candidate));
                }
            }
        }
        frontier = next;
    }
    tails
}

#[derive(Clone, Debug)]
struct FmcPreEoBoundary {
    prefix_moves: Vec<u8>,
    eo_moves: Vec<u8>,
    state_after_eo: CubeState,
    dr_distance: u8,
    lower_bound: usize,
}

fn collect_pre_eo_niss_frontier(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
) -> Vec<FmcPreEoBoundary> {
    fn dfs(
        state: CubeState,
        path: &mut Vec<u8>,
        last_face: u8,
        tables: &TwophaseTables,
        fmc_tables: &FmcTables,
        max_eo_depth: u8,
        output: &mut Vec<FmcPreEoBoundary>,
    ) {
        if !path.is_empty() {
            let switched = invert_state(&state);
            let eo_idx = encode_eo(&switched.eo);
            let eo_min = fmc_tables.eo_dist[eo_idx] as usize;
            let eo_cap = FMC_PRE_EO_NISS_SWITCH_EO_TOTAL
                .saturating_sub(path.len())
                .min(max_eo_depth as usize);
            if eo_min <= eo_cap {
                let eo_sequences = find_eo_sequences(
                    eo_idx,
                    tables,
                    fmc_tables,
                    eo_cap as u8,
                    FMC_PRE_EO_NISS_EO_LIMIT,
                    0,
                );
                for eo_moves in eo_sequences {
                    let state_after_eo = switched.apply_moves(&eo_moves, &tables.move_data);
                    let co = encode_co(&state_after_eo.co);
                    let slice = encode_slice_from_ep(&state_after_eo.ep);
                    let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice];
                    if dr_distance == 255 {
                        continue;
                    }
                    let lower_bound = path.len() + eo_moves.len() + dr_distance as usize;
                    if lower_bound <= FMC_PRE_EO_NISS_TARGET_TOTAL {
                        output.push(FmcPreEoBoundary {
                            prefix_moves: path.clone(),
                            eo_moves,
                            state_after_eo,
                            dr_distance,
                            lower_bound,
                        });
                    }
                }
            }
        }

        if path.len() >= FMC_PRE_EO_NISS_PREFIX_DEPTH {
            return;
        }
        for &move_index in &tables.phase1_allowed_moves_by_last_face[last_face as usize] {
            let face = tables.move_data.move_face[move_index as usize];
            path.push(move_index);
            let next = state.apply_move(move_index as usize, &tables.move_data);
            dfs(next, path, face, tables, fmc_tables, max_eo_depth, output);
            path.pop();
        }
    }

    let mut output = Vec::new();
    dfs(
        *state,
        &mut Vec::new(),
        LAST_FACE_FREE,
        tables,
        fmc_tables,
        max_eo_depth,
        &mut output,
    );
    output.sort_by_key(|boundary| {
        (
            boundary.lower_bound,
            boundary.prefix_moves.len() + boundary.eo_moves.len(),
            boundary.dr_distance,
            boundary.prefix_moves.clone(),
            boundary.eo_moves.clone(),
        )
    });
    let mut seen = std::collections::HashSet::new();
    output.retain(|boundary| seen.insert(fmc_state_key(&boundary.state_after_eo)));
    output.truncate(FMC_PRE_EO_NISS_FRONTIER_LIMIT);
    output
}

fn solve_pre_eo_joint_mitm(
    start: &CubeState,
    last_face_before_dr: u8,
    remaining_budget: usize,
    tails: &std::collections::HashMap<u128, FmcPreEoTail>,
    fmc_tables: &FmcTables,
    tables: &TwophaseTables,
) -> Option<(Vec<u8>, Vec<u8>)> {
    #[derive(Clone)]
    struct ForwardNode {
        state: CubeState,
        path: [u8; FMC_PRE_EO_NISS_DR_FORWARD_DEPTH],
        len: u8,
        last_face: u8,
    }

    let mut frontier = vec![ForwardNode {
        state: *start,
        path: [255; FMC_PRE_EO_NISS_DR_FORWARD_DEPTH],
        len: 0,
        last_face: last_face_before_dr,
    }];
    let mut seen = std::collections::HashMap::<(u128, u8), u8>::new();
    seen.insert(
        (complementary_compact_state_key(start), last_face_before_dr),
        0,
    );
    let mut node_count = 1usize;
    let mut best: Option<(Vec<u8>, Vec<u8>)> = None;

    for depth in 0..=FMC_PRE_EO_NISS_DR_FORWARD_DEPTH {
        for node in &frontier {
            if let Some(tail) = tails.get(&complementary_compact_state_key(&node.state)) {
                let total = node.len as usize + tail.total_len();
                if total <= remaining_budget {
                    let mut dr_moves = node.path[..node.len as usize].to_vec();
                    dr_moves.extend_from_slice(tail.dr_slice());
                    let p2_moves = tail.p2_slice().to_vec();
                    let solved = start
                        .apply_moves(&dr_moves, &tables.move_data)
                        .apply_moves(&p2_moves, &tables.move_data)
                        .is_solved();
                    if solved {
                        let replace = best.as_ref().is_none_or(|(current_dr, current_p2)| {
                            (dr_moves.len() + p2_moves.len(), dr_moves.clone(), p2_moves.clone())
                                < (
                                    current_dr.len() + current_p2.len(),
                                    current_dr.clone(),
                                    current_p2.clone(),
                                )
                        });
                        if replace {
                            best = Some((dr_moves, p2_moves));
                        }
                    }
                }
            }
        }
        if depth == FMC_PRE_EO_NISS_DR_FORWARD_DEPTH {
            break;
        }

        let mut next_frontier = Vec::new();
        for node in frontier {
            let co = encode_co(&node.state.co);
            let slice = encode_slice_from_ep(&node.state.ep);
            let dr_distance = fmc_tables.co_slice_dist[co * SLICE_SIZE + slice] as usize;
            let forward_left = FMC_PRE_EO_NISS_DR_FORWARD_DEPTH - depth;
            if dr_distance == 255
                || dr_distance > forward_left + FMC_PRE_EO_NISS_DR_REVERSE_DEPTH
                || node.len as usize >= remaining_budget
            {
                continue;
            }

            let mut children = Vec::new();
            for &move_index in &fmc_tables.dr_eo_allowed_by_last_face[node.last_face as usize] {
                let next_state = node.state.apply_move(move_index as usize, &tables.move_data);
                let key = complementary_compact_state_key(&next_state);
                let next_co = encode_co(&next_state.co);
                let next_slice = encode_slice_from_ep(&next_state.ep);
                let distance = fmc_tables.co_slice_dist[next_co * SLICE_SIZE + next_slice];
                children.push((!tails.contains_key(&key), distance, move_index, next_state, key));
            }
            children.sort_by_key(|(not_meet, distance, move_index, _, _)| {
                (*not_meet, *distance, *move_index)
            });

            for (_, _, move_index, next_state, key) in children {
                let face = tables.move_data.move_face[move_index as usize];
                let next_depth = (depth + 1) as u8;
                let seen_key = (key, face);
                if seen
                    .get(&seen_key)
                    .is_some_and(|&previous| previous <= next_depth)
                {
                    continue;
                }
                seen.insert(seen_key, next_depth);
                let mut path = node.path;
                path[depth] = move_index;
                next_frontier.push(ForwardNode {
                    state: next_state,
                    path,
                    len: next_depth,
                    last_face: face,
                });
                node_count += 1;
                if node_count >= FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT {
                    return best;
                }
            }
        }
        frontier = next_frontier;
    }
    best
}

#[derive(Clone, Debug)]
struct FmcPreEoNissResult {
    moves: Vec<u8>,
    prefix_moves: Vec<u8>,
    eo_moves: Vec<u8>,
    dr_moves: Vec<u8>,
    p2_moves: Vec<u8>,
}

fn solve_pre_eo_niss_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    tails: &std::collections::HashMap<u128, FmcPreEoTail>,
) -> Vec<FmcPreEoNissResult> {
    let boundaries = collect_pre_eo_niss_frontier(state, tables, fmc_tables, max_eo_depth);
    let mut output = Vec::new();
    for boundary in boundaries {
        let used = boundary.prefix_moves.len() + boundary.eo_moves.len();
        let remaining = FMC_PRE_EO_NISS_TARGET_TOTAL.saturating_sub(used);
        let last_face = last_face_of_moves(&boundary.eo_moves, tables);
        let Some((dr_moves, p2_moves)) = solve_pre_eo_joint_mitm(
            &boundary.state_after_eo,
            last_face,
            remaining,
            tails,
            fmc_tables,
            tables,
        ) else {
            continue;
        };
        let mut continuation = boundary.eo_moves.clone();
        continuation.extend_from_slice(&dr_moves);
        continuation.extend_from_slice(&p2_moves);
        let mut flattened = boundary.prefix_moves.clone();
        flattened.extend_from_slice(&invert_moves(&continuation));
        let flattened = simplify_moves(&flattened);
        if flattened.is_empty()
            || flattened.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
            || !state.apply_moves(&flattened, &tables.move_data).is_solved()
        {
            continue;
        }
        output.push(FmcPreEoNissResult {
            moves: flattened,
            prefix_moves: boundary.prefix_moves,
            eo_moves: boundary.eo_moves,
            dr_moves,
            p2_moves,
        });
    }
    output.sort_by_key(|result| (result.moves.len(), result.moves.clone()));
    let mut seen = std::collections::HashSet::new();
    output.retain(|result| seen.insert(result.moves.clone()));
    output.truncate(4);
    output
}

'''
replace_once(marker, insert + marker)

phase_marker = "    // --- Phase 3: Premove sweep ---\n"
phase = r'''
    // --- Phase 2e: bounded pre-EO NISS switch rescue ---
    let completed_best_before_pre_eo = all_candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    if enable_deep_multi_switch_niss
        && search_level >= 3
        && completed_best_before_pre_eo > FMC_PRE_EO_NISS_TARGET_TOTAL
    {
        let pre_eo_tails = fmc_tables
            .pre_eo_short_p2_tails
            .get_or_init(|| build_pre_eo_short_p2_tails(tables));
        let mut accepted_inverse = false;

        for axis in 0..3usize {
            let results = solve_pre_eo_niss_single_axis(
                &inverse_axis_states[axis],
                tables,
                fmc_tables,
                max_eo_depth,
                pre_eo_tails,
            );
            let convert = |moves: &[u8]| -> Vec<u8> {
                moves
                    .iter()
                    .map(|&move_index| {
                        fmc_tables.axis_solution_move_map[axis][move_index as usize]
                    })
                    .collect()
            };
            for result in results {
                let effective_inverse_solution = convert(&result.moves);
                let simplified = simplify_moves(&invert_moves(&effective_inverse_solution));
                if simplified.is_empty()
                    || simplified.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
                    || !original_scramble_state
                        .apply_moves(&simplified, &tables.move_data)
                        .is_solved()
                {
                    continue;
                }
                let mut eo_metadata = result.prefix_moves.clone();
                eo_metadata.extend_from_slice(&result.eo_moves);
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: eo_metadata.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.p2_moves.len() as u8,
                    eo_moves: convert(&eo_metadata),
                    dr_moves: convert(&result.dr_moves),
                    finish_moves: convert(&result.p2_moves),
                    axis: axis as u8,
                    source_tag: 14,
                    premove_moves: vec![],
                    rzp_used: false,
                    skeleton_moves: vec![],
                    insertion_moves: vec![],
                    insertion_position: None,
                    skeleton_kind: None,
                    insertion_steps: vec![],
                });
                accepted_inverse = true;
            }
            if accepted_inverse {
                break;
            }
        }

        if !accepted_inverse {
            for axis in 0..3usize {
                let results = solve_pre_eo_niss_single_axis(
                    &direct_axis_states[axis],
                    tables,
                    fmc_tables,
                    max_eo_depth,
                    pre_eo_tails,
                );
                let convert = |moves: &[u8]| -> Vec<u8> {
                    moves
                        .iter()
                        .map(|&move_index| {
                            fmc_tables.axis_solution_move_map[axis][move_index as usize]
                        })
                        .collect()
                };
                for result in results {
                    let simplified = simplify_moves(&convert(&result.moves));
                    if simplified.is_empty()
                        || simplified.len() > FMC_PRE_EO_NISS_TARGET_TOTAL
                        || !original_scramble_state
                            .apply_moves(&simplified, &tables.move_data)
                            .is_solved()
                    {
                        continue;
                    }
                    let mut eo_metadata = result.prefix_moves.clone();
                    eo_metadata.extend_from_slice(&result.eo_moves);
                    all_candidates.push(FmcCandidate {
                        moves: simplified,
                        eo_len: eo_metadata.len() as u8,
                        dr_len: result.dr_moves.len() as u8,
                        p2_len: result.p2_moves.len() as u8,
                        eo_moves: convert(&eo_metadata),
                        dr_moves: convert(&result.dr_moves),
                        finish_moves: convert(&result.p2_moves),
                        axis: axis as u8,
                        source_tag: 15,
                        premove_moves: vec![],
                        rzp_used: false,
                        skeleton_moves: vec![],
                        insertion_moves: vec![],
                        insertion_position: None,
                        skeleton_kind: None,
                        insertion_steps: vec![],
                    });
                }
                if all_candidates
                    .iter()
                    .any(|candidate| matches!(candidate.source_tag, 14 | 15))
                {
                    break;
                }
            }
        }
    }

'''
replace_once(phase_marker, phase + phase_marker)

replace_once(
"        13 => format!(\n            \"FMC_COMPLEMENTARY_NORMAL_{}\",\n            AXIS_NAMES[candidate.axis as usize]\n        ),\n        _ => \"FMC_UNKNOWN\".into(),\n",
"        13 => format!(\n            \"FMC_COMPLEMENTARY_NORMAL_{}\",\n            AXIS_NAMES[candidate.axis as usize]\n        ),\n        14 => format!(\n            \"FMC_PRE_EO_NISS_INVERSE_{}\",\n            AXIS_NAMES[candidate.axis as usize]\n        ),\n        15 => format!(\n            \"FMC_PRE_EO_NISS_DIRECT_{}\",\n            AXIS_NAMES[candidate.axis as usize]\n        ),\n        _ => \"FMC_UNKNOWN\".into(),\n"
)

p.write_text(s)
PY

cargo test --release --manifest-path solver-wasm/Cargo.toml
(
  cd solver-wasm
  wasm-pack build --target web --out-dir ../public/solver-wasm
)
# wasm-pack may rewrite its local ignore file even when no policy change is intended.
git checkout HEAD -- public/solver-wasm/.gitignore 2>/dev/null || true

node tools/.fmc-sub20-dev.mjs | tee /tmp/pre-eo-dev-after.log
FMC_GENERALIZATION_FIXED_COUNT=6 FMC_GENERALIZATION_COMPRESSION_COUNT=2 \
  node tools/benchmark-fmc-generalization.mjs \
    --baseline /tmp/pre-eo-general-before.json \
    --out /tmp/pre-eo-general-after.json | tee /tmp/pre-eo-general-after.log

node --input-type=module <<'NODE'
import fs from "node:fs";
function parseDev(path) {
  const line = fs.readFileSync(path, "utf8").split(/\r?\n/).find((value) => value.startsWith("SUB20_DEV "));
  if (!line) throw new Error(`DEV_OUTPUT_MISSING:${path}`);
  return JSON.parse(line.slice("SUB20_DEV ".length));
}
const before = parseDev("/tmp/pre-eo-dev-before.log");
const after = parseDev("/tmp/pre-eo-dev-after.log");
const general = JSON.parse(fs.readFileSync("/tmp/pre-eo-general-after.json", "utf8"));
const byId = Object.fromEntries(after.rows.map((row) => [row.id, row]));
const wr = byId["sebastiano-tronto-wr16-2019"];
const brian = byId["brian-johnson-wr-mean-a1-17-2026"];
const wong = byId["wong-chong-wen-wr-mean-a1-18-2026"];
if (!wr || wr.found !== 16) throw new Error(`WR16_REGRESSION:${wr?.found}`);
if (!wong || wong.found !== 18) throw new Error(`WONG18_REGRESSION:${wong?.found}`);
if (!brian || brian.found > 17) throw new Error(`BRIAN17_TARGET_NOT_REACHED:${brian?.found}`);
if (!general.gate?.passed) throw new Error(`GENERALIZATION_GATE_FAILED:${JSON.stringify(general.gate)}`);
console.log(`PRE_EO_NISS_ACCEPTED BRIAN=${before.rows.find((r) => r.id.includes("brian"))?.found}->${brian.found}`);
console.log(`SUB20_DEV_AFTER ${JSON.stringify(after)}`);
console.log(`SUB20_GENERAL_AFTER ${JSON.stringify(general.comparison)}`);
NODE

git fetch origin main
rm -f tools/.fmc-pre-eo-niss-experiment.sh tools/.fmc-sub20-dev.mjs
git checkout origin/main -- "$WORKFLOW"
git add "$SOURCE" public/solver-wasm/solver_wasm_bg.wasm "$WORKFLOW" tools/.fmc-pre-eo-niss-experiment.sh tools/.fmc-sub20-dev.mjs
git commit -m "Add bounded pre-EO NISS switch rescue"
git push origin HEAD:"$BRANCH"
