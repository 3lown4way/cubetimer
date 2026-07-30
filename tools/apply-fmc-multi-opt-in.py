from pathlib import Path

root = Path(__file__).resolve().parents[1]
lib_path = root / "solver-wasm" / "src" / "lib.rs"
fmc_path = root / "solver-wasm" / "src" / "fmc_search.rs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


lib = lib_path.read_text()
if "enable_multi_insertion: bool" not in lib:
    lib = replace_once(
        lib,
        '''    #[serde(rename = "forceRzp", default)]
    force_rzp: bool,
''',
        '''    #[serde(rename = "forceRzp", default)]
    force_rzp: bool,
    #[serde(rename = "enableMultiInsertion", default)]
    enable_multi_insertion: bool,
''',
        "lib options",
    )
    lib = replace_once(
        lib,
        '''        options.max_premove_sets,
        options.force_rzp,
    );
''',
        '''        options.max_premove_sets,
        options.force_rzp,
        options.enable_multi_insertion,
    );
''',
        "lib solve call",
    )
    lib_path.write_text(lib)

fmc = fmc_path.read_text()
if "enable_multi_insertion: bool" not in fmc:
    fmc = replace_once(
        fmc,
        '''    max_premove_sets: usize,
    force_rzp: bool,
) -> FmcResult {
''',
        '''    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
) -> FmcResult {
''',
        "solve signature",
    )
    fmc = replace_once(
        fmc,
        '''    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);
    all_skeletons.extend(relocation_skeletons);
    let multi_relocation_skeletons =
        synthesize_multi_relocation_skeletons(&all_candidates, fmc_tables);
    all_skeletons.extend(multi_relocation_skeletons);
    let skeletons = finalize_skeleton_beam(all_skeletons);

    let inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    let single_best = all_candidates
        .iter()
        .chain(inserted_candidates.iter())
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    let mut multi_inserted_candidates = optimize_multi_skeleton_insertions(
        &original_scramble_state,
        &skeletons,
        tables,
        fmc_tables,
    );
    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);
''',
        '''    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);
    all_skeletons.extend(relocation_skeletons);
    if enable_multi_insertion {
        let multi_relocation_skeletons =
            synthesize_multi_relocation_skeletons(&all_candidates, fmc_tables);
        all_skeletons.extend(multi_relocation_skeletons);
    } else {
        all_skeletons.retain(|skeleton| skeleton.kind.is_single_insertion());
    }
    let skeletons = finalize_skeleton_beam(all_skeletons);

    let inserted_candidates =
        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);
    let single_best = all_candidates
        .iter()
        .chain(inserted_candidates.iter())
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX);
    let mut multi_inserted_candidates = if enable_multi_insertion {
        optimize_multi_skeleton_insertions(
            &original_scramble_state,
            &skeletons,
            tables,
            fmc_tables,
        )
    } else {
        Vec::new()
    };
    multi_inserted_candidates.retain(|candidate| candidate.moves.len() <= single_best);
''',
        "multi insertion gate",
    )
    fmc_path.write_text(fmc)

print("FMC multi-insertion opt-in transform applied")
