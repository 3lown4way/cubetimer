import fs from "node:fs";

const path = "solver-wasm/src/fmc_search.rs";
let source = fs.readFileSync(path, "utf8");
const before = source;

const replacements = [
  [
    "pub const MOVE_INVERSE: [u8; 18] = [1, 0, 2, 4, 3, 5, 7, 6, 8, 10, 9, 11, 13, 12, 14, 16, 15, 17];",
    "pub const MOVE_INVERSE: [u8; 18] = [2, 1, 0, 5, 4, 3, 8, 7, 6, 11, 10, 9, 14, 13, 12, 17, 16, 15];",
  ],
  [
    "/// EO-preserving moves for DR solving (all except F, F', B, B').\n/// U(0),U'(1),U2(2), R(3),R'(4),R2(5), F2(8), D(9),D'(10),D2(11), L(12),L'(13),L2(14), B2(17)\nconst DR_EO_MOVE_INDICES: [u8; 14] = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 17];",
    "/// EO-preserving moves for DR solving (all except F, F', B, B').\n/// Repository order per face is clockwise, half turn, counter-clockwise.\n/// U(0),U2(1),U'(2), R(3),R2(4),R'(5), F2(7), D(9),D2(10),D'(11), L(12),L2(13),L'(14), B2(16)\nconst DR_EO_MOVE_INDICES: [u8; 14] = [0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 16];",
  ],
  [
    "const TURN_AMOUNTS: [u8; 3] = [1, 3, 2];",
    "const TURN_AMOUNTS: [u8; 3] = [1, 2, 3];",
  ],
  [
    "fn turn_to_suffix(combined: u8) -> u8 {\n    match combined {\n        1 => 0,\n        3 => 1,\n        2 => 2,\n        _ => unreachable!(),\n    }\n}",
    "fn turn_to_suffix(combined: u8) -> u8 {\n    match combined {\n        1 => 0,\n        2 => 1,\n        3 => 2,\n        _ => unreachable!(),\n    }\n}",
  ],
  [
    "const FMC_HTR_HALF_TURN_MOVES: [u8; 6] = [2, 5, 8, 11, 14, 17];",
    "const FMC_HTR_HALF_TURN_MOVES: [u8; 6] = [1, 4, 7, 10, 13, 16];",
  ],
  [
    "        vec![3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 7],\n        vec![3, 0, 4, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1],\n        vec![3, 1, 4, 1, 3, 0, 3, 9, 4, 1, 3, 10, 4, 2, 4],\n        vec![4, 2, 3, 2, 4, 6, 3, 0, 4, 1, 4, 7, 5, 1],\n        vec![4, 1, 7, 3, 0, 4, 1, 4, 6, 5, 1, 4, 1, 3, 0, 4, 0, 3],",
    "        vec![3, 0, 5, 2, 5, 6, 4, 2, 5, 2, 3, 0, 5, 8],\n        vec![3, 0, 5, 8, 3, 0, 5, 2, 5, 6, 4, 2, 5, 2],\n        vec![3, 2, 5, 2, 3, 0, 3, 9, 5, 2, 3, 11, 5, 1, 5],\n        vec![5, 1, 3, 1, 5, 6, 3, 0, 5, 2, 5, 8, 4, 2],\n        vec![5, 2, 8, 3, 0, 5, 2, 5, 6, 4, 2, 5, 2, 3, 0, 5, 0, 3],",
  ],
  [
    "        0 => [2, 11], // U2 D2 completes E2\n        1 => [5, 14], // R2 L2 completes M2\n        2 => [8, 17], // F2 B2 completes S2",
    "        0 => [1, 10], // U2 D2 completes E2\n        1 => [4, 13], // R2 L2 completes M2\n        2 => [7, 16], // F2 B2 completes S2",
  ],
  [
    "        let reverse = vec![3, 10, 1, 4]; // R D' U' R'",
    "        let reverse = vec![3, 11, 2, 5]; // R D' U' R'",
  ],
  [
    "            &[3, 1, 10, 4], // R U' D' R'",
    "            &[3, 2, 11, 5], // R U' D' R'",
  ],
  [
    "            canonicalize_commuting_axis_blocks(&[4, 0, 9, 1]), // R' U D U'\n            canonicalize_commuting_axis_blocks(&[4, 9]),       // R' D",
    "            canonicalize_commuting_axis_blocks(&[5, 0, 9, 2]), // R' U D U'\n            canonicalize_commuting_axis_blocks(&[5, 9]),       // R' D",
  ],
  [
    "            &[3, 1, 11, 4], // R U' D2 R'",
    "            &[3, 2, 10, 5], // R U' D2 R'",
  ],
];

for (const [from, to] of replacements) {
  if (source.includes(to)) continue;
  if (!source.includes(from)) {
    throw new Error(`Missing FMC move-order anchor: ${from.slice(0, 100)}`);
  }
  source = source.replace(from, to);
}

const testMarker = "    #[test]\n    fn simplification_matches_repository_turn_order()";
if (!source.includes(testMarker)) {
  const anchor = "    #[test]\n    fn recognizes_reverse_scramble_notation_under_axis_commutation()";
  if (!source.includes(anchor)) throw new Error("Missing FMC simplification test anchor");
  const test = `    #[test]\n    fn simplification_matches_repository_turn_order() {\n        for face in 0..6u8 {\n            let clockwise = face * 3;\n            let half = clockwise + 1;\n            let counter_clockwise = clockwise + 2;\n            assert_eq!(simplify_moves(&[clockwise, clockwise]), vec![half]);\n            assert_eq!(simplify_moves(&[counter_clockwise, counter_clockwise]), vec![half]);\n            assert!(simplify_moves(&[clockwise, counter_clockwise]).is_empty());\n            assert!(simplify_moves(&[half, half]).is_empty());\n        }\n    }\n\n`;
  source = source.replace(anchor, `${test}${anchor}`);
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before ? "FMC move-order fix already applied" : "Applied FMC move-order fix");
