use crate::twophase_bundle::TwophaseTables;
use rustc_hash::FxHashMap;

const HTR_SLOTS: [usize; 6] = [1, 4, 6, 7, 8, 9];
const HTR_FACE_OF_SLOT: [usize; 6] = [0, 1, 2, 3, 4, 5];

static mut HTR_TABLE_DATA: Option<FxHashMap<(usize, usize, usize), Vec<u8>>> = None;

pub fn init_htr_table(tables: &TwophaseTables, max_depth: u8) {
    let mut triggers: FxHashMap<(usize, usize, usize), Vec<u8>> = FxHashMap::default();
    let mut queue = Vec::new();
    let mut visited: FxHashMap<(usize, usize, usize), u8> = FxHashMap::default();

    queue.push((0usize, 0usize, 0usize, vec![]));
    visited.insert((0, 0, 0), 0);

    let mut states_processed = 0usize;

    while let Some((cp, ep, sep, path)) = queue.pop() {
        let depth = path.len() as u8;

        if depth > 0 {
            triggers.insert((cp, ep, sep), path.clone());
        }

        if depth >= max_depth {
            continue;
        }

        for (i, &slot) in HTR_SLOTS.iter().enumerate() {
            if depth > 0 {
                let last_face = if let Some(&last_slot) = path.last() {
                    HTR_FACE_OF_SLOT[HTR_SLOTS.iter().position(|&s| s == last_slot as usize).unwrap_or(0)]
                } else {
                    999
                };
                if HTR_FACE_OF_SLOT[i] == last_face {
                    continue;
                }
            }

            let new_cp = tables.phase2_cp_move.get(cp, slot) as usize;
            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            let key = (new_cp, new_ep, new_sep);
            if !visited.contains_key(&key) || visited.get(&key).copied().unwrap_or(255) > depth + 1 {
                visited.insert(key, depth + 1);
                let mut new_path = path.clone();
                new_path.push(slot as u8);
                queue.push((new_cp, new_ep, new_sep, new_path));
                states_processed += 1;
            }
        }
    }

    unsafe {
        HTR_TABLE_DATA = Some(triggers);
    }
}

#[inline]
pub fn get_trigger(cp: usize, ep: usize, sep: usize) -> Option<Vec<u8>> {
    unsafe {
        HTR_TABLE_DATA.as_ref()?.get(&(cp, ep, sep)).cloned()
    }
}

#[inline]
pub fn has_trigger(cp: usize, ep: usize, sep: usize) -> bool {
    unsafe {
        HTR_TABLE_DATA.as_ref().map_or(false, |t| t.contains_key(&(cp, ep, sep)))
    }
}

#[derive(Clone, Debug)]
pub struct HtrCombinedResult {
    pub ok: bool,
    pub trigger_moves: Vec<u8>,
    pub finish_moves: Vec<u8>,
    pub total_length: usize,
    pub nodes: u64,
}

fn last_face_idx(path: &[u8]) -> usize {
    if path.is_empty() {
        return 999;
    }
    let last_slot = path[path.len() - 1] as usize;
    HTR_FACE_OF_SLOT[HTR_SLOTS.iter().position(|&s| s == last_slot).unwrap_or(0)]
}

pub fn solve_htr_finish(
    ep: usize,
    sep: usize,
    tables: &TwophaseTables,
    max_depth: u8,
    node_limit: u64,
) -> (bool, Vec<u8>, u64) {
    if ep == 0 && sep == 0 {
        return (true, vec![], 0);
    }

    let bound = tables.phase2_ep.get(ep).max(1) as u8;

    let mut nodes = 0u64;
    let mut path = Vec::new();

    fn dfs(
        ep: usize,
        sep: usize,
        depth: u8,
        bound: u8,
        path: &mut Vec<u8>,
        tables: &TwophaseTables,
        max_depth: u8,
        node_limit: u64,
        nodes: &mut u64,
    ) -> i32 {
        if *nodes > node_limit {
            return -1;
        }
        *nodes += 1;

        if ep == 0 && sep == 0 {
            return depth as i32;
        }

        let prune_ep = tables.phase2_ep.get(ep) as u8;
        if depth + prune_ep > bound {
            return -1;
        }

        for (i, &slot) in HTR_SLOTS.iter().enumerate() {
            if depth > 0 && HTR_FACE_OF_SLOT[i] == last_face_idx(path) {
                continue;
            }

            let new_ep = tables.phase2_ep_move.get(ep, slot) as usize;
            let new_sep = tables.phase2_sep_move.get(sep, slot) as usize;

            path.push(slot as u8);
            let result = dfs(new_ep, new_sep, depth + 1, bound, path, tables, max_depth, node_limit, nodes);
            if result >= 0 {
                return result;
            }
            path.pop();
        }

        -1
    }

    let mut current_bound = bound;
    while current_bound <= max_depth {
        let result = dfs(ep, sep, 0, current_bound, &mut path, tables, max_depth, node_limit, &mut nodes);
        if result >= 0 {
            return (true, path.clone(), nodes);
        }
        current_bound += 1;
    }

    (false, vec![], nodes)
}

pub fn search_htr_triggers_and_finish(
    start_cp: usize,
    start_ep: usize,
    start_sep: usize,
    tables: &TwophaseTables,
    _max_trigger_depth: u8,
    max_finish_depth: u8,
    _trigger_node_limit: u64,
    finish_node_limit: u64,
) -> Option<HtrCombinedResult> {
    if start_cp == 0 && start_ep == 0 && start_sep == 0 {
        return Some(HtrCombinedResult {
            ok: true,
            trigger_moves: vec![],
            finish_moves: vec![],
            total_length: 0,
            nodes: 0,
        });
    }

    let trigger = get_trigger(start_cp, start_ep, start_sep)?;
    let trigger_len = trigger.len();

    let mut current_ep = start_ep;
    let mut current_sep = start_sep;
    for slot in &trigger {
        current_ep = tables.phase2_ep_move.get(current_ep, *slot as usize) as usize;
        current_sep = tables.phase2_sep_move.get(current_sep, *slot as usize) as usize;
    }

    if current_ep == 0 && current_sep == 0 {
        return Some(HtrCombinedResult {
            ok: true,
            trigger_moves: trigger,
            finish_moves: vec![],
            total_length: trigger_len,
            nodes: 0,
        });
    }

    let (finish_ok, finish_moves, finish_nodes) = solve_htr_finish(
        current_ep,
        current_sep,
        tables,
        max_finish_depth,
        finish_node_limit,
    );

    if finish_ok {
        let finish_len = finish_moves.len();
        Some(HtrCombinedResult {
            ok: true,
            trigger_moves: trigger,
            finish_moves,
            total_length: trigger_len + finish_len,
            nodes: finish_nodes,
        })
    } else {
        None
    }
}