from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


fmc_path = Path("solver-wasm/src/fmc_search.rs")
fmc = fmc_path.read_text()

fmc = replace_once(
    fmc,
    "/// Maximum setup depth used to conjugate human-style 3-cycle commutators.\nconst FMC_THREE_CYCLE_SETUP_DEPTH: u8 = 2;",
    "/// Maximum setup depth used to conjugate human-style 3-cycle commutators.\nconst FMC_THREE_CYCLE_SETUP_DEPTH: u8 = 2;\n\n/// Maximum setup depth used to relocate PLL-style 2C2E algorithms.\nconst FMC_TWO_CORNER_TWO_EDGE_SETUP_DEPTH: u8 = 4;\n\n/// Cap synthetic 2C2E relocation skeletons after deterministic length sorting.\nconst FMC_RELOCATION_2C2E_LIMIT: usize = 256;",
    "constants",
)

mixed_library = r'''
fn is_two_corner_two_edge_state(state: &CubeState) -> bool {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return false;
    }
    let corners = state
        .cp
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    let edges = state
        .ep
        .iter()
        .enumerate()
        .filter(|(position, piece)| **piece as usize != *position)
        .count();
    corners == 2 && edges == 2
}

/// Build a deterministic 2C2E library from standard PLL-style double swaps and
/// canonical conjugating setups. Multiple base families are retained because
/// orientation-preserving 2C2E states split into practical setup classes.
fn build_two_corner_two_edge_algorithms(
    tables: &TwophaseTables,
) -> std::collections::HashMap<FmcStateKey, Vec<u8>> {
    // T, Jb, Ra, Rb and F permutations in the repository move convention.
    // Every sequence is effect-checked before it is admitted to the library.
    let base_sequences: [Vec<u8>; 5] = [
        vec![3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 7],
        vec![3, 0, 4, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1],
        vec![3, 1, 4, 1, 3, 0, 3, 9, 4, 1, 3, 10, 4, 2, 4],
        vec![4, 2, 3, 2, 4, 6, 3, 0, 4, 1, 4, 7, 5, 1],
        vec![4, 1, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 0, 3],
    ];
    let setups = enumerate_canonical_sequences(
        FMC_TWO_CORNER_TWO_EDGE_SETUP_DEPTH,
        &tables.move_data.move_face,
        true,
    );
    let mut result = std::collections::HashMap::<FmcStateKey, Vec<u8>>::new();

    for base in base_sequences {
        let base = simplify_moves(&base);
        let base_state = CubeState::solved().apply_moves(&base, &tables.move_data);
        if !is_two_corner_two_edge_state(&base_state) {
            continue;
        }

        let mut variants = vec![base.clone(), invert_moves(&base)];
        variants.sort();
        variants.dedup();
        for algorithm in variants {
            for setup in &setups {
                let mut conjugated = Vec::with_capacity(setup.len() * 2 + algorithm.len());
                conjugated.extend_from_slice(setup);
                conjugated.extend_from_slice(&algorithm);
                conjugated.extend_from_slice(&invert_moves(setup));
                let conjugated = simplify_moves(&conjugated);
                let state = CubeState::solved().apply_moves(&conjugated, &tables.move_data);
                if is_two_corner_two_edge_state(&state) {
                    insert_shortest_algorithm(&mut result, &state, conjugated);
                }
            }
        }
    }

    result
}
'''

fmc = replace_once(
    fmc,
    "    result\n}\n\npub struct FmcTables {",
    "    result\n}\n\n" + mixed_library + "\npub struct FmcTables {",
    "mixed library insertion",
)

fmc = replace_once(
    fmc,
    "    /// Human-style commutator/setup algorithms indexed by exact 3-cycle state.\n    pub three_cycle_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,",
    "    /// Human-style commutator/setup algorithms indexed by exact 3-cycle state.\n    pub three_cycle_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,\n    /// PLL-style algorithms indexed by exact orientation-preserving 2C2E state.\n    pub two_corner_two_edge_algorithms: std::collections::HashMap<FmcStateKey, Vec<u8>>,",
    "FmcTables field",
)

fmc = replace_once(
    fmc,
    "    let three_cycle_algorithms = build_three_cycle_algorithms(tables);\n\n    FmcTables {",
    "    let three_cycle_algorithms = build_three_cycle_algorithms(tables);\n    let two_corner_two_edge_algorithms = build_two_corner_two_edge_algorithms(tables);\n\n    FmcTables {",
    "table construction",
)

fmc = replace_once(
    fmc,
    "        axis_solution_move_map,\n        three_cycle_algorithms,\n    }",
    "        axis_solution_move_map,\n        three_cycle_algorithms,\n        two_corner_two_edge_algorithms,\n    }",
    "table initialization",
)

enum_pattern = re.compile(
    r"#\[derive\(Clone, Copy, Debug, PartialEq, Eq, Hash\)\]\npub enum FmcSkeletonKind \{.*?\n\}\n\nimpl FmcSkeletonKind \{.*?\n\}\n",
    re.S,
)
enum_replacement = '''#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FmcSkeletonKind {
    Corner3,
    Edge3,
    Corner2Edge2,
}

impl FmcSkeletonKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Corner3 => "corner3",
            Self::Edge3 => "edge3",
            Self::Corner2Edge2 => "corner2edge2",
        }
    }

    fn rank(self) -> u8 {
        match self {
            Self::Corner3 => 0,
            Self::Edge3 => 1,
            Self::Corner2Edge2 => 2,
        }
    }

    fn estimated_insertion_cost(self) -> usize {
        match self {
            Self::Corner3 | Self::Edge3 => 8,
            Self::Corner2Edge2 => 14,
        }
    }
}
'''
fmc, count = enum_pattern.subn(enum_replacement, fmc, count=1)
if count != 1:
    raise RuntimeError(f"skeleton enum: expected one replacement, found {count}")

classifier_pattern = re.compile(
    r"fn classify_three_cycle\(state: &CubeState\) -> Option<\(FmcSkeletonKind, \[u8; 3\]\)> \{.*?\n\}\n\nfn collect_axis_skeleton_prefixes",
    re.S,
)
classifier_replacement = '''fn classify_insertion_leftover(state: &CubeState) -> Option<(FmcSkeletonKind, Vec<u8>)> {
    if state.co.iter().any(|&v| v != 0) || state.eo.iter().any(|&v| v != 0) {
        return None;
    }

    let corner_misplaced: Vec<u8> = state
        .cp
        .iter()
        .enumerate()
        .filter_map(|(i, &piece)| (piece as usize != i).then_some(i as u8))
        .collect();
    let edge_misplaced: Vec<u8> = state
        .ep
        .iter()
        .enumerate()
        .filter_map(|(i, &piece)| (piece as usize != i).then_some(i as u8))
        .collect();

    match (corner_misplaced.len(), edge_misplaced.len()) {
        (3, 0) => Some((FmcSkeletonKind::Corner3, corner_misplaced)),
        (0, 3) => Some((FmcSkeletonKind::Edge3, edge_misplaced)),
        (2, 2) => {
            let mut positions = corner_misplaced;
            positions.extend_from_slice(&edge_misplaced);
            Some((FmcSkeletonKind::Corner2Edge2, positions))
        }
        _ => None,
    }
}

fn collect_axis_skeleton_prefixes'''
fmc, count = classifier_pattern.subn(classifier_replacement, fmc, count=1)
if count != 1:
    raise RuntimeError(f"classifier: expected one replacement, found {count}")

fmc = fmc.replace("classify_three_cycle", "classify_insertion_leftover")
fmc = replace_once(
    fmc,
    "    pub defect_positions: [u8; 3],",
    "    pub defect_positions: Vec<u8>,",
    "defect vector",
)
fmc = replace_once(
    fmc,
    "    pub insertion_candidate_count: usize,\n}",
    "    pub insertion_candidate_count: usize,\n    pub mixed_insertion_candidate_count: usize,\n}",
    "mixed result count field",
)
fmc = fmc.replace(
    "                insertion_candidate_count: 0,\n            }",
    "                insertion_candidate_count: 0,\n                mixed_insertion_candidate_count: 0,\n            }",
    1,
)

fmc = replace_once(
    fmc,
    "    let mut removable_cycles = Vec::<(Vec<u8>, FmcSkeletonKind, [u8; 3])>::new();\n    for algorithm in fmc_tables.three_cycle_algorithms.values() {",
    "    let mut removable_cycles = Vec::<(Vec<u8>, FmcSkeletonKind, Vec<u8>)>::new();\n    for algorithm in fmc_tables\n        .three_cycle_algorithms\n        .values()\n        .chain(fmc_tables.two_corner_two_edge_algorithms.values())\n    {",
    "relocation library union",
)
fmc = replace_once(
    fmc,
    "        (moves.len(), kind.rank(), *positions, moves.clone())",
    "        (moves.len(), kind.rank(), positions.clone(), moves.clone())",
    "relocation sort",
)
fmc = replace_once(
    fmc,
    "    let mut output = Vec::new();\n    for candidate in base_candidates {",
    "    let mut mixed_seen = 0usize;\n    removable_cycles.retain(|(_, kind, _)| {\n        if *kind != FmcSkeletonKind::Corner2Edge2 {\n            return true;\n        }\n        mixed_seen += 1;\n        mixed_seen <= FMC_RELOCATION_2C2E_LIMIT\n    });\n\n    let mut output = Vec::new();\n    for candidate in base_candidates {",
    "mixed relocation cap",
)
fmc = replace_once(
    fmc,
    "                defect_positions: *positions,",
    "                defect_positions: positions.clone(),",
    "relocation positions clone",
)

old_lookup = '''            let Some(algorithm) = fmc_tables
                .three_cycle_algorithms
                .get(&fmc_state_key(&relative))
            else {
                continue;
            };'''
new_lookup = '''            let algorithms = match skeleton.kind {
                FmcSkeletonKind::Corner3 | FmcSkeletonKind::Edge3 => {
                    &fmc_tables.three_cycle_algorithms
                }
                FmcSkeletonKind::Corner2Edge2 => {
                    &fmc_tables.two_corner_two_edge_algorithms
                }
            };
            let Some(algorithm) = algorithms.get(&fmc_state_key(&relative)) else {
                continue;
            };'''
fmc = replace_once(fmc, old_lookup, new_lookup, "insertion map selection")

fmc = replace_once(
    fmc,
    "    let insertion_candidate_count = inserted_candidates.len();\n    all_candidates.extend(inserted_candidates);",
    "    let insertion_candidate_count = inserted_candidates.len();\n    let mixed_insertion_candidate_count = inserted_candidates\n        .iter()\n        .filter(|candidate| candidate.skeleton_kind == Some(FmcSkeletonKind::Corner2Edge2))\n        .count();\n    all_candidates.extend(inserted_candidates);",
    "mixed insertion count",
)
fmc = replace_once(
    fmc,
    "        skeletons,\n        insertion_candidate_count,\n    }",
    "        skeletons,\n        insertion_candidate_count,\n        mixed_insertion_candidate_count,\n    }",
    "result mixed count",
)

json_anchor = '''    let source = match skeleton.source_tag {
        0 => format!("FMC_EO_{}", AXIS_NAMES[skeleton.axis as usize]),
        1 => format!("FMC_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        2 => format!("FMC_PREMOVE_{}", AXIS_NAMES[skeleton.axis as usize]),
        3 => format!("FMC_PREMOVE_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        _ => "FMC_UNKNOWN".into(),
    };

    serde_json::json!({'''
json_replacement = '''    let source = match skeleton.source_tag {
        0 => format!("FMC_EO_{}", AXIS_NAMES[skeleton.axis as usize]),
        1 => format!("FMC_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        2 => format!("FMC_PREMOVE_{}", AXIS_NAMES[skeleton.axis as usize]),
        3 => format!("FMC_PREMOVE_NISS_{}", AXIS_NAMES[skeleton.axis as usize]),
        _ => "FMC_UNKNOWN".into(),
    };
    let (corner_defect_positions, edge_defect_positions) = match skeleton.kind {
        FmcSkeletonKind::Corner3 => (skeleton.defect_positions.clone(), vec![]),
        FmcSkeletonKind::Edge3 => (vec![], skeleton.defect_positions.clone()),
        FmcSkeletonKind::Corner2Edge2 => (
            skeleton.defect_positions[..2].to_vec(),
            skeleton.defect_positions[2..].to_vec(),
        ),
    };
    let estimated_insertion_cost = skeleton.kind.estimated_insertion_cost();

    serde_json::json!({'''
fmc = replace_once(fmc, json_anchor, json_replacement, "skeleton json prelude")
fmc = replace_once(
    fmc,
    '        "estimatedInsertionCost": 8,\n        "estimatedFinalMoveCount": skeleton.moves.len() + 8,\n        "defectPositions": skeleton.defect_positions,',
    '        "estimatedInsertionCost": estimated_insertion_cost,\n        "estimatedFinalMoveCount": skeleton.moves.len() + estimated_insertion_cost,\n        "defectPositions": skeleton.defect_positions,\n        "cornerDefectPositions": corner_defect_positions,\n        "edgeDefectPositions": edge_defect_positions,',
    "skeleton json fields",
)

fmc = fmc.replace(
    "Some((FmcSkeletonKind::Corner3, [0, 1, 2]))",
    "Some((FmcSkeletonKind::Corner3, vec![0, 1, 2]))",
)
fmc = fmc.replace(
    "Some((FmcSkeletonKind::Edge3, [4, 5, 6]))",
    "Some((FmcSkeletonKind::Edge3, vec![4, 5, 6]))",
)

mixed_test_anchor = '''    #[test]
    fn cube_state_inverse_and_composition_cancel() {'''
mixed_test = '''    #[test]
    fn classifies_orientation_preserving_two_corner_two_edge_swap() {
        let mut state = CubeState::solved();
        state.cp[0] = 1;
        state.cp[1] = 0;
        state.ep[4] = 5;
        state.ep[5] = 4;
        assert_eq!(
            classify_insertion_leftover(&state),
            Some((FmcSkeletonKind::Corner2Edge2, vec![0, 1, 4, 5]))
        );
    }

    #[test]
    fn cube_state_inverse_and_composition_cancel() {'''
fmc = replace_once(fmc, mixed_test_anchor, mixed_test, "mixed classifier test")

fmc_path.write_text(fmc)

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    "    let three_cycle_algorithm_count = fmc.three_cycle_algorithms.len();",
    "    let three_cycle_algorithm_count = fmc.three_cycle_algorithms.len();\n    let two_corner_two_edge_algorithm_count = fmc.two_corner_two_edge_algorithms.len();",
    "lib table count",
)
lib = replace_once(
    lib,
    '        "threeCycleAlgorithmCount": three_cycle_algorithm_count,\n    })',
    '        "threeCycleAlgorithmCount": three_cycle_algorithm_count,\n        "twoCornerTwoEdgeAlgorithmCount": two_corner_two_edge_algorithm_count,\n    })',
    "lib table json",
)
lib = replace_once(
    lib,
    '        "insertionCandidateCount": result.insertion_candidate_count,\n    })',
    '        "insertionCandidateCount": result.insertion_candidate_count,\n        "mixedInsertionCandidateCount": result.mixed_insertion_candidate_count,\n    })',
    "lib result json",
)
lib_path.write_text(lib)
