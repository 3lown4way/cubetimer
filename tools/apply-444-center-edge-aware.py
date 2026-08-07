from pathlib import Path

# Expose a cheap exact count of currently paired dedges for center-search tie breaking.
p = Path('solver444-wasm/src/edges.rs')
s = p.read_text()
old = '''impl Cube444 {\n    pub fn edges_paired(&self) -> bool {\n        let Ok(inventory) = wing_inventory(self) else {\n            return false;\n        };\n        EDGE_SLOTS.iter().all(|&[first, second]| {\n            inventory.edge_type[first as usize] == inventory.edge_type[second as usize]\n                && inventory.orientation[first as usize] == inventory.orientation[second as usize]\n        })\n    }\n}\n'''
new = '''impl Cube444 {\n    pub fn paired_edge_count(&self) -> usize {\n        let Ok(inventory) = wing_inventory(self) else {\n            return 0;\n        };\n        EDGE_SLOTS\n            .iter()\n            .filter(|&&[first, second]| {\n                inventory.edge_type[first as usize] == inventory.edge_type[second as usize]\n                    && inventory.orientation[first as usize] == inventory.orientation[second as usize]\n            })\n            .count()\n    }\n\n    pub fn edges_paired(&self) -> bool {\n        self.paired_edge_count() == EDGE_TYPE_COUNT\n    }\n}\n'''
if old not in s:
    raise SystemExit('edges_paired impl block missing')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('solver444-wasm/src/centers.rs')
s = p.read_text()

old = '''        let mut selected = None;\n        for center_move in moves {\n            let next = apply_mask(mask, &center_move.permutation);\n            let next_distance = distance[coordinate_rank(next, positions, expected_bits)];\n            if next_distance + 1 == current_distance {\n                selected = Some((center_move.mv, next, next_distance));\n                break;\n            }\n        }\n        let (mv, next, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove(phase))?;\n'''
new = '''        let mut selected = None;\n        let mut best_edge_score = 0usize;\n        for center_move in moves {\n            let next = apply_mask(mask, &center_move.permutation);\n            let next_distance = distance[coordinate_rank(next, positions, expected_bits)];\n            if next_distance + 1 != current_distance {\n                continue;\n            }\n            let mut candidate = state.clone();\n            candidate.apply_move(center_move.mv);\n            let edge_score = candidate.paired_edge_count();\n            if selected.is_none() || edge_score > best_edge_score {\n                best_edge_score = edge_score;\n                selected = Some((center_move.mv, next, next_distance));\n            }\n        }\n        let (mv, next, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove(phase))?;\n'''
if old not in s:
    raise SystemExit('descend_single selection block missing')
s = s.replace(old, new, 1)

old = '''        let mut selected = None;\n        for center_macro in macros {\n            let next = apply_mask(mask, &center_macro.permutation);\n            let next_distance = distance[coordinate_rank(next, positions, expected_bits)];\n            if next_distance + 1 == current_distance {\n                selected = Some((center_macro, next, next_distance));\n                break;\n            }\n        }\n        let (center_macro, next, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove(phase))?;\n'''
new = '''        let mut selected = None;\n        let mut best_edge_score = 0usize;\n        for center_macro in macros {\n            let next = apply_mask(mask, &center_macro.permutation);\n            let next_distance = distance[coordinate_rank(next, positions, expected_bits)];\n            if next_distance + 1 != current_distance {\n                continue;\n            }\n            let mut candidate = state.clone();\n            candidate.apply_moves(&center_macro.moves);\n            let edge_score = candidate.paired_edge_count();\n            if selected.is_none() || edge_score > best_edge_score {\n                best_edge_score = edge_score;\n                selected = Some((center_macro, next, next_distance));\n            }\n        }\n        let (center_macro, next, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove(phase))?;\n'''
if old not in s:
    raise SystemExit('descend_macro_single selection block missing')
s = s.replace(old, new, 1)

old = '''        let mut selected = None;\n        for center_move in &tables.phase4_moves {\n            let next_first = apply_mask(first, &center_move.permutation);\n            let next_second = apply_mask(second, &center_move.permutation);\n            let next_distance = tables.phase4_distance[pair_rank(next_first, next_second)];\n            if next_distance + 1 == current_distance {\n                selected = Some((center_move.mv, next_first, next_second, next_distance));\n                break;\n            }\n        }\n        let (mv, next_first, next_second, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove("phase4"))?;\n'''
new = '''        let mut selected = None;\n        let mut best_edge_score = 0usize;\n        for center_move in &tables.phase4_moves {\n            let next_first = apply_mask(first, &center_move.permutation);\n            let next_second = apply_mask(second, &center_move.permutation);\n            let next_distance = tables.phase4_distance[pair_rank(next_first, next_second)];\n            if next_distance + 1 != current_distance {\n                continue;\n            }\n            let mut candidate = state.clone();\n            candidate.apply_move(center_move.mv);\n            let edge_score = candidate.paired_edge_count();\n            if selected.is_none() || edge_score > best_edge_score {\n                best_edge_score = edge_score;\n                selected = Some((center_move.mv, next_first, next_second, next_distance));\n            }\n        }\n        let (mv, next_first, next_second, next_distance) =\n            selected.ok_or(CenterSolveError::NoDescendingMove("phase4"))?;\n'''
if old not in s:
    raise SystemExit('descend_pair selection block missing')
s = s.replace(old, new, 1)
p.write_text(s)
