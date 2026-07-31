from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "solver-wasm/src/fmc_search.rs"
text = PATH.read_text()

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

# Restore level-0 constants if broad call-site replacement touched the profile
# declarations. These substitutions are intentionally idempotent.
profile_fixes = [
    (r"(let\s+direct_eo_limit\s*=\s*\[\s*)direct_eo_limit\b", r"\1FMC_EO_LIMIT"),
    (r"(let\s+premove_eo_limit\s*=\s*\[\s*)premove_eo_limit\b", r"\1FMC_PM_EO_LIMIT"),
    (r"(let\s+p2_node_limit\s*=\s*\[\s*)p2_node_limit\b", r"\1FMC_P2_NODE_LIMIT"),
    (
        r"(let\s+premove_p2_node_limit\s*=\s*\[\s*)premove_p2_node_limit\b",
        r"\1FMC_PM_P2_NODE_LIMIT",
    ),
]
for pattern, replacement in profile_fixes:
    text = re.sub(pattern, replacement, text, count=1, flags=re.S)

# Multi-switch NISS remains deterministic in this stage. Search diversification
# comes from EO move ordering, EO candidate buckets, and premove ordering; do not
# add an argument that the multi-switch helper does not accept.

PATH.write_text(text)
print("Fixed FMC Extreme human-anytime transform anchors")
