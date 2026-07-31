from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver-wasm/src/fmc_search.rs"
text = PATH.read_text()


def replace_once(source, old, new, label):
    if old not in source:
        raise SystemExit(f"MISSING:{label}")
    return source.replace(old, new, 1)

# The first transform's generic signature anchor can match a neighboring helper.
# Locate the actual EO→DR→P2 function and patch only its signature block.
single_start = text.index("fn solve_fmc_single_axis(")
single_end = text.index(") -> Vec<(\n", single_start)
single_header = text[single_start:single_end]
if "search_variant: u32" not in single_header:
    old_pair = "    current_best: &mut usize,\n    force_rzp: bool,\n"
    new_pair = "    current_best: &mut usize,\n    search_variant: u32,\n    force_rzp: bool,\n"
    if old_pair not in single_header:
        raise SystemExit("MISSING:single-axis current-best pair")
    single_header = single_header.replace(old_pair, new_pair, 1)
    text = text[:single_start] + single_header + text[single_end:]

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
# Thread distinct deterministic variants into direct and inverse boundary
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
