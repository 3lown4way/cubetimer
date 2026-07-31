from pathlib import Path

root = Path(__file__).resolve().parents[1]
fmc_path = root / "solver-wasm" / "src" / "fmc_search.rs"
lib_path = root / "solver-wasm" / "src" / "lib.rs"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


fmc = fmc_path.read_text()

# Keep the prior slice cubie correction idempotent.
old_slice = '''    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 10), (9, 11)], // E2
        1 => [(1, 5), (3, 7)],   // M2
        2 => [(0, 6), (2, 4)],   // S2
        _ => unreachable!(),
    };'''
new_slice = '''    // Repository edge order: UF, UR, UB, UL, DF, DR, DB, DL, FR, FL, BR, BL.
    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 11), (9, 10)], // E2: FR↔BL, FL↔BR
        1 => [(0, 6), (2, 4)],   // M2: UF↔DB, UB↔DF
        2 => [(1, 7), (3, 5)],   // S2: UR↔DL, UL↔DR
        _ => unreachable!(),
    };'''
if old_slice in fmc:
    fmc = replace_once(fmc, old_slice, new_slice, "slice swap block")
elif new_slice not in fmc:
    raise SystemExit("slice swap block: neither old nor corrected form found")

if "pub eo_fallback_used: bool," not in fmc:
    fmc = replace_once(
        fmc,
        "    pub slice_insertion_candidate_count: usize,\n}",
        "    pub slice_insertion_candidate_count: usize,\n    pub eo_fallback_used: bool,\n}",
        "FmcResult fallback field",
    )

    start = fmc.index("pub fn solve_fmc(\n")
    marker = "\n/// Convert FmcCandidate to a JSON-friendly representation."
    end = fmc.index(marker, start)
    block = fmc[start:end]

    old_signature = '''pub fn solve_fmc(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
) -> FmcResult {'''
    new_signature = '''fn solve_fmc_with_eo_depth(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    max_eo_depth: u8,
) -> FmcResult {'''
    block = replace_once(block, old_signature, new_signature, "solve_fmc signature")

    eo_depth_uses = block.count("FMC_MAX_EO_DEPTH,")
    if eo_depth_uses != 4:
        raise SystemExit(f"EO depth call sites: expected 4, found {eo_depth_uses}")
    block = block.replace("FMC_MAX_EO_DEPTH,", "max_eo_depth,")

    block = replace_once(
        block,
        "                slice_insertion_candidate_count: 0,\n            }",
        "                slice_insertion_candidate_count: 0,\n                eo_fallback_used: false,\n            }",
        "parse failure result",
    )
    block = replace_once(
        block,
        "        slice_insertion_candidate_count,\n    }\n}",
        "        slice_insertion_candidate_count,\n        eo_fallback_used: false,\n    }\n}",
        "successful result",
    )

    wrapper = '''

/// Run the normal depth-5 human FMC profile first. Only when it produces no
/// candidate at all, retry the same pipeline with depth-6 EO coverage.
pub fn solve_fmc(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
) -> FmcResult {
    let primary = solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        FMC_MAX_EO_DEPTH,
    );
    if primary.ok {
        return primary;
    }

    let mut fallback = solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        FMC_MAX_EO_DEPTH.saturating_add(1),
    );
    fallback.eo_fallback_used = fallback.ok;
    fallback
}
'''
    fmc = fmc[:start] + block + wrapper + fmc[end:]

fmc_path.write_text(fmc)

lib = lib_path.read_text()
if '"eoFallbackUsed": result.eo_fallback_used,' not in lib:
    lib = replace_once(
        lib,
        '        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,\n',
        '        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,\n        "eoFallbackUsed": result.eo_fallback_used,\n',
        "EO fallback JSON field",
    )
lib_path.write_text(lib)

print("Applied corrected slice mapping and staged EO depth fallback")
