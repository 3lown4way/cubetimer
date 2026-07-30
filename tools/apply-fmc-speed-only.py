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
    "use crate::twophase_search::{solve_phase2, Phase2Input};\n",
    "use crate::twophase_search::{solve_phase2, Phase2Input};\nuse once_cell::sync::Lazy;\n",
    "lazy import",
)

replace_once(
    """    sets
}

// --- Result Types ---
""",
    """    sets
}

static FMC_PREMOVE_SETS: Lazy<Vec<Vec<u8>>> = Lazy::new(build_premove_sets);

// --- Result Types ---
""",
    "static premove sets",
)

replace_once(
    """    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut best_count = 40usize;

    // --- Phase 1: Direct solve across 3 axes ---
""",
    """    let inv_scramble_moves = invert_moves(&scramble_moves);
    let direct_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {
        let conjugated: Vec<u8> = scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
            .collect();
        CubeState::solved().apply_moves(&conjugated, &tables.move_data)
    });
    let inverse_axis_states: [CubeState; 3] = std::array::from_fn(|axis| {
        let conjugated: Vec<u8> = inv_scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
            .collect();
        CubeState::solved().apply_moves(&conjugated, &tables.move_data)
    });

    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut best_count = 40usize;

    // --- Phase 1: Direct solve across 3 axes ---
""",
    "precompute axis states",
)

replace_once(
    """    for axis in 0..3u8 {
        let conjugated: Vec<u8> = scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis as usize][m as usize])
            .collect();
        let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);

        let results = solve_fmc_single_axis(
            &state,
""",
    """    for axis in 0..3u8 {
        let state = &direct_axis_states[axis as usize];

        let results = solve_fmc_single_axis(
            state,
""",
    "direct base state",
)

replace_once(
    """    // --- Phase 2: NISS (inverse scramble) across 3 axes ---
    let inv_scramble_moves = invert_moves(&scramble_moves);
    for axis in 0..3u8 {
        let conjugated: Vec<u8> = inv_scramble_moves
            .iter()
            .map(|&m| fmc_tables.axis_scramble_move_map[axis as usize][m as usize])
            .collect();
        let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);

        let results = solve_fmc_single_axis(
            &state,
""",
    """    // --- Phase 2: NISS (inverse scramble) across 3 axes ---
    for axis in 0..3u8 {
        let state = &inverse_axis_states[axis as usize];

        let results = solve_fmc_single_axis(
            state,
""",
    "inverse base state",
)

replace_once(
    """    // --- Phase 3: Premove sweep ---
    let premove_sets = build_premove_sets();
    let pm_limit = max_premove_sets.min(premove_sets.len());

    for pm_idx in 0..pm_limit {
        let pm_set = &premove_sets[pm_idx];

        // Direct with premoves: effective = scramble + premoves
        {
            let mut effective = scramble_moves.clone();
            effective.extend_from_slice(pm_set);

            for axis in 0..3u8 {
                let conjugated: Vec<u8> = effective
                    .iter()
                    .map(|&m| fmc_tables.axis_scramble_move_map[axis as usize][m as usize])
                    .collect();
                let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
""",
    """    // --- Phase 3: Premove sweep ---
    let premove_sets = &*FMC_PREMOVE_SETS;
    let pm_limit = max_premove_sets.min(premove_sets.len());

    for pm_idx in 0..pm_limit {
        let pm_set = &premove_sets[pm_idx];
        let axis_premoves: [Vec<u8>; 3] = std::array::from_fn(|axis| {
            pm_set
                .iter()
                .map(|&m| fmc_tables.axis_scramble_move_map[axis][m as usize])
                .collect()
        });

        // Direct with premoves: apply only the 1-2 premoves to the cached axis state.
        {
            for axis in 0..3u8 {
                let state = direct_axis_states[axis as usize]
                    .apply_moves(&axis_premoves[axis as usize], &tables.move_data);
""",
    "direct premove state reuse",
)

replace_once(
    """        // NISS with premoves: effective = inv_scramble + premoves
        {
            let mut inv_effective = inv_scramble_moves.clone();
            inv_effective.extend_from_slice(pm_set);

            for axis in 0..3u8 {
                let conjugated: Vec<u8> = inv_effective
                    .iter()
                    .map(|&m| fmc_tables.axis_scramble_move_map[axis as usize][m as usize])
                    .collect();
                let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
""",
    """        // NISS with premoves: apply only the 1-2 premoves to the cached inverse-axis state.
        {
            for axis in 0..3u8 {
                let state = inverse_axis_states[axis as usize]
                    .apply_moves(&axis_premoves[axis as usize], &tables.move_data);
""",
    "inverse premove state reuse",
)

path.write_text(text, encoding="utf-8")
