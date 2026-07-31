from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver-wasm/src/fmc_search.rs"
text = PATH.read_text()


def replace_once(source, old, new, label):
    if old not in source:
        raise SystemExit(f"MISSING:{label}")
    return source.replace(old, new, 1)


def regex_once(source, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"MISSING:{label}")
    return updated

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

# Global call-site replacement also touches the newly inserted level tables.
# Restore their level-0 constants while accepting rustfmt line wrapping.
profiles = [
    (
        r"(let\s+direct_eo_limit\s*=\s*\[\s*)direct_eo_limit(\s*,\s*12\s*,\s*24\s*,\s*48\s*\])",
        r"\1FMC_EO_LIMIT\2",
        "direct EO profile",
    ),
    (
        r"(let\s+premove_eo_limit\s*=\s*\[\s*)premove_eo_limit(\s*,\s*6\s*,\s*12\s*,\s*24\s*\])",
        r"\1FMC_PM_EO_LIMIT\2",
        "premove EO profile",
    ),
    (
        r"(let\s+p2_node_limit\s*=\s*\[\s*)p2_node_limit(\s*,\s*8_000_000\s*,\s*24_000_000\s*,\s*64_000_000\s*\])",
        r"\1FMC_P2_NODE_LIMIT\2",
        "direct P2 profile",
    ),
    (
        r"(let\s+premove_p2_node_limit\s*=\s*\[\s*)premove_p2_node_limit(\s*,\s*2_000_000\s*,\s*8_000_000\s*,\s*20_000_000\s*\])",
        r"\1FMC_PM_P2_NODE_LIMIT\2",
        "premove P2 profile",
    ),
]
for pattern, replacement, label in profiles:
    text = regex_once(text, pattern, replacement, label)

# The multi-switch helper intentionally gained a search_variant parameter.
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
