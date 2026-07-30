from pathlib import Path
import re

path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


def sub_once(pattern: str, replacement: str, label: str) -> None:
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one regex match, found {count}")


replace_once(
    "use crate::twophase_bundle::TwophaseTables;\n",
    "use crate::twophase_bundle::TwophaseTables;\nuse once_cell::sync::Lazy;\n",
    "lazy import",
)

replace_once(
    "\n// --- Result Types ---\n",
    "\nstatic FMC_PREMOVE_SETS: Lazy<Vec<Vec<u8>>> = Lazy::new(build_premove_sets);\n\n// --- Result Types ---\n",
    "static premove sets",
)

replace_once(
    "    let premove_sets = build_premove_sets();\n",
    "    let premove_sets = &*FMC_PREMOVE_SETS;\n",
    "reuse premove sets",
)

replace_once(
    "    let mut all_candidates: Vec<FmcCandidate> = Vec::new();\n    let mut best_count = 40usize;\n\n    // --- Phase 1: Direct solve across 3 axes ---\n",
    "    let mut all_candidates: Vec<FmcCandidate> = Vec::new();\n    let mut best_count = 40usize;\n\n    // Build each axis base state once. Premove variants append only their 1-2\n    // conjugated moves instead of replaying the full scramble for every attempt.\n    let direct_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {\n        let conjugated: Vec<u8> = scramble_moves\n            .iter()\n            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])\n            .collect();\n        CubeState::solved().apply_moves(&conjugated, &tables.move_data)\n    });\n\n    // --- Phase 1: Direct solve across 3 axes ---\n",
    "direct base states",
)

sub_once(
    r"    for axis in 0\.\.3u8 \{\n        let conjugated: Vec<u8> = scramble_moves\n            \.iter\(\)\n            \.map\(\|&m\| fmc_tables\.axis_scramble_move_map\[axis as usize\]\[m as usize\]\)\n            \.collect\(\);\n        let state = CubeState::solved\(\)\.apply_moves\(&conjugated, &tables\.move_data\);",
    "    for axis in 0..3u8 {\n        let state = direct_axis_states[axis as usize];",
    "direct state reuse",
)

sub_once(
    r"    // --- Phase 2: NISS \(inverse scramble\) across 3 axes ---\n    let inv_scramble_moves = invert_moves\(&scramble_moves\);\n    for axis in 0\.\.3u8 \{\n        let conjugated: Vec<u8> = inv_scramble_moves\n            \.iter\(\)\n            \.map\(\|&m\| fmc_tables\.axis_scramble_move_map\[axis as usize\]\[m as usize\]\)\n            \.collect\(\);\n        let state = CubeState::solved\(\)\.apply_moves\(&conjugated, &tables\.move_data\);",
    "    // --- Phase 2: NISS (inverse scramble) across 3 axes ---\n    let inv_scramble_moves = invert_moves(&scramble_moves);\n    let inverse_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {\n        let conjugated: Vec<u8> = inv_scramble_moves\n            .iter()\n            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])\n            .collect();\n        CubeState::solved().apply_moves(&conjugated, &tables.move_data)\n    });\n    for axis in 0..3u8 {\n        let state = inverse_axis_states[axis as usize];",
    "inverse state reuse",
)

replace_once(
    "    for pm_idx in 0..pm_limit {\n        let pm_set = &premove_sets[pm_idx];\n\n        // Direct with premoves: effective = scramble + premoves\n",
    "    for pm_idx in 0..pm_limit {\n        let pm_set = &premove_sets[pm_idx];\n        let conjugated_premoves: [Vec<u8>; 3] = std::array::from_fn(|axis| {\n            pm_set\n                .iter()\n                .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])\n                .collect()\n        });\n\n        // Direct with premoves: effective = scramble + premoves\n",
    "conjugated premoves",
)

sub_once(
    r"        \{\n            let mut effective = scramble_moves\.clone\(\);\n            effective\.extend_from_slice\(pm_set\);\n\n            for axis in 0\.\.3u8 \{\n                let conjugated: Vec<u8> = effective\n                    \.iter\(\)\n                    \.map\(\|&m\| fmc_tables\.axis_scramble_move_map\[axis as usize\]\[m as usize\]\)\n                    \.collect\(\);\n                let state = CubeState::solved\(\)\.apply_moves\(&conjugated, &tables\.move_data\);",
    "        {\n            for axis in 0..3u8 {\n                let state = direct_axis_states[axis as usize]\n                    .apply_moves(&conjugated_premoves[axis as usize], &tables.move_data);",
    "direct premove state reuse",
)

sub_once(
    r"        \{\n            let mut inv_effective = inv_scramble_moves\.clone\(\);\n            inv_effective\.extend_from_slice\(pm_set\);\n\n            for axis in 0\.\.3u8 \{\n                let conjugated: Vec<u8> = inv_effective\n                    \.iter\(\)\n                    \.map\(\|&m\| fmc_tables\.axis_scramble_move_map\[axis as usize\]\[m as usize\]\)\n                    \.collect\(\);\n                let state = CubeState::solved\(\)\.apply_moves\(&conjugated, &tables\.move_data\);",
    "        {\n            for axis in 0..3u8 {\n                let state = inverse_axis_states[axis as usize]\n                    .apply_moves(&conjugated_premoves[axis as usize], &tables.move_data);",
    "inverse premove state reuse",
)

path.write_text(text, encoding="utf-8")
