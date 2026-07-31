from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEARCH = ROOT / "solver-wasm" / "src" / "fmc_search.rs"
LIB = ROOT / "solver-wasm" / "src" / "lib.rs"
WRAPPER = ROOT / "solver" / "wasmSolver.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


s = SEARCH.read_text()

s = replace_once(
    s,
    "    force_rzp: bool,\n) -> Vec<FmcNissBoundary> {",
    "    force_rzp: bool,\n    include_dr_boundaries: bool,\n) -> Vec<FmcNissBoundary> {",
    "boundary collector option",
)

s = replace_once(
    s,
    "    [best_eo, best_dr].into_iter().flatten().collect()",
    "    [\n"
    "        best_eo,\n"
    "        if include_dr_boundaries { best_dr } else { None },\n"
    "    ]\n"
    "    .into_iter()\n"
    "    .flatten()\n"
    "    .collect()",
    "boundary selection",
)

s = replace_once(
    s,
    "    current_best: &mut usize,\n    force_rzp: bool,\n) -> Vec<FmcBoundaryNissResult> {",
    "    current_best: &mut usize,\n"
    "    force_rzp: bool,\n"
    "    include_dr_boundaries: bool,\n"
    ") -> Vec<FmcBoundaryNissResult> {",
    "single-axis option",
)

s = replace_once(
    s,
    "        *current_best,\n        force_rzp,\n    );",
    "        *current_best,\n"
    "        force_rzp,\n"
    "        include_dr_boundaries,\n"
    "    );",
    "collector call",
)

s = replace_once(
    s,
    "    enable_slice_insertion: bool,\n    enable_multi_switch_niss: bool,\n    max_eo_depth: u8,",
    "    enable_slice_insertion: bool,\n"
    "    enable_multi_switch_niss: bool,\n"
    "    enable_deep_multi_switch_niss: bool,\n"
    "    max_eo_depth: u8,",
    "internal solver deep option",
)

s = replace_once(
    s,
    "    if enable_multi_switch_niss {\n",
    "    if enable_multi_switch_niss || enable_deep_multi_switch_niss {\n",
    "phase enable condition",
)

# Two boundary solver calls have the same tail. Add the deep flag to both.
old_call_tail = "                &mut best_count,\n                force_rzp,\n            );"
new_call_tail = "                &mut best_count,\n                force_rzp,\n                enable_deep_multi_switch_niss,\n            );"
count = s.count(old_call_tail)
if count != 2:
    raise SystemExit(f"boundary solver calls: expected two matches, found {count}")
s = s.replace(old_call_tail, new_call_tail, 2)

s = replace_once(
    s,
    "    enable_slice_insertion: bool,\n    enable_multi_switch_niss: bool,\n) -> FmcResult {",
    "    enable_slice_insertion: bool,\n"
    "    enable_multi_switch_niss: bool,\n"
    "    enable_deep_multi_switch_niss: bool,\n"
    ") -> FmcResult {",
    "public solver deep option",
)

# Pass deep flag to the depth-5 and depth-6 internal runs.
old_primary = "        enable_slice_insertion,\n        enable_multi_switch_niss,\n        FMC_MAX_EO_DEPTH,"
new_primary = (
    "        enable_slice_insertion,\n"
    "        enable_multi_switch_niss,\n"
    "        enable_deep_multi_switch_niss,\n"
    "        FMC_MAX_EO_DEPTH,"
)
s = replace_once(s, old_primary, new_primary, "primary deep pass")

old_fallback = (
    "        enable_slice_insertion,\n"
    "        enable_multi_switch_niss,\n"
    "        FMC_MAX_EO_DEPTH.saturating_add(1),"
)
new_fallback = (
    "        enable_slice_insertion,\n"
    "        enable_multi_switch_niss,\n"
    "        enable_deep_multi_switch_niss,\n"
    "        FMC_MAX_EO_DEPTH.saturating_add(1),"
)
s = replace_once(s, old_fallback, new_fallback, "fallback deep pass")

SEARCH.write_text(s)

lib = LIB.read_text()
lib = replace_once(
    lib,
    '    #[serde(rename = "enableMultiSwitchNiss", default)]\n    enable_multi_switch_niss: bool,',
    '    #[serde(rename = "enableMultiSwitchNiss", default)]\n'
    '    enable_multi_switch_niss: bool,\n'
    '    #[serde(rename = "enableDeepMultiSwitchNiss", default)]\n'
    '    enable_deep_multi_switch_niss: bool,',
    "lib deep option",
)
lib = replace_once(
    lib,
    "        options.enable_slice_insertion,\n        options.enable_multi_switch_niss,\n    );",
    "        options.enable_slice_insertion,\n"
    "        options.enable_multi_switch_niss,\n"
    "        options.enable_deep_multi_switch_niss,\n"
    "    );",
    "lib deep solver call",
)
LIB.write_text(lib)

wrapper = WRAPPER.read_text()
wrapper = replace_once(
    wrapper,
    "      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,",
    "      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,\n"
    "      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,",
    "wrapper deep option",
)
WRAPPER.write_text(wrapper)

print("Tiered FMC multi-switch NISS into EO-only and deep EO+DR modes")
