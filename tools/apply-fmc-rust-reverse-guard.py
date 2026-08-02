from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return source.replace(old, new, 1)


rust_path = Path("solver-wasm/src/fmc_search.rs")
rust = rust_path.read_text(encoding="utf-8")

rust = replace_once(
    rust,
    '''    result
}

// --- State Inversion ---
''',
    '''    result
}

const FMC_CANONICAL_AXIS_FACES: [[u8; 2]; 3] = [[0, 3], [1, 4], [2, 5]];

fn move_axis_from_face(face: u8) -> usize {
    match face {
        0 | 3 => 0,
        1 | 4 => 1,
        2 | 5 => 2,
        _ => unreachable!(),
    }
}

fn canonicalize_commuting_axis_blocks(input: &[u8]) -> Vec<u8> {
    let moves = simplify_moves(input);
    let mut canonical = Vec::with_capacity(moves.len());
    let mut index = 0usize;
    while index < moves.len() {
        let first_face = moves[index] / 3;
        let axis = move_axis_from_face(first_face);
        let mut amounts = [0u8; 6];
        while index < moves.len() {
            let move_index = moves[index];
            let face = move_index / 3;
            if move_axis_from_face(face) != axis {
                break;
            }
            let amount = TURN_AMOUNTS[(move_index % 3) as usize];
            amounts[face as usize] = (amounts[face as usize] + amount) & 3;
            index += 1;
        }
        for &face in &FMC_CANONICAL_AXIS_FACES[axis] {
            let amount = amounts[face as usize];
            if amount != 0 {
                canonical.push(face * 3 + turn_to_suffix(amount));
            }
        }
    }
    canonical
}

fn is_trivial_reverse_solution(solution: &[u8], reverse_scramble_canonical: &[u8]) -> bool {
    canonicalize_commuting_axis_blocks(solution) == reverse_scramble_canonical
}

fn retain_nontrivial_reverse_candidates(
    candidates: &mut Vec<FmcCandidate>,
    reverse_scramble_canonical: &[u8],
) -> usize {
    let before = candidates.len();
    candidates.retain(|candidate| {
        !is_trivial_reverse_solution(&candidate.moves, reverse_scramble_canonical)
    });
    before.saturating_sub(candidates.len())
}

// --- State Inversion ---
''',
    "Rust axis-block canonicalizer",
)

rust = replace_once(
    rust,
    '''    pub multi_switch_niss_candidate_count: usize,
}
''',
    '''    pub multi_switch_niss_candidate_count: usize,
    pub reverse_scramble_rejected_count: usize,
}
''',
    "FmcResult reverse rejection field",
)

rust = replace_once(
    rust,
    '''                multi_switch_niss_candidate_count: 0,
            }
''',
    '''                multi_switch_niss_candidate_count: 0,
                reverse_scramble_rejected_count: 0,
            }
''',
    "parse failure rejection field",
)

rust = replace_once(
    rust,
    '''    let original_scramble_state =
        CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
''',
    '''    let original_scramble_state =
        CubeState::solved().apply_moves(&scramble_moves, &tables.move_data);
    let reverse_scramble_canonical =
        canonicalize_commuting_axis_blocks(&invert_moves(&scramble_moves));
    let mut reverse_scramble_rejected_count = 0usize;
''',
    "reverse canonical initialization",
)

rust = replace_once(
    rust,
    '''    // Completed-solution pruning is separate from the raw skeleton frontier.
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    // Completed-solution pruning is separate from the raw skeleton frontier.
''',
    "filter direct and NISS candidates",
)

rust = replace_once(
    rust,
    '''            if flattened.len() < *current_best {
                *current_best = flattened.len();
            }
            output.push(FmcBoundaryNissResult {
''',
    '''            output.push(FmcBoundaryNissResult {
''',
    "defer multi-switch incumbent update",
)

rust = replace_once(
    rust,
    '''                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 8 } else { 9 },
''',
    '''                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                completed_best = completed_best.min(simplified.len());
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 8 } else { 9 },
''',
    "direct multi-switch reverse guard",
)

rust = replace_once(
    rust,
    '''                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 10 } else { 11 },
''',
    '''                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                completed_best = completed_best.min(simplified.len());
                all_candidates.push(FmcCandidate {
                    moves: simplified,
                    eo_len: result.eo_moves.len() as u8,
                    dr_len: result.dr_moves.len() as u8,
                    p2_len: result.finish_moves.len() as u8,
                    eo_moves: cvt(&result.eo_moves),
                    dr_moves: cvt(&result.dr_moves),
                    finish_moves: cvt(&result.finish_moves),
                    axis,
                    source_tag: if result.stage_tag == 0 { 10 } else { 11 },
''',
    "inverse multi-switch reverse guard",
)

rust = replace_once(
    rust,
    '''    // --- Phase 2c: complementary-frame short-P2 MITM rescue ---
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    // --- Phase 2c: complementary-frame short-P2 MITM rescue ---
''',
    "post multi-switch filter",
)

rust = replace_once(
    rust,
    '''    // --- Phase 2d: complementary-frame normal EO→DR→P2 rescue ---
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    // --- Phase 2d: complementary-frame normal EO→DR→P2 rescue ---
''',
    "post complementary MITM filter",
)

rust = replace_once(
    rust,
    '''    // --- Phase 2e: bounded pre-EO NISS switch rescue ---
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    // --- Phase 2e: bounded pre-EO NISS switch rescue ---
''',
    "post complementary normal filter",
)

rust = replace_once(
    rust,
    '''                let mut eo_metadata = result.prefix_moves.clone();
                eo_metadata.extend_from_slice(&result.eo_moves);
                all_candidates.push(FmcCandidate {
                    moves: simplified,
''',
    '''                if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                    reverse_scramble_rejected_count += 1;
                    continue;
                }
                let mut eo_metadata = result.prefix_moves.clone();
                eo_metadata.extend_from_slice(&result.eo_moves);
                all_candidates.push(FmcCandidate {
                    moves: simplified,
''',
    "pre-EO inverse reverse guard",
)

rust = replace_once(
    rust,
    '''                    let mut eo_metadata = result.prefix_moves.clone();
                    eo_metadata.extend_from_slice(&result.eo_moves);
                    all_candidates.push(FmcCandidate {
                        moves: simplified,
''',
    '''                    if is_trivial_reverse_solution(&simplified, &reverse_scramble_canonical) {
                        reverse_scramble_rejected_count += 1;
                        continue;
                    }
                    let mut eo_metadata = result.prefix_moves.clone();
                    eo_metadata.extend_from_slice(&result.eo_moves);
                    all_candidates.push(FmcCandidate {
                        moves: simplified,
''',
    "pre-EO direct reverse guard",
)

rust = replace_once(
    rust,
    '''    completed_best = all_candidates
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    completed_best = all_candidates
''',
    "pre-premove completed-best filter",
)

rust = replace_once(
    rust,
    '''    let multi_switch_niss_candidate_count = all_candidates
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut all_candidates,
        &reverse_scramble_canonical,
    );

    let multi_switch_niss_candidate_count = all_candidates
''',
    "post-premove filter",
)

rust = replace_once(
    rust,
    '''    let inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    let single_best = all_candidates
''',
    '''    let mut inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut inserted_candidates,
        &reverse_scramble_canonical,
    );
    let single_best = all_candidates
''',
    "single insertion reverse filter",
)

rust = replace_once(
    rust,
    '''    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);
''',
    '''    reverse_scramble_rejected_count += retain_nontrivial_reverse_candidates(
        &mut multi_inserted_candidates,
        &reverse_scramble_canonical,
    );
    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);
''',
    "multi insertion reverse filter",
)

rust = replace_once(
    rust,
    '''        multi_switch_niss_candidate_count,
    }
}
''',
    '''        multi_switch_niss_candidate_count,
        reverse_scramble_rejected_count,
    }
}
''',
    "final rejection count",
)

rust = replace_once(
    rust,
    '''    #[test]
    fn rejects_unsupported_or_oriented_defects() {
        let mut unsupported = CubeState::solved();
        unsupported.cp[0] = 1;
        unsupported.cp[1] = 2;
        unsupported.cp[2] = 0;
        unsupported.ep[0] = 1;
        unsupported.ep[1] = 0;
        assert_eq!(classify_insertion_leftover(&unsupported), None);

        let mut oriented = CubeState::solved();
        oriented.cp[0] = 1;
        oriented.cp[1] = 2;
        oriented.cp[2] = 0;
        oriented.co[0] = 1;
        assert_eq!(classify_insertion_leftover(&oriented), None);
    }
}
''',
    '''    #[test]
    fn rejects_unsupported_or_oriented_defects() {
        let mut unsupported = CubeState::solved();
        unsupported.cp[0] = 1;
        unsupported.cp[1] = 2;
        unsupported.cp[2] = 0;
        unsupported.ep[0] = 1;
        unsupported.ep[1] = 0;
        assert_eq!(classify_insertion_leftover(&unsupported), None);

        let mut oriented = CubeState::solved();
        oriented.cp[0] = 1;
        oriented.cp[1] = 2;
        oriented.cp[2] = 0;
        oriented.co[0] = 1;
        assert_eq!(classify_insertion_leftover(&oriented), None);
    }

    #[test]
    fn recognizes_reverse_scramble_notation_under_axis_commutation() {
        let reverse = vec![3, 10, 1, 4]; // R D' U' R'
        let reverse_canonical = canonicalize_commuting_axis_blocks(&reverse);
        assert!(is_trivial_reverse_solution(
            &[3, 1, 10, 4], // R U' D' R'
            &reverse_canonical,
        ));
        assert_eq!(
            canonicalize_commuting_axis_blocks(&[4, 0, 9, 1]), // R' U D U'
            canonicalize_commuting_axis_blocks(&[4, 9]),       // R' D
        );
        assert!(!is_trivial_reverse_solution(
            &[3, 1, 11, 4], // R U' D2 R'
            &reverse_canonical,
        ));
    }
}
''',
    "Rust reverse guard tests",
)

rust_path.write_text(rust, encoding="utf-8")

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text(encoding="utf-8")
lib = replace_once(
    lib,
    '''    if !result.ok {
        return serde_json::json!({"ok": false, "reason": "FMC_NO_SOLUTION"}).to_string();
    }
''',
    '''    if !result.ok {
        return serde_json::json!({
            "ok": false,
            "reason": "FMC_NO_SOLUTION",
            "reverseScrambleRejectedCount": result.reverse_scramble_rejected_count,
        })
        .to_string();
    }
''',
    "WASM failure rejection diagnostic",
)
lib = replace_once(
    lib,
    '''        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
''',
    '''        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "reverseScrambleRejectedCount": result.reverse_scramble_rejected_count,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
''',
    "WASM success rejection diagnostic",
)
lib_path.write_text(lib, encoding="utf-8")

js_path = Path("solver/fmcSolver.js")
js = js_path.read_text(encoding="utf-8")
js = replace_once(
    js,
    '''        const wasmResult = await solveFmcWasm(scramble, stageOptions);
        const stageElapsedMs = Date.now() - solveStartedAt;
        diagnostics.wasmStages.push({
''',
    '''        const wasmResult = await solveFmcWasm(scramble, stageOptions);
        const stageElapsedMs = Date.now() - solveStartedAt;
        const wasmReverseRejectedCount = Number.isFinite(wasmResult?.reverseScrambleRejectedCount)
          ? Math.max(0, Math.floor(wasmResult.reverseScrambleRejectedCount))
          : 0;
        if (wasmReverseRejectedCount > 0) {
          diagnostics.candidateCounts.reverseRejected += wasmReverseRejectedCount;
          diagnostics.sourceCounts.reverseRejected.WASM_INTERNAL =
            (diagnostics.sourceCounts.reverseRejected.WASM_INTERNAL || 0) + wasmReverseRejectedCount;
        }
        diagnostics.wasmStages.push({
''',
    "aggregate WASM reverse diagnostics",
)
js = replace_once(
    js,
    '''          candidateCount: Array.isArray(wasmResult?.candidates) ? wasmResult.candidates.length : 0,
          maxPremoveSets: stageOptions.maxPremoveSets,
''',
    '''          candidateCount: Array.isArray(wasmResult?.candidates) ? wasmResult.candidates.length : 0,
          reverseRejectedCount: wasmReverseRejectedCount,
          maxPremoveSets: stageOptions.maxPremoveSets,
''',
    "per-stage reverse diagnostic",
)
js_path.write_text(js, encoding="utf-8")

for cleanup_path in (
    Path(".github/workflows/apply-fmc-rust-reverse-guard-pr.yml"),
    Path("tools/apply-fmc-rust-reverse-guard.py"),
):
    if cleanup_path.exists():
        cleanup_path.unlink()
