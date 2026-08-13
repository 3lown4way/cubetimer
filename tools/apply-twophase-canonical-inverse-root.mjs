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
  const helper = `// Global move indices are fixed by the move-data contract as\n// [U, U', U2, R, R', R2, F, F', F2, D, D', D2, L, L', L2, B, B', B2].\n// Phase 1 and Phase 2 each forbid consecutive same-face moves internally,\n// but the phase boundary can still produce sequences such as R | R2.\n// Canonicalize the assembled path before HTM length and exclusion decisions.\nfn canonicalize_twophase_path(path: &[u8]) -> Vec<u8> {\n    let mut canonical: Vec<u8> = Vec::with_capacity(path.len());\n    for &move_index in path {\n        if move_index as usize >= crate::minmove_core::MOVE_COUNT {\n            canonical.push(move_index);\n            continue;\n        }\n        let face = move_index / 3;\n        let turn = match move_index % 3 {\n            0 => 1u8,\n            1 => 3u8,\n            2 => 2u8,\n            _ => unreachable!(),\n        };\n\n        if let Some(&previous) = canonical.last() {\n            if previous as usize < crate::minmove_core::MOVE_COUNT && previous / 3 == face {\n                let previous_turn = match previous % 3 {\n                    0 => 1u8,\n                    1 => 3u8,\n                    2 => 2u8,\n                    _ => unreachable!(),\n                };\n                let combined = (previous_turn + turn) % 4;\n                canonical.pop();\n                if combined != 0 {\n                    let suffix = match combined {\n                        1 => 0u8,\n                        2 => 2u8,\n                        3 => 1u8,\n                        _ => unreachable!(),\n                    };\n                    canonical.push(face * 3 + suffix);\n                }\n                continue;\n            }\n        }\n        canonical.push(move_index);\n    }\n    canonical\n}\n\n`;
  rust = replaceOnce(rust, anchor, helper + anchor, "canonical-helper");
}

const searchMarker = "impl TwophaseSession {";
const excludedOld = `        let excluded_path = options\n            .excluded_solution\n            .as_deref()\n            .and_then(|solution| parse_scramble(solution, &tables.move_data).ok());`;
const excludedNew = `        let excluded_path = options\n            .excluded_solution\n            .as_deref()\n            .and_then(|solution| parse_scramble(solution, &tables.move_data).ok())\n            .map(|path| canonicalize_twophase_path(&path));`;
rust = replaceOnceAfter(rust, searchMarker, excludedOld, excludedNew, "canonical-excluded-path");

const assembledOld = `        let mut full_path = candidate.moves.clone();\n        for &phase2_move in &phase2.moves {\n            full_path.push(tables.phase2_move_indices[phase2_move as usize]);\n        }\n        let total = full_path.len();\n        if excluded_path.map_or(false, |excluded| full_path.as_slice() == excluded) {\n            continue;\n        }\n        if best_found_total.map_or(true, |best_total| total < best_total) {`;
const assembledNew = `        let mut full_path = candidate.moves.clone();\n        for &phase2_move in &phase2.moves {\n            full_path.push(tables.phase2_move_indices[phase2_move as usize]);\n        }\n        let full_path = canonicalize_twophase_path(&full_path);\n        let total = full_path.len();\n        if target_total.map_or(false, |target| total >= target) {\n            continue;\n        }\n        if excluded_path.map_or(false, |excluded| full_path.as_slice() == excluded) {\n            continue;\n        }\n        if best_found_total.map_or(true, |best_total| total < best_total) {`;
rust = replaceOnce(rust, assembledOld, assembledNew, "canonical-candidate");

if (!rust.includes("fn canonicalizes_phase_boundary_same_face_moves()")) {
  const testAnchor = `#[cfg(test)]\nmod deadline_tests {`;
  const tests = `#[cfg(test)]\nmod canonical_path_tests {\n    use super::canonicalize_twophase_path;\n\n    #[test]\n    fn canonicalizes_phase_boundary_same_face_moves() {\n        // R | R2 = R' in the global move-index contract.\n        assert_eq!(canonicalize_twophase_path(&[3, 5]), vec![4]);\n        // R | R' cancels completely.\n        assert_eq!(canonicalize_twophase_path(&[3, 4]), Vec::<u8>::new());\n        // Cascading cancellation must expose and merge the next boundary pair.\n        assert_eq!(canonicalize_twophase_path(&[3, 0, 1, 5]), vec![4]);\n    }\n}\n\n`;
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

console.log("Applied canonical Two-Phase inverse-root patch.");
