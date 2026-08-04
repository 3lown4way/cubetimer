import fs from "node:fs";

const path = "solver-wasm/src/fmc_search.rs";
let source = fs.readFileSync(path, "utf8");

if (source.includes("fn htr_coordinate_key(")) {
  console.log("Compact HTR coordinate table already applied");
  process.exit(0);
}

source = source.replace(
  "const FMC_HTR_TAIL_SLACK: usize = 2;",
  "const FMC_HTR_TAIL_SLACK: usize = 2;\n\n/// Safety ceiling for the compact HTR coordinate table. The expected exact\n/// subgroup is below this bound; reaching it leaves a safe partial table rather\n/// than exhausting WASM linear memory.\nconst FMC_HTR_STATE_LIMIT: usize = 1_000_000;",
);

source = source.replace(
  "htr_first_move: OnceCell<std::collections::HashMap<u128, u8>>",
  "htr_first_move: OnceCell<std::collections::HashMap<u64, u8>>",
);

const start = source.indexOf("fn htr_permutation_key(");
const end = source.indexOf("fn find_htr_tail_from_p2(", start);
if (start < 0 || end < 0) {
  throw new Error("Could not locate legacy HTR table implementation");
}

const replacement = `fn htr_coordinate_key(cp_idx: usize, ep_idx: usize, sep_idx: usize) -> u64 {
    (cp_idx as u64) | ((ep_idx as u64) << 16) | ((sep_idx as u64) << 32)
}

fn htr_half_turn_local_moves(tables: &TwophaseTables) -> Vec<u8> {
    tables
        .phase2_move_indices
        .iter()
        .enumerate()
        .filter_map(|(local, &global)| {
            FMC_HTR_HALF_TURN_MOVES
                .contains(&global)
                .then_some(local as u8)
        })
        .collect()
}

fn build_htr_first_move_table(tables: &TwophaseTables) -> std::collections::HashMap<u64, u8> {
    let half_turn_moves = htr_half_turn_local_moves(tables);
    let mut first_move = std::collections::HashMap::<u64, u8>::new();
    let mut queue = std::collections::VecDeque::<(usize, usize, usize)>::new();
    first_move.insert(htr_coordinate_key(0, 0, 0), 255);
    queue.push_back((0, 0, 0));

    while let Some((cp_idx, ep_idx, sep_idx)) = queue.pop_front() {
        for &local_move in &half_turn_moves {
            let local = local_move as usize;
            let next_cp = tables.phase2_cp_move.get(cp_idx, local) as usize;
            let next_ep = tables.phase2_ep_move.get(ep_idx, local) as usize;
            let next_sep = tables.phase2_sep_move.get(sep_idx, local) as usize;
            let key = htr_coordinate_key(next_cp, next_ep, next_sep);
            if first_move.contains_key(&key) {
                continue;
            }
            if first_move.len() >= FMC_HTR_STATE_LIMIT {
                continue;
            }
            // Every HTR generator is a half turn and therefore self-inverse.
            first_move.insert(key, local_move);
            queue.push_back((next_cp, next_ep, next_sep));
        }
    }
    first_move
}

fn htr_finish_moves(
    state: &CubeState,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
) -> Option<Vec<u8>> {
    if state.co.iter().any(|&value| value != 0) || state.eo.iter().any(|&value| value != 0) {
        return None;
    }
    let input = build_p2_input(state)?;
    let table = fmc_tables
        .htr_first_move
        .get_or_init(|| build_htr_first_move_table(tables));
    let mut cp_idx = input.cp_idx;
    let mut ep_idx = input.ep_idx;
    let mut sep_idx = input.sep_idx;
    let mut moves = Vec::new();
    let mut guard = 0usize;
    loop {
        let local_move = *table.get(&htr_coordinate_key(cp_idx, ep_idx, sep_idx))?;
        if local_move == 255 {
            return Some(moves);
        }
        let local = local_move as usize;
        moves.push(tables.phase2_move_indices[local]);
        cp_idx = tables.phase2_cp_move.get(cp_idx, local) as usize;
        ep_idx = tables.phase2_ep_move.get(ep_idx, local) as usize;
        sep_idx = tables.phase2_sep_move.get(sep_idx, local) as usize;
        guard += 1;
        if guard > 40 {
            return None;
        }
    }
}

`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
console.log("Applied compact bounded HTR coordinate table");
