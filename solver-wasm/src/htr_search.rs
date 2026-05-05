use crate::htr_classifier::classify_htr_subset;
use crate::htr_rewrite::{simplify_moves, to_global_indices, HTR_TRIGGERS};
use crate::twophase_bundle::TwophaseTables;

const CP_SIZE: usize = 40320;
const EP_SIZE: usize = 40320;
const SEP_SIZE: usize = 24;
const HTR_SLOTS: [usize; 6] = [1, 4, 6, 7, 8, 9]; // U2, D2, R2, L2, F2, B2
const HTR_FACE_OF_SLOT: [usize; 6] = [0, 1, 2, 3, 4, 5];
const DR_SLOTS: [usize; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

#[derive(Clone, Debug)]
pub struct HtrPruningTables {
    cp: Vec<u8>,
    ep: Vec<u8>,
    sep: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct HtrTriggerResult {
    pub ok: bool,
    pub trigger_moves: Vec<u8>,
    pub htr_cp: usize,
    pub htr_ep: usize,
    pub htr_sep: usize,
    pub depth: u8,
    pub nodes: u64,
}

#[derive(Clone, Debug)]
pub struct HtrFinishResult {
    pub ok: bool,
    pub moves: Vec<u8>,
    pub depth: u8,
    pub nodes: u64,
}

#[derive(Clone, Debug)]
pub struct HtrCombinedResult {
    pub ok: bool,
    pub trigger_moves: Vec<u8>,
    pub finish_moves: Vec<u8>,
    pub total_length: usize,
    pub nodes: u64,
}

fn bfs_coord_dist(size: usize, start: usize, move_table: &impl CoordMoveTable) -> Vec<u8> {
    let mut dist = vec![255u8; size];
    let mut frontier = vec![start];
    dist[start] = 0;
    let mut depth = 0u8;

    while !frontier.is_empty() {
        depth += 1;
        let mut next = Vec::new();
        for &state in &frontier {
            for &slot in &HTR_SLOTS {
                let ns = move_table.get_coord(state, slot) as usize;
                if dist[ns] == 255 {
                    dist[ns] = depth;
                    next.push(ns);
                }
            }
        }
        frontier = next;
    }

    dist
}

trait CoordMoveTable {
    fn get_coord(&self, state: usize, slot: usize) -> u16;
}

impl CoordMoveTable for crate::minmove_bundle::MoveTable {
    fn get_coord(&self, state: usize, slot: usize) -> u16 {
        self.get(state, slot)
    }
}

pub fn build_htr_pruning_tables(tables: &TwophaseTables) -> HtrPruningTables {
    HtrPruningTables {
        cp: bfs_coord_dist(CP_SIZE, 0, &tables.phase2_cp_move),
        ep: bfs_coord_dist(EP_SIZE, 0, &tables.phase2_ep_move),
        sep: bfs_coord_dist(SEP_SIZE, 0, &tables.phase2_sep_move),
    }
}

#[inline]
fn htr_lower_bound(cp: usize, ep: usize, sep: usize, prune: &HtrPruningTables) -> u8 {
    prune.cp[cp].max(prune.ep[ep]).max(prune.sep[sep])
}

fn last_face(path: &[u8]) -> usize {
    if path.is_empty() {
        return 999;
    }
    let last_slot = path[path.len() - 1] as usize;
    HTR_FACE_OF_SLOT[HTR_SLOTS.iter().position(|&s| s == last_slot).unwrap_or(0)]
}

fn last_phase2_face(path: &[u8], tables: &TwophaseTables) -> usize {
    if path.is_empty() {
        return 999;
    }
    tables.phase2_move_faces[path[path.len() - 1] as usize] as usize
}

pub fn search_htr_triggers(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &TwophaseTables,
    max_depth: u8,
    node_limit: u64,
) -> Vec<HtrTriggerResult> {
    let mut results = Vec::new();
    let mut nodes = 0u64;

    fn dfs(
        cp: usize,
        ep: usize,
        sep: usize,
        depth: u8,
        path: &mut Vec<u8>,
        tables: &TwophaseTables,
        max_depth: u8,
        node_limit: u64,
        results: &mut Vec<HtrTriggerResult>,
        nodes: &mut u64,
    ) {
        if *nodes > node_limit {
            return;
        }
        *nodes += 1;

        if cp == 0 && depth > 0 {
            results.push(HtrTriggerResult {
                ok: true,
                trigger_moves: path.clone(),
                htr_cp: cp,
                htr_ep: ep,
                htr_sep: sep,
                depth,
                nodes: *nodes,
            });
            return;
        }

        if depth >= max_depth {
            return;
        }

        for (i, &slot) in HTR_SLOTS.iter().enumerate() {
            if depth > 0 && HTR_FACE_OF_SLOT[i] == last_face(path) {
                continue;
            }

            let new_cp = tables.phase2_cp_move.get(cp, slot) as usize;
            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            path.push(slot as u8);
            dfs(
                new_cp,
                new_ep,
                new_sep,
                depth + 1,
                path,
                tables,
                max_depth,
                node_limit,
                results,
                nodes,
            );
            path.pop();

            if results.len() >= 8 {
                return;
            }
        }
    }

    let mut path = Vec::new();
    dfs(
        start_cp,
        start_ep,
        start_sep,
        0,
        &mut path,
        tables,
        max_depth,
        node_limit,
        &mut results,
        &mut nodes,
    );
    results
}

pub fn solve_htr_finish(
    cp: usize,
    ep: usize,
    sep: usize,
    tables: &TwophaseTables,
    prune: &HtrPruningTables,
    max_depth: u8,
    node_limit: u64,
) -> HtrFinishResult {
    if cp == 0 && ep == 0 && sep == 0 {
        return HtrFinishResult {
            ok: true,
            moves: vec![],
            depth: 0,
            nodes: 0,
        };
    }

    let bound = htr_lower_bound(cp, ep, sep, prune).max(1);

    let mut nodes = 0u64;
    let mut path = Vec::new();

    fn dfs(
        cp: usize,
        ep: usize,
        sep: usize,
        depth: u8,
        bound: u8,
        path: &mut Vec<u8>,
        tables: &TwophaseTables,
        prune: &HtrPruningTables,
        max_depth: u8,
        node_limit: u64,
        nodes: &mut u64,
    ) -> i32 {
        if *nodes > node_limit {
            return -1;
        }
        *nodes += 1;

        if cp == 0 && ep == 0 && sep == 0 {
            return depth as i32;
        }

        let prune_htf = htr_lower_bound(cp, ep, sep, prune);

        if depth + prune_htf > bound {
            return -1;
        }

        for (i, &slot) in HTR_SLOTS.iter().enumerate() {
            if depth > 0 && HTR_FACE_OF_SLOT[i] == last_face(path) {
                continue;
            }

            let new_cp = tables.phase2_cp_move.get(cp, slot) as usize;
            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            path.push(slot as u8);
            let result = dfs(
                new_cp,
                new_ep,
                new_sep,
                depth + 1,
                bound,
                path,
                tables,
                prune,
                max_depth,
                node_limit,
                nodes,
            );
            if result >= 0 {
                return result;
            }
            path.pop();
        }

        -1
    }

    let mut current_bound = bound;
    while current_bound <= max_depth {
        let result = dfs(
            cp,
            ep,
            sep,
            0,
            current_bound,
            &mut path,
            tables,
            prune,
            max_depth,
            node_limit,
            &mut nodes,
        );
        if result >= 0 {
            return HtrFinishResult {
                ok: true,
                moves: path.clone(),
                depth: result as u8,
                nodes,
            };
        }
        current_bound += 1;
    }

    HtrFinishResult {
        ok: false,
        moves: vec![],
        depth: 0,
        nodes,
    }
}

pub fn search_htr_triggers_and_finish(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &TwophaseTables,
    prune: &HtrPruningTables,
    max_trigger_depth: u8,
    max_finish_depth: u8,
    trigger_node_limit: u64,
    finish_node_limit: u64,
) -> Option<HtrCombinedResult> {
    let triggers = search_htr_triggers(
        start_cp,
        start_ep,
        start_sep,
        tables,
        max_trigger_depth,
        trigger_node_limit,
    );

    if triggers.is_empty() {
        return None;
    }

    let mut best: Option<HtrCombinedResult> = None;

    for trigger in triggers {
        let finish = solve_htr_finish(
            trigger.htr_cp,
            trigger.htr_ep,
            trigger.htr_sep,
            tables,
            prune,
            max_finish_depth,
            finish_node_limit,
        );

        if finish.ok {
            let total_len = trigger.trigger_moves.len() + finish.moves.len();
            let candidate = HtrCombinedResult {
                ok: true,
                trigger_moves: trigger.trigger_moves,
                finish_moves: finish.moves,
                total_length: total_len,
                nodes: trigger.nodes + finish.nodes,
            };

            if best.is_none() || total_len < best.as_ref().unwrap().total_length {
                best = Some(candidate);
            }
        }
    }

    best
}

pub fn search_htr_reduction_and_finish(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &TwophaseTables,
    prune: &HtrPruningTables,
    max_reduction_depth: u8,
    max_finish_depth: u8,
    reduction_node_limit: u64,
    finish_node_limit: u64,
) -> Option<HtrCombinedResult> {
    let mut best: Option<HtrCombinedResult> = None;
    let mut path = Vec::new();
    let mut nodes = 0u64;

    fn dfs(
        cp: usize,
        ep: usize,
        sep: usize,
        depth: u8,
        path: &mut Vec<u8>,
        tables: &TwophaseTables,
        prune: &HtrPruningTables,
        max_reduction_depth: u8,
        max_finish_depth: u8,
        reduction_node_limit: u64,
        finish_node_limit: u64,
        nodes: &mut u64,
        best: &mut Option<HtrCombinedResult>,
    ) {
        if *nodes > reduction_node_limit {
            return;
        }
        *nodes += 1;

        if best.as_ref().map_or(false, |b| path.len() >= b.total_length) {
            return;
        }

        let finish = solve_htr_finish(cp, ep, sep, tables, prune, max_finish_depth, finish_node_limit);
        if finish.ok {
            let total_len = path.len() + finish.moves.len();
            if best.as_ref().map_or(true, |b| total_len < b.total_length) {
                *best = Some(HtrCombinedResult {
                    ok: true,
                    trigger_moves: path.clone(),
                    finish_moves: finish.moves,
                    total_length: total_len,
                    nodes: *nodes + finish.nodes,
                });
            }
        }

        if depth >= max_reduction_depth {
            return;
        }

        for &slot in &DR_SLOTS {
            let face = tables.phase2_move_faces[slot] as usize;
            if depth > 0 && face == last_phase2_face(path, tables) {
                continue;
            }

            let new_cp = tables.phase2_cp_move.get(cp, slot) as usize;
            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            path.push(slot as u8);
            dfs(
                new_cp,
                new_ep,
                new_sep,
                depth + 1,
                path,
                tables,
                prune,
                max_reduction_depth,
                max_finish_depth,
                reduction_node_limit,
                finish_node_limit,
                nodes,
                best,
            );
            path.pop();
        }
    }

    dfs(
        start_cp,
        start_ep,
        start_sep,
        0,
        &mut path,
        tables,
        prune,
        max_reduction_depth,
        max_finish_depth,
        reduction_node_limit,
        finish_node_limit,
        &mut nodes,
        &mut best,
    );

    best
}

/// Phase2 local move indices used by HTR_TRIGGERS:
/// [U, U2, U', D, D2, D', R2, L2, F2, B2]
/// Local indices: 0=U, 1=U2, 2=U', 3=D, 4=D2, 5=D', 6=R2, 7=L2, 8=F2, 9=B2
fn apply_moves_to_coords(
    mut cp: usize,
    mut ep: usize,
    mut sep: usize,
    moves: &[u8],
    tables: &TwophaseTables,
) -> (usize, usize, usize) {
    for &local in moves {
        let slot = local as usize;
        cp = tables.phase2_cp_move.get(cp, slot) as usize;
        ep = tables.phase2_ep_move.get(ep, slot) as usize;
        sep = tables.phase2_sep_move.get(sep, slot) as usize;
    }
    (cp, ep, sep)
}

/// Search for DR-breaking triggers that lead to HTR-solvable states.
/// Unlike the blind DR reduction search, this uses the structure of HTR triggers
/// to efficiently find domino reduction -> HTR transitions.
pub fn search_dr_breaking_trigger(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &TwophaseTables,
    prune: &HtrPruningTables,
    max_trigger_depth: u8,
    max_finish_depth: u8,
    trigger_node_limit: u64,
    finish_node_limit: u64,
) -> Option<HtrCombinedResult> {
    let subset = classify_htr_subset(start_cp as u32, start_ep as u32, start_sep as u32);

    if subset.quality == 0 {
        return None;
    }

    let mut best: Option<HtrCombinedResult> = None;
    let mut nodes = 0u64;

    for trigger in HTR_TRIGGERS.iter() {
        if trigger.subset != subset.cxe_type && subset.cxe_type != 0 {
            continue;
        }

        let global_trigger = to_global_indices(trigger.local_moves);

        let (new_cp, new_ep, new_sep) =
            apply_moves_to_coords(start_cp, start_ep, start_sep, &global_trigger, tables);

        let finish =
            solve_htr_finish(new_cp, new_ep, new_sep, tables, prune, max_finish_depth, finish_node_limit);

        nodes += finish.nodes;

        if finish.ok {
            let trigger_global = to_global_indices(trigger.local_moves);
            let total_len = trigger_global.len() + finish.moves.len();

            if best.is_none()
                || total_len < best.as_ref().unwrap().total_length
            {
                best = Some(HtrCombinedResult {
                    ok: true,
                    trigger_moves: trigger_global,
                    finish_moves: finish.moves,
                    total_length: total_len,
                    nodes,
                });
            }
        }

        if nodes > trigger_node_limit {
            break;
        }
    }

    best
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TinyMoveTable;

    impl CoordMoveTable for TinyMoveTable {
        fn get_coord(&self, state: usize, slot: usize) -> u16 {
            match (state, slot) {
                (0, 1) => 1,
                (1, 1) => 2,
                _ => state as u16,
            }
        }
    }

    #[test]
    fn bfs_coord_dist_uses_half_turn_slots() {
        let dist = bfs_coord_dist(3, 0, &TinyMoveTable);

        assert_eq!(dist, vec![0, 1, 2]);
    }

    #[test]
    fn htr_lower_bound_uses_maximum_split_distance() {
        let prune = HtrPruningTables {
            cp: vec![0, 2],
            ep: vec![0, 5],
            sep: vec![0, 3],
        };

        assert_eq!(htr_lower_bound(1, 1, 1, &prune), 5);
    }
}
