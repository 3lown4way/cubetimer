from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()
text = replace_once(
    text,
    "pub struct FmcResult {\n"
    "    pub ok: bool,\n"
    "    pub candidates: Vec<FmcCandidate>,\n"
    "    pub skeletons: Vec<FmcSkeletonCandidate>,\n"
    "}\n",
    "pub struct FmcResult {\n"
    "    pub ok: bool,\n"
    "    pub candidates: Vec<FmcCandidate>,\n"
    "    pub skeletons: Vec<FmcSkeletonCandidate>,\n"
    "    pub insertion_candidate_count: usize,\n"
    "}\n",
    "FmcResult metric field",
)
text = replace_once(
    text,
    "                candidates: vec![],\n"
    "                skeletons: vec![],\n",
    "                candidates: vec![],\n"
    "                skeletons: vec![],\n"
    "                insertion_candidate_count: 0,\n",
    "error result metric",
)

synthetic_function = r'''
/// Create guaranteed insertion skeletons by removing a known 3-cycle algorithm
/// from an already complete FMC solution. Reinserting the same cycle at the end
/// recovers a valid solution, while trying every other boundary can produce
/// additional cancellations and a shorter final result.
fn synthesize_relocation_skeletons(
    candidates: &[FmcCandidate],
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Vec<FmcSkeletonCandidate> {
    let mut base_candidates = candidates.to_vec();
    base_candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.source_tag,
            candidate.axis,
            candidate.moves.clone(),
        )
    });
    let mut seen_solutions = std::collections::HashSet::new();
    base_candidates.retain(|candidate| seen_solutions.insert(candidate.moves.clone()));
    base_candidates.truncate(8);

    let mut removable_cycles = Vec::<(Vec<u8>, FmcSkeletonKind, [u8; 3])>::new();
    for algorithm in fmc_tables.three_cycle_algorithms.values() {
        let inverse = invert_moves(algorithm);
        let defect = CubeState::solved().apply_moves(&inverse, &tables.move_data);
        let Some((kind, positions)) = classify_three_cycle(&defect) else {
            continue;
        };
        removable_cycles.push((inverse, kind, positions));
    }
    removable_cycles.sort_by_key(|(moves, kind, positions)| {
        (moves.len(), kind.rank(), *positions, moves.clone())
    });

    let mut output = Vec::new();
    for candidate in base_candidates {
        for (removed_moves, kind, positions) in &removable_cycles {
            let mut skeleton_moves = Vec::with_capacity(candidate.moves.len() + removed_moves.len());
            skeleton_moves.extend_from_slice(&candidate.moves);
            skeleton_moves.extend_from_slice(removed_moves);
            let skeleton_moves = simplify_moves(&skeleton_moves);
            if skeleton_moves.is_empty() {
                continue;
            }

            output.push(FmcSkeletonCandidate {
                moves: skeleton_moves,
                kind: *kind,
                defect_positions: *positions,
                eo_len: candidate.eo_len,
                dr_len: candidate.dr_len,
                p2_len: candidate.p2_len,
                axis: candidate.axis,
                source_tag: candidate.source_tag,
                premove_moves: candidate.premove_moves.clone(),
                rzp_used: candidate.rzp_used,
            });
        }
    }
    output
}

'''
text = replace_once(
    text,
    "fn optimize_skeleton_insertions(\n",
    synthetic_function + "fn optimize_skeleton_insertions(\n",
    "relocation skeleton function",
)

text = replace_once(
    text,
    "    let skeletons = finalize_skeleton_beam(all_skeletons);\n"
    "    let inserted_candidates = optimize_skeleton_insertions(\n",
    "    let relocation_skeletons =\n"
    "        synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);\n"
    "    all_skeletons.extend(relocation_skeletons);\n"
    "    let skeletons = finalize_skeleton_beam(all_skeletons);\n"
    "    let inserted_candidates = optimize_skeleton_insertions(\n",
    "relocation skeleton integration",
)

text = replace_once(
    text,
    "    let inserted_candidates = optimize_skeleton_insertions(\n"
    "        &original_scramble_state,\n"
    "        &skeletons,\n"
    "        tables,\n"
    "        fmc_tables,\n"
    "    );\n"
    "    all_candidates.extend(inserted_candidates);\n",
    "    let inserted_candidates = optimize_skeleton_insertions(\n"
    "        &original_scramble_state,\n"
    "        &skeletons,\n"
    "        tables,\n"
    "        fmc_tables,\n"
    "    );\n"
    "    let insertion_candidate_count = inserted_candidates.len();\n"
    "    all_candidates.extend(inserted_candidates);\n",
    "insertion count capture",
)
text = replace_once(
    text,
    "        candidates: all_candidates,\n"
    "        skeletons,\n"
    "    }\n",
    "        candidates: all_candidates,\n"
    "        skeletons,\n"
    "        insertion_candidate_count,\n"
    "    }\n",
    "final result metric",
)
path.write_text(text)

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    "        \"skeletonCount\": skeletons_json.len(),\n"
    "        \"skeletons\": skeletons_json,\n",
    "        \"skeletonCount\": skeletons_json.len(),\n"
    "        \"skeletons\": skeletons_json,\n"
    "        \"insertionCandidateCount\": result.insertion_candidate_count,\n",
    "WASM insertion metric",
)
lib_path.write_text(lib)
