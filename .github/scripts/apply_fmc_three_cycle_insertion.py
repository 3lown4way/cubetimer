from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()

text = replace_once(
    text,
    "const FMC_SKELETON_PER_BUCKET: usize = 2;\n",
    "const FMC_SKELETON_PER_BUCKET: usize = 2;\n\n"
    "/// Maximum setup depth used to conjugate human-style 3-cycle commutators.\n"
    "const FMC_THREE_CYCLE_SETUP_DEPTH: u8 = 2;\n",
    "three-cycle setup constant",
)

helpers = r'''
type FmcStateKey = [u8; 40];

fn fmc_state_key(state: &CubeState) -> FmcStateKey {
    let mut key = [0u8; 40];
    key[..8].copy_from_slice(&state.cp);
    key[8..16].copy_from_slice(&state.co);
    key[16..28].copy_from_slice(&state.ep);
    key[28..40].copy_from_slice(&state.eo);
    key
}

/// Compose two cube transformations in the same order as `state.apply_moves`:
/// applying `left` and then `right` yields `left * right`.
fn compose_cube_states(left: &CubeState, right: &CubeState) -> CubeState {
    let mut result = CubeState::solved();
    for pos in 0..8 {
        let middle = right.cp[pos] as usize;
        result.cp[pos] = left.cp[middle];
        result.co[pos] = (left.co[middle] + right.co[pos]) % 3;
    }
    for pos in 0..12 {
        let middle = right.ep[pos] as usize;
        result.ep[pos] = left.ep[middle];
        result.eo[pos] = (left.eo[middle] + right.eo[pos]) & 1;
    }
    result
}

fn invert_cube_state(state: &CubeState) -> CubeState {
    let mut inverse = CubeState::solved();
    for pos in 0..8 {
        let piece = state.cp[pos] as usize;
        inverse.cp[piece] = pos as u8;
        inverse.co[piece] = (3 - state.co[pos] % 3) % 3;
    }
    for pos in 0..12 {
        let piece = state.ep[pos] as usize;
        inverse.ep[piece] = pos as u8;
        inverse.eo[piece] = state.eo[pos];
    }
    inverse
}

fn relative_cube_state(from: &CubeState, to: &CubeState) -> CubeState {
    compose_cube_states(&invert_cube_state(from), to)
}

fn enumerate_canonical_sequences(
    max_depth: u8,
    move_faces: &[u8],
    include_empty: bool,
) -> Vec<Vec<u8>> {
    fn dfs(
        path: &mut Vec<u8>,
        output: &mut Vec<Vec<u8>>,
        max_depth: u8,
        move_faces: &[u8],
        last_face: u8,
    ) {
        if !path.is_empty() {
            output.push(path.clone());
        }
        if path.len() >= max_depth as usize {
            return;
        }
        for move_index in 0..MOVE_COUNT as u8 {
            let face = move_faces[move_index as usize];
            if last_face < LAST_FACE_FREE && face == last_face {
                continue;
            }
            if last_face < LAST_FACE_FREE
                && face == OPPOSITE_FACE[last_face as usize]
                && face < last_face
            {
                continue;
            }
            path.push(move_index);
            dfs(path, output, max_depth, move_faces, face);
            path.pop();
        }
    }

    let mut output = Vec::new();
    if include_empty {
        output.push(Vec::new());
    }
    dfs(
        &mut Vec::with_capacity(max_depth as usize),
        &mut output,
        max_depth,
        move_faces,
        LAST_FACE_FREE,
    );
    output
}

fn is_pure_three_cycle_state(state: &CubeState) -> bool {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return false;
    }
    let corners = state
        .cp
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    let edges = state
        .ep
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    (corners == 3 && edges == 0) || (corners == 0 && edges == 3)
}

fn insert_shortest_algorithm(
    algorithms: &mut std::collections::HashMap<FmcStateKey, Vec<u8>>,
    state: &CubeState,
    moves: Vec<u8>,
) {
    if moves.is_empty() {
        return;
    }
    let key = fmc_state_key(state);
    match algorithms.entry(key) {
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(moves);
        }
        std::collections::hash_map::Entry::Occupied(mut entry) => {
            let current = entry.get();
            if moves.len() < current.len() || (moves.len() == current.len() && moves < *current) {
                entry.insert(moves);
            }
        }
    }
}

/// Build a compact human-style 3-cycle library. Base algorithms are commutators
/// `[A, B]` with A up to three moves and B one move. They are then conjugated
/// by canonical setups up to two moves. Only exact cube states are indexed.
fn build_three_cycle_algorithms(
    tables: &TwophaseTables,
) -> std::collections::HashMap<FmcStateKey, Vec<u8>> {
    let a_sequences = enumerate_canonical_sequences(3, &tables.move_data.move_face, false);
    let setups = enumerate_canonical_sequences(
        FMC_THREE_CYCLE_SETUP_DEPTH,
        &tables.move_data.move_face,
        true,
    );
    let mut base = std::collections::HashMap::<FmcStateKey, Vec<u8>>::new();

    for a in &a_sequences {
        let inverse_a = invert_moves(a);
        for b in 0..MOVE_COUNT as u8 {
            let mut commutator = Vec::with_capacity(a.len() * 2 + 2);
            commutator.extend_from_slice(a);
            commutator.push(b);
            commutator.extend_from_slice(&inverse_a);
            commutator.push(MOVE_INVERSE[b as usize]);
            let commutator = simplify_moves(&commutator);
            if commutator.len() < 4 {
                continue;
            }
            let state = CubeState::solved().apply_moves(&commutator, &tables.move_data);
            if !is_pure_three_cycle_state(&state) {
                continue;
            }
            insert_shortest_algorithm(&mut base, &state, commutator.clone());

            let inverse = invert_moves(&commutator);
            let inverse_state = CubeState::solved().apply_moves(&inverse, &tables.move_data);
            insert_shortest_algorithm(&mut base, &inverse_state, inverse);
        }
    }

    let base_algorithms: Vec<Vec<u8>> = base.values().cloned().collect();
    let mut result = base;
    for algorithm in base_algorithms {
        for setup in &setups {
            if setup.is_empty() {
                continue;
            }
            let mut conjugated = Vec::with_capacity(setup.len() * 2 + algorithm.len());
            conjugated.extend_from_slice(setup);
            conjugated.extend_from_slice(&algorithm);
            conjugated.extend_from_slice(&invert_moves(setup));
            let conjugated = simplify_moves(&conjugated);
            let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
            insert_shortest_algorithm(&mut result, &state, conjugated);
        }
    }
    result
}
'''

text = replace_once(
    text,
    "// --- FMC Tables ---\n\npub struct FmcTables {",
    "// --- FMC Tables ---\n\n" + helpers + "\npub struct FmcTables {",
    "FMC helper insertion",
)

text = replace_once(
    text,
    "    /// Inverse conjugation for converting solution back to original frame.\n"
    "    pub axis_solution_move_map: [[u8; 18]; 3],\n",
    "    /// Inverse conjugation for converting solution back to original frame.\n"
    "    pub axis_solution_move_map: [[u8; 18]; 3],\n"
    "    /// Human-style commutator/setup algorithms indexed by exact 3-cycle state.\n"
    "    pub three_cycle_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,\n",
    "FmcTables field",
)

text = replace_once(
    text,
    "    FmcTables {\n"
    "        co_slice_dist,\n"
    "        co_slice_first_move,\n"
    "        eo_dist,\n"
    "        dr_eo_allowed_by_last_face: dr_eo_allowed,\n"
    "        axis_scramble_move_map,\n"
    "        axis_solution_move_map,\n"
    "    }\n",
    "    let three_cycle_algorithms = build_three_cycle_algorithms(tables);\n\n"
    "    FmcTables {\n"
    "        co_slice_dist,\n"
    "        co_slice_first_move,\n"
    "        eo_dist,\n"
    "        dr_eo_allowed_by_last_face: dr_eo_allowed,\n"
    "        axis_scramble_move_map,\n"
    "        axis_solution_move_map,\n"
    "        three_cycle_algorithms,\n"
    "    }\n",
    "FmcTables construction",
)

text = replace_once(
    text,
    "    /// Whether this candidate used RZP for DR (vs direct solve)\n"
    "    pub rzp_used: bool,\n"
    "}\n",
    "    /// Whether this candidate used RZP for DR (vs direct solve)\n"
    "    pub rzp_used: bool,\n"
    "    /// Exact algorithm inserted into a 3-cycle skeleton, when applicable.\n"
    "    pub insertion_moves: Vec<u8>,\n"
    "    pub insertion_position: Option<u8>,\n"
    "    pub skeleton_kind: Option<FmcSkeletonKind>,\n"
    "}\n",
    "FmcCandidate insertion metadata",
)

pattern = re.compile(
    r"(all_candidates\.push\(FmcCandidate \{.*?)(\n\s+rzp_used,)(\n\s+\}\);)",
    re.DOTALL,
)

def add_defaults(match: re.Match) -> str:
    indent = re.search(r"\n(\s+)rzp_used,", match.group(2)).group(1)
    return (
        match.group(1)
        + match.group(2)
        + f"\n{indent}insertion_moves: vec![],"
        + f"\n{indent}insertion_position: None,"
        + f"\n{indent}skeleton_kind: None,"
        + match.group(3)
    )

text, count = pattern.subn(add_defaults, text)
if count != 4:
    raise SystemExit(f"candidate defaults: expected 4 constructors, found {count}")

insertion_code = r'''
fn optimize_skeleton_insertions(
    scramble_state: &CubeState,
    skeletons: &[FmcSkeletonCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcCandidate> {
    let mut completed = Vec::new();

    for skeleton in skeletons {
        let move_count = skeleton.moves.len();
        let mut prefix_states = Vec::with_capacity(move_count + 1);
        prefix_states.push(*scramble_state);
        for &move_index in &skeleton.moves {
            let next = prefix_states
                .last()
                .unwrap()
                .apply_move(move_index as usize, &tables.move_data);
            prefix_states.push(next);
        }

        // target_states[i] is inverse(skeleton[i..]), i.e. the state that the
        // prefix plus insertion must reach before the unchanged suffix is run.
        let mut target_states = vec![CubeState::solved(); move_count + 1];
        for index in (0..move_count).rev() {
            target_states[index] = target_states[index + 1].apply_move(
                MOVE_INVERSE[skeleton.moves[index] as usize] as usize,
                &tables.move_data,
            );
        }

        let mut best: Option<(Vec<u8>, Vec<u8>, usize)> = None;
        for position in 0..=move_count {
            let relative = relative_cube_state(&prefix_states[position], &target_states[position]);
            let Some(algorithm) = fmc_tables
                .three_cycle_algorithms
                .get(&fmc_state_key(&relative))
            else {
                continue;
            };

            let mut full = Vec::with_capacity(move_count + algorithm.len());
            full.extend_from_slice(&skeleton.moves[..position]);
            full.extend_from_slice(algorithm);
            full.extend_from_slice(&skeleton.moves[position..]);
            let full = simplify_moves(&full);
            if !scramble_state
                .apply_moves(&full, &tables.move_data)
                .is_solved()
            {
                continue;
            }

            let replace = best.as_ref().is_none_or(|(current, current_algorithm, current_pos)| {
                (full.len(), algorithm.len(), position)
                    < (current.len(), current_algorithm.len(), *current_pos)
            });
            if replace {
                best = Some((full, algorithm.clone(), position));
            }
        }

        let Some((moves, insertion_moves, insertion_position)) = best else {
            continue;
        };
        completed.push(FmcCandidate {
            moves,
            eo_len: skeleton.eo_len,
            dr_len: skeleton.dr_len,
            p2_len: skeleton.p2_len,
            eo_moves: vec![],
            dr_moves: vec![],
            finish_moves: insertion_moves.clone(),
            axis: skeleton.axis,
            source_tag: skeleton.source_tag,
            premove_moves: skeleton.premove_moves.clone(),
            rzp_used: skeleton.rzp_used,
            insertion_moves,
            insertion_position: Some(insertion_position.min(u8::MAX as usize) as u8),
            skeleton_kind: Some(skeleton.kind),
        });
    }

    completed
}
'''

text = replace_once(
    text,
    "// --- Full FMC Solver ---\n",
    insertion_code + "\n// --- Full FMC Solver ---\n",
    "skeleton insertion optimizer",
)

old_final = """    // Sort by move count
    all_candidates.sort_by_key(|c| c.moves.len());

    // Deduplicate by solution
    let mut seen = std::collections::HashSet::new();
    all_candidates.retain(|c| seen.insert(c.moves.clone()));

    // Keep top candidates
    all_candidates.truncate(10);

    let skeletons = finalize_skeleton_beam(all_skeletons);

    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
    }
"""
new_final = """    let skeletons = finalize_skeleton_beam(all_skeletons);
    let inserted_candidates = optimize_skeleton_insertions(
        &original_scramble_state,
        &skeletons,
        tables,
        fmc_tables,
    );
    all_candidates.extend(inserted_candidates);

    // Sort by final move count, preferring an insertion result on exact ties.
    all_candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.skeleton_kind.is_none(),
            candidate.source_tag,
            candidate.axis,
        )
    });

    // Deduplicate by final solution.
    let mut seen = std::collections::HashSet::new();
    all_candidates.retain(|candidate| seen.insert(candidate.moves.clone()));
    all_candidates.truncate(10);

    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
    }
"""
text = replace_once(text, old_final, new_final, "solver finalization")

start = text.index("pub fn candidate_to_json(")
end = text.index("pub fn skeleton_to_json(", start)
new_candidate_json = r'''pub fn candidate_to_json(candidate: &FmcCandidate, tables: &TwophaseTables) -> serde_json::Value {
    let solution = solution_string_from_path(&candidate.moves, &tables.move_data);
    let premove_str = if candidate.premove_moves.is_empty() {
        String::new()
    } else {
        solution_string_from_path(&candidate.premove_moves, &tables.move_data)
    };
    let base_source = match candidate.source_tag {
        0 => format!("FMC_EO_{}", AXIS_NAMES[candidate.axis as usize]),
        1 => format!("FMC_NISS_{}", AXIS_NAMES[candidate.axis as usize]),
        2 => format!("FMC_PREMOVE_{}", AXIS_NAMES[candidate.axis as usize]),
        3 => format!("FMC_PREMOVE_NISS_{}", AXIS_NAMES[candidate.axis as usize]),
        _ => "FMC_UNKNOWN".into(),
    };
    let source = if let Some(kind) = candidate.skeleton_kind {
        format!("FMC_INSERTION_{}_{}", kind.as_str().to_uppercase(), base_source)
    } else {
        base_source.clone()
    };

    let eo_moves_str: Vec<&str> = candidate
        .eo_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let dr_moves_str: Vec<&str> = candidate
        .dr_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();
    let finish_moves_str: Vec<&str> = candidate
        .finish_moves
        .iter()
        .map(|&m| tables.move_data.move_names[m as usize].as_str())
        .collect();

    let mut value = serde_json::json!({
        "ok": true,
        "solution": solution,
        "moveCount": candidate.moves.len(),
        "eoLength": candidate.eo_len,
        "drLength": candidate.dr_len,
        "p2Length": candidate.p2_len,
        "eoMoves": eo_moves_str,
        "drMoves": dr_moves_str,
        "finishMoves": finish_moves_str,
        "axisName": AXIS_NAMES[candidate.axis as usize],
        "source": source,
        "premoves": premove_str,
        "moves": solution.split_whitespace().collect::<Vec<_>>(),
        "rzpUsed": candidate.rzp_used,
    });

    if let (Some(kind), Some(position)) = (candidate.skeleton_kind, candidate.insertion_position) {
        let insertion_moves: Vec<&str> = candidate
            .insertion_moves
            .iter()
            .map(|&m| tables.move_data.move_names[m as usize].as_str())
            .collect();
        let object = value.as_object_mut().unwrap();
        object.insert("baseSource".into(), serde_json::json!(base_source));
        object.insert("skeletonKind".into(), serde_json::json!(kind.as_str()));
        object.insert("insertionPosition".into(), serde_json::json!(position));
        object.insert("insertionMoves".into(), serde_json::json!(insertion_moves));
        object.insert(
            "insertionLength".into(),
            serde_json::json!(candidate.insertion_moves.len()),
        );
    }

    value
}

'''
text = text[:start] + new_candidate_json + text[end:]

# Add composition/inverse tests to the existing skeleton test module.
test_anchor = """    #[test]
    fn rejects_mixed_or_oriented_defects() {
"""
new_tests = r'''    #[test]
    fn cube_state_inverse_and_composition_cancel() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 2;
        state.cp[2] = 0;
        state.ep[4] = 5;
        state.ep[5] = 6;
        state.ep[6] = 4;
        let inverse = invert_cube_state(&state);
        assert!(compose_cube_states(&state, &inverse).is_solved());
        assert!(compose_cube_states(&inverse, &state).is_solved());
    }

    #[test]
    fn relative_state_reconstructs_target() {
        let mut from = CubeState::solved();
        from.cp[0] = 1;
        from.cp[1] = 2;
        from.cp[2] = 0;
        let mut to = CubeState::solved();
        to.ep[0] = 1;
        to.ep[1] = 2;
        to.ep[2] = 0;
        let relative = relative_cube_state(&from, &to);
        assert_eq!(compose_cube_states(&from, &relative), to);
    }

'''
text = replace_once(text, test_anchor, new_tests + test_anchor, "state algebra tests")

path.write_text(text)

# Expose the library size in the table-build response for validation/diagnostics.
lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    "    let fmc = build_fmc_tables(tables);\n"
    "    drop(tables_guard);\n"
    "    let mut fmc_guard = FMC_TABLES.lock().unwrap();\n"
    "    *fmc_guard = Some(fmc);\n"
    "    serde_json::json!({\"ok\": true}).to_string()\n",
    "    let fmc = build_fmc_tables(tables);\n"
    "    let three_cycle_algorithm_count = fmc.three_cycle_algorithms.len();\n"
    "    drop(tables_guard);\n"
    "    let mut fmc_guard = FMC_TABLES.lock().unwrap();\n"
    "    *fmc_guard = Some(fmc);\n"
    "    serde_json::json!({\n"
    "        \"ok\": true,\n"
    "        \"threeCycleAlgorithmCount\": three_cycle_algorithm_count,\n"
    "    })\n"
    "    .to_string()\n",
    "table build diagnostics",
)
lib_path.write_text(lib)
