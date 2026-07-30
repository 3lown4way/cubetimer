from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "static FMC_PREMOVE_SETS: Lazy<Vec<Vec<u8>>> = Lazy::new(build_premove_sets);",
    """struct FmcPremoveSet {
    moves: Vec<u8>,
    axis_moves: [Vec<u8>; 3],
}

static FMC_PREMOVE_SETS: Lazy<Vec<FmcPremoveSet>> = Lazy::new(|| {
    let axis_maps: [[u8; 18]; 3] = std::array::from_fn(|axis| {
        build_move_conjugation(&AXIS_SCRAMBLE_MAPS_JS[axis])
    });
    build_premove_sets()
        .into_iter()
        .map(|moves| {
            let axis_moves: [Vec<u8>; 3] = std::array::from_fn(|axis| {
                moves
                    .iter()
                    .map(|&m| axis_maps[axis][m as usize])
                    .collect()
            });
            FmcPremoveSet { moves, axis_moves }
        })
        .collect()
});""",
    "precomputed premove maps",
)

replace_once(
    """    for pm_idx in 0..pm_limit {
        let pm_set = &premove_sets[pm_idx];
        let conjugated_premoves: [Vec<u8>; 3] = std::array::from_fn(|axis| {
            pm_set
                .iter()
                .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
                .collect()
        });
""",
    """    for pm_idx in 0..pm_limit {
        let premove = &premove_sets[pm_idx];
        let pm_set = &premove.moves;
        let conjugated_premoves = &premove.axis_moves;
""",
    "reuse premove maps",
)

path.write_text(text, encoding="utf-8")
