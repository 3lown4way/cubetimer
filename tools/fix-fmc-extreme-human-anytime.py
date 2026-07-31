from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver-wasm/src/fmc_search.rs"
text = PATH.read_text()


def replace_once(source, old, new, label):
    if old not in source:
        raise SystemExit(f"MISSING:{label}")
    return source.replace(old, new, 1)

# The first transform's generic signature anchor matches the multi-switch helper.
# Keep that variant parameter, and add the intended parameter to the actual
# EO→DR→P2 single-axis search as well.
text = replace_once(
    text,
    '''fn solve_fmc_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    eo_limit: usize,
    max_dr_depth: u8,
    max_p2_depth: u8,
    p2_node_limit: u64,
    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    force_rzp: bool,
''',
    '''fn solve_fmc_single_axis(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_eo_depth: u8,
    eo_limit: usize,
    max_dr_depth: u8,
    max_p2_depth: u8,
    p2_node_limit: u64,
    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    search_variant: u32,
    force_rzp: bool,
''',
    "single-axis variant signature",
)

# Global replacement inside solve_fmc_with_eo_depth also touched the newly
# inserted profile tables. Restore their level-0 constants.
for wrong, right, label in [
    ("[direct_eo_limit, 12, 24, 48]", "[FMC_EO_LIMIT, 12, 24, 48]", "direct EO profile"),
    ("[premove_eo_limit, 6, 12, 24]", "[FMC_PM_EO_LIMIT, 6, 12, 24]", "premove EO profile"),
    (
        "[p2_node_limit, 8_000_000, 24_000_000, 64_000_000]",
        "[FMC_P2_NODE_LIMIT, 8_000_000, 24_000_000, 64_000_000]",
        "direct P2 profile",
    ),
    (
        "[premove_p2_node_limit, 2_000_000, 8_000_000, 20_000_000]",
        "[FMC_PM_P2_NODE_LIMIT, 2_000_000, 8_000_000, 20_000_000]",
        "premove P2 profile",
    ),
]:
    text = replace_once(text, wrong, right, label)

# The multi-switch helper intentionally gained a search_variant parameter.
# Thread a distinct deterministic variant into direct and inverse boundary
# continuation searches.
text = replace_once(
    text,
    '''            let direct_results = solve_multi_switch_niss_single_axis(
                &direct_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                force_rzp,
                enable_deep_multi_switch_niss,
            );
''',
    '''            let direct_results = solve_multi_switch_niss_single_axis(
                &direct_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                search_variant.wrapping_add(3001 + axis as u32 * 17),
                force_rzp,
                enable_deep_multi_switch_niss,
            );
''',
    "direct multi-switch variant",
)
text = replace_once(
    text,
    '''            let inverse_results = solve_multi_switch_niss_single_axis(
                &inverse_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                force_rzp,
                enable_deep_multi_switch_niss,
            );
''',
    '''            let inverse_results = solve_multi_switch_niss_single_axis(
                &inverse_axis_states[axis as usize],
                tables,
                fmc_tables,
                max_eo_depth,
                &mut p2_cache,
                &mut best_count,
                search_variant.wrapping_add(4001 + axis as u32 * 17),
                force_rzp,
                enable_deep_multi_switch_niss,
            );
''',
    "inverse multi-switch variant",
)

PATH.write_text(text)
print("Fixed FMC Extreme human-anytime transform anchors")
