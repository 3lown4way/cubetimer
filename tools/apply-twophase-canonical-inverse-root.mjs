import fs from "node:fs";

const rustPath = "solver-wasm/src/twophase_search.rs";
const benchmarkPath = "benchmark-twophase-nontrivial-reliability.mjs";

function replaceOnce(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) {
    throw new Error(`PATCH_ANCHOR_AMBIGUOUS:${label}`);
  }
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

function replaceOnceAfter(source, marker, oldText, newText, label) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`PATCH_MARKER_MISSING:${label}`);
  const index = source.indexOf(oldText, markerIndex);
  if (index < 0) throw new Error(`PATCH_ANCHOR_MISSING:${label}`);
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

let rust = fs.readFileSync(rustPath, "utf8");

if (!rust.includes("fn canonicalize_twophase_path(")) {
  const anchor = `pub(crate) fn solve_phase2(\n    input: &Phase2Input,\n    tables: &TwophaseTables,\n    max_depth: u8,\n    node_limit: u64,\n) -> Phase2SolveResult {`;
  const helper = `// Phase 1 and Phase 2 each forbid consecutive same-face moves internally,\n// but the phase boundary can still produce sequences such as R | R2.\n// Do not assume a fixed numeric move-index layout here: the loaded MoveData is\n// the source of truth for move names and face identity.\nfn turn_amount_from_move_name(name: &str) -> Option<u8> {\n    let normalized = name.trim();\n    if normalized.is_empty() {\n        return None;\n    }\n    if normalized.ends_with("2") {\n        Some(2)\n    } else if normalized.ends_with("'") {\n        Some(3)\n    } else {\n        Some(1)\n    }\n}\n\nfn find_move_index_for_face_turn(\n    face: u8,\n    turn: u8,\n    move_data: &crate::minmove_core::MoveData,\n) -> Option<u8> {\n    move_data\n        .move_face\n        .iter()\n        .enumerate()\n        .find_map(|(index, &candidate_face)| {\n            if candidate_face != face {\n                return None;\n            }\n            let name = move_data.move_names.get(index)?;\n            (turn_amount_from_move_name(name) == Some(turn)).then_some(index as u8)\n        })\n}\n\nfn canonicalize_twophase_path(\n    path: &[u8],\n    move_data: &crate::minmove_core::MoveData,\n) -> Vec<u8> {\n    let mut canonical: Vec<u8> = Vec::with_capacity(path.len());\n    for &move_index in path {\n        let Some(&face) = move_data.move_face.get(move_index as usize) else {\n            canonical.push(move_index);\n            continue;\n        };\n        let Some(turn) = move_data\n            .move_names\n            .get(move_index as usize)\n            .and_then(|name| turn_amount_from_move_name(name))\n        else {\n            canonical.push(move_index);\n            continue;\n        };\n\n        if let Some(&previous) = canonical.last() {\n            if move_data.move_face.get(previous as usize).copied() == Some(face) {\n                let Some(previous_turn) = move_data\n                    .move_names\n                    .get(previous as usize)\n                    .and_then(|name| turn_amount_from_move_name(name))\n                else {\n                    canonical.push(move_index);\n                    continue;\n                };\n                let combined = (previous_turn + turn) % 4;\n                canonical.pop();\n                if combined != 0 {\n                    if let Some(combined_move) =\n                        find_move_index_for_face_turn(face, combined, move_data)\n                    {\n                        canonical.push(combined_move);\n                    } else {\n                        // Preserve correctness if a nonstandard move table is ever loaded.\n                        canonical.push(previous);\n                        canonical.push(move_index);\n                    }\n                }\n                continue;\n            }\n        }\n        canonical.push(move_index);\n    }\n    canonical\n}\n\n`;
  rust = replaceOnce(rust, anchor, helper + anchor, "canonical-helper");
}

const searchMarker = "impl TwophaseSession {";
const excludedOld = `        let excluded_path = options\n            .excluded_solution\n            .as_deref()\n            .and_then(|solution| parse_scramble(solution, &tables.move_data).ok());`;
const excludedNew = `        let excluded_path = options\n            .excluded_solution\n            .as_deref()\n            .and_then(|solution| parse_scramble(solution, &tables.move_data).ok())\n            .map(|path| canonicalize_twophase_path(&path, &tables.move_data));`;
rust = replaceOnceAfter(rust, searchMarker, excludedOld, excludedNew, "canonical-excluded-path");

const assembledOld = `        let mut full_path = candidate.moves.clone();\n        for &phase2_move in &phase2.moves {\n            full_path.push(tables.phase2_move_indices[phase2_move as usize]);\n        }\n        let total = full_path.len();\n        if excluded_path.map_or(false, |excluded| full_path.as_slice() == excluded) {\n            continue;\n        }\n        if best_found_total.map_or(true, |best_total| total < best_total) {`;
const assembledNew = `        let mut full_path = candidate.moves.clone();\n        for &phase2_move in &phase2.moves {\n            full_path.push(tables.phase2_move_indices[phase2_move as usize]);\n        }\n        let full_path = canonicalize_twophase_path(&full_path, &tables.move_data);\n        let total = full_path.len();\n        if target_total.map_or(false, |target| total >= target) {\n            continue;\n        }\n        if excluded_path.map_or(false, |excluded| full_path.as_slice() == excluded) {\n            continue;\n        }\n        if best_found_total.map_or(true, |best_total| total < best_total) {`;
rust = replaceOnce(rust, assembledOld, assembledNew, "canonical-candidate");

if (!rust.includes("fn parses_move_turn_amounts()")) {
  const testAnchor = `#[cfg(test)]\nmod deadline_tests {`;
  const tests = `#[cfg(test)]\nmod canonical_path_tests {\n    use super::turn_amount_from_move_name;\n\n    #[test]\n    fn parses_move_turn_amounts() {\n        assert_eq!(turn_amount_from_move_name("R"), Some(1));\n        assert_eq!(turn_amount_from_move_name("R2"), Some(2));\n        assert_eq!(turn_amount_from_move_name("R'"), Some(3));\n        assert_eq!(turn_amount_from_move_name(""), None);\n    }\n}\n\n`;
  rust = replaceOnce(rust, testAnchor, tests + testAnchor, "canonical-tests");
}

fs.writeFileSync(rustPath, rust);

let benchmark = fs.readFileSync(benchmarkPath, "utf8");
if (!benchmark.includes("isLiteralInverseSolution")) {
  benchmark = benchmark.replace(
    `import {\n  ensureTwophase333Ready,\n  solveTwophaseAdaptive333,\n} from "./solver/wasmSolver.js";`,
    `import {\n  ensureTwophase333Ready,\n  solveTwophaseAdaptive333,\n} from "./solver/wasmSolver.js";\nimport { isLiteralInverseSolution } from "./solver/inverseSolutionPolicy.js";`,
  );
}
benchmark = benchmark.replace(
  `const scrambles = generateScrambles(100, 20);`,
  `const REPORTED_REDUCIBLE_INVERSE_SCRAMBLE = "U' F2 D' B2 U' F2 U F2 U' R B D L' R D' L' D";\nconst scrambles = [REPORTED_REDUCIBLE_INVERSE_SCRAMBLE, ...generateScrambles(100, 20)];`,
);
benchmark = benchmark.replace(
  `  const nontrivial = solution !== inverse;`,
  `  const nontrivial = !isLiteralInverseSolution(scramble, solution);`,
);
fs.writeFileSync(benchmarkPath, benchmark);

console.log("Applied MoveData-driven canonical Two-Phase inverse-root patch.");
