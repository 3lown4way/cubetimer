from pathlib import Path

path = Path("solver-wasm/src/twophase_search.rs")
text = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    "use std::collections::{HashMap, HashSet};",
    "use std::collections::HashMap;",
    "collections import",
)

replace_once(
    '''    #[inline(always)]
    fn get(&self, key: u64) -> u32 {
        let base = Self::base_slot(key);
        for slot in base..base + FAIL_TT_WAYS {
            if self.epochs[slot] == self.epoch && self.keys[slot] == key {
                return self.masks[slot];
            }
        }
        0
    }

    #[inline(always)]
    fn insert_or(&mut self, key: u64, bit: u32) {
        let base = Self::base_slot(key);
        let mut free = None;
        for slot in base..base + FAIL_TT_WAYS {
            if self.epochs[slot] == self.epoch {
                if self.keys[slot] == key {
                    self.masks[slot] |= bit;
                    return;
                }
            } else if free.is_none() {
                free = Some(slot);
            }
        }
        let slot = free.unwrap_or_else(|| {
            if self.masks[base].count_ones() <= self.masks[base + 1].count_ones() {
                base
            } else {
                base + 1
            }
        });
        self.keys[slot] = key;
        self.masks[slot] = bit;
        self.epochs[slot] = self.epoch;
    }
''',
    '''    #[inline(always)]
    fn get(&self, key: u64) -> u32 {
        let base = Self::base_slot(key);
        let alternate = base + 1;
        if self.epochs[base] == self.epoch && self.keys[base] == key {
            return self.masks[base];
        }
        if self.epochs[alternate] == self.epoch && self.keys[alternate] == key {
            return self.masks[alternate];
        }
        0
    }

    #[inline(always)]
    fn insert_or(&mut self, key: u64, bit: u32) {
        let base = Self::base_slot(key);
        let alternate = base + 1;

        if self.epochs[base] == self.epoch && self.keys[base] == key {
            self.masks[base] |= bit;
            return;
        }
        if self.epochs[alternate] == self.epoch && self.keys[alternate] == key {
            self.masks[alternate] |= bit;
            return;
        }

        let slot = if self.epochs[base] != self.epoch {
            base
        } else if self.epochs[alternate] != self.epoch {
            alternate
        } else if self.masks[base].count_ones() <= self.masks[alternate].count_ones() {
            base
        } else {
            alternate
        };
        self.keys[slot] = key;
        self.masks[slot] = bit;
        self.epochs[slot] = self.epoch;
    }
''',
    "fixed fail table",
)

replace_once(
    '''    let mut seen: HashSet<Vec<u8>> = HashSet::new();
    let mut solutions = Vec::new();
    seen.insert(first.moves.clone());
    solutions.push(first.moves.clone());
''',
    '''    let mut solutions = Vec::new();
    solutions.push(first.moves.clone());
''',
    "phase1 solution setup",
)

replace_once(
    '''        seen: &mut HashSet<Vec<u8>>,
''',
    "",
    "enumerate seen parameter",
)

replace_once(
    '''            if depth == target_depth {
                let candidate = path.clone();
                if seen.insert(candidate.clone()) {
                    solutions.push(candidate);
                }
            }
''',
    '''            if depth == target_depth {
                solutions.push(path.clone());
            }
''',
    "enumerate goal",
)

replace_once(
    '''                seen,
                solutions,
''',
    '''                solutions,
''',
    "recursive enumerate seen argument",
)

replace_once(
    '''    let mut target = first.depth;
    while solutions.len() < max_count && target <= input.max_depth {
        enumerate(
            tables,
            input.co_idx,
            input.eo_idx,
            input.slice_idx,
            0,
            target,
            LAST_FACE_FREE,
            &mut enum_path,
            &mut seen,
            &mut solutions,
            max_count,
            &mut enum_nodes,
        );
        target += 1;
    }
''',
    '''    // Resume the exact legacy DFS order immediately after the first path.
    // The previous code restarted at the root, rediscovered the first path,
    // and discarded it through a HashSet before reaching the next candidate.
    let first_depth = first.moves.len();
    let mut prefix_co = Vec::with_capacity(first_depth + 1);
    let mut prefix_eo = Vec::with_capacity(first_depth + 1);
    let mut prefix_slice = Vec::with_capacity(first_depth + 1);
    let mut prefix_last_face = Vec::with_capacity(first_depth + 1);
    prefix_co.push(input.co_idx);
    prefix_eo.push(input.eo_idx);
    prefix_slice.push(input.slice_idx);
    prefix_last_face.push(LAST_FACE_FREE);
    for (depth, &move_index) in first.moves.iter().enumerate() {
        prefix_co.push(tables.co_move.get(prefix_co[depth], move_index as usize) as usize);
        prefix_eo.push(tables.eo_move.get(prefix_eo[depth], move_index as usize) as usize);
        prefix_slice.push(
            tables
                .slice_move
                .get(prefix_slice[depth], move_index as usize) as usize,
        );
        prefix_last_face.push(tables.move_data.move_face[move_index as usize]);
    }

    enum_path.extend_from_slice(&first.moves);
    for depth in (0..first_depth).rev() {
        if solutions.len() >= max_count {
            break;
        }
        enum_path.truncate(depth);
        let allowed =
            &tables.phase1_allowed_moves_by_last_face[prefix_last_face[depth] as usize];
        let chosen = first.moves[depth];
        let Some(chosen_slot) = allowed.iter().position(|&candidate| candidate == chosen) else {
            continue;
        };
        for &move_index in &allowed[chosen_slot + 1..] {
            if solutions.len() >= max_count {
                break;
            }
            enum_nodes += 1;
            let next_co = tables.co_move.get(prefix_co[depth], move_index as usize) as usize;
            let next_eo = tables.eo_move.get(prefix_eo[depth], move_index as usize) as usize;
            let next_slice = tables
                .slice_move
                .get(prefix_slice[depth], move_index as usize) as usize;
            enum_path.push(move_index);
            let next_face = tables.move_data.move_face[move_index as usize];
            enumerate(
                tables,
                next_co,
                next_eo,
                next_slice,
                depth as u8 + 1,
                first.depth,
                next_face,
                &mut enum_path,
                &mut solutions,
                max_count,
                &mut enum_nodes,
            );
            enum_path.pop();
        }
    }

    let mut target = first.depth.saturating_add(1);
    while solutions.len() < max_count && target <= input.max_depth {
        enum_path.clear();
        enumerate(
            tables,
            input.co_idx,
            input.eo_idx,
            input.slice_idx,
            0,
            target,
            LAST_FACE_FREE,
            &mut enum_path,
            &mut solutions,
            max_count,
            &mut enum_nodes,
        );
        target += 1;
    }
''',
    "phase1 resumed enumeration",
)

path.write_text(text, encoding="utf-8")
