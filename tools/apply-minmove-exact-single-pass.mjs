import fs from "node:fs";

const path = "solver-wasm/src/twophase_search.rs";
let source = fs.readFileSync(path, "utf8");

if (source.includes("MINMOVE_EXACT_SINGLE_PASS_V1")) {
  console.log("single-pass exact minmove already applied");
  process.exit(0);
}

const pattern = /struct ExactPhase1SearchCtx<'a> \{[\s\S]*?\n\}\n\npub fn search_twophase_exact_bound\([\s\S]*?\n\}\n\nimpl TwophaseSession \{/;
if (!pattern.test(source)) {
  throw new Error("Could not locate exact two-phase search block");
}

const replacement = `// MINMOVE_EXACT_SINGLE_PASS_V1
struct ExactPhase1SearchCtx<'a> {
    tables: &'a TwophaseTables,
    path: Vec<u8>,
    phase1_nodes: u64,
    phase2_nodes: u64,
    phase1_node_limit: u64,
    phase2_node_limit: u64,
    interrupted: bool,
    interrupt_reason: String,
    // Maximum remaining total depth already proven impossible for this exact
    // cube state and previous face. A proof at r also proves every r' <= r.
    fail_cache: HashMap<u128, u8>,
    // Phase-2 subgroup states recur through different phase-1 prefixes. Cache
    // the largest failed phase-2 allowance to avoid restarting the same IDA*.
    phase2_fail_cache: HashMap<u64, u8>,
    found_path: Option<Vec<u8>>,
}

impl<'a> ExactPhase1SearchCtx<'a> {
    #[inline(always)]
    fn cache_key(&self, state: &CubeState, co: usize, eo: usize, last_face: u8) -> u128 {
        let cp_idx = encode_perm8(&state.cp) as u128;
        let ep_idx = encode_perm12(&state.ep) as u128;
        let mut key = cp_idx;
        key |= (co as u128) << 16;
        key |= (eo as u128) << 28;
        key |= ep_idx << 39;
        key |= (last_face as u128) << 68;
        key
    }

    #[inline(always)]
    fn phase2_cache_key(input: &Phase2Input) -> u64 {
        (((input.cp_idx as u64) * 40_320 + input.ep_idx as u64) * SEP_SIZE as u64)
            + input.sep_idx as u64
    }

    #[inline(always)]
    fn remaining_phase2_budget(&self) -> u64 {
        if self.phase2_node_limit == 0 {
            0
        } else {
            self.phase2_node_limit.saturating_sub(self.phase2_nodes)
        }
    }

    fn remember_failure(&mut self, key: u128, remaining: u8) {
        if self.fail_cache.len() >= PHASE1_EXACT_FAIL_CACHE_LIMIT {
            self.fail_cache.clear();
        }
        self.fail_cache
            .entry(key)
            .and_modify(|stored| *stored = (*stored).max(remaining))
            .or_insert(remaining);
    }

    fn remember_phase2_failure(&mut self, key: u64, remaining: u8) {
        if self.phase2_fail_cache.len() >= PHASE1_EXACT_FAIL_CACHE_LIMIT {
            self.phase2_fail_cache.clear();
        }
        self.phase2_fail_cache
            .entry(key)
            .and_modify(|stored| *stored = (*stored).max(remaining))
            .or_insert(remaining);
    }

    fn dfs(
        &mut self,
        state: &CubeState,
        co: usize,
        eo: usize,
        slice: usize,
        depth: u8,
        total_bound: u8,
        last_face: u8,
    ) -> bool {
        if self.interrupted || self.found_path.is_some() {
            return self.found_path.is_some();
        }

        let remaining = total_bound.saturating_sub(depth);
        let phase1_h = self
            .tables
            .co
            .get(co)
            .max(self.tables.eo.get(eo))
            .max(self.tables.slice.get(slice));
        if phase1_h > remaining {
            return false;
        }

        let cache_key = self.cache_key(state, co, eo, last_face);
        if self
            .fail_cache
            .get(&cache_key)
            .is_some_and(|&proved_remaining| proved_remaining >= remaining)
        {
            return false;
        }

        // Any optimal solution has a final entry into the phase-2 subgroup.
        // Test the suffix whenever the current state is in that subgroup, while
        // continuing phase 1 afterwards so paths that leave and re-enter remain covered.
        if co == 0 && eo == 0 && slice == self.tables.solved_slice as usize {
            if let Some(phase2_input) = build_phase2_input(state) {
                let phase2_h = self
                    .tables
                    .phase2_cp_sep_joint
                    .get(phase2_input.cp_idx * SEP_SIZE + phase2_input.sep_idx)
                    .max(self.tables.phase2_ep.get(phase2_input.ep_idx));
                if phase2_h <= remaining {
                    let phase2_key = Self::phase2_cache_key(&phase2_input);
                    let already_failed = self
                        .phase2_fail_cache
                        .get(&phase2_key)
                        .is_some_and(|&proved_remaining| proved_remaining >= remaining);
                    if !already_failed {
                        if self.phase2_node_limit > 0 && self.remaining_phase2_budget() == 0 {
                            self.interrupted = true;
                            self.interrupt_reason = "PHASE2_SEARCH_LIMIT".into();
                            return false;
                        }
                        let phase2 = solve_phase2(
                            &phase2_input,
                            self.tables,
                            remaining,
                            self.remaining_phase2_budget(),
                        );
                        self.phase2_nodes += phase2.nodes;
                        if phase2.ok {
                            let mut full_path = self.path.clone();
                            for &phase2_move in &phase2.moves {
                                full_path.push(
                                    self.tables.phase2_move_indices[phase2_move as usize],
                                );
                            }
                            self.found_path = Some(full_path);
                            return true;
                        }
                        if phase2.reason == "PHASE2_SEARCH_LIMIT" {
                            self.interrupted = true;
                            self.interrupt_reason = phase2.reason;
                            return false;
                        }
                        self.remember_phase2_failure(phase2_key, remaining);
                    }
                }
            }
        }

        if depth >= total_bound {
            self.remember_failure(cache_key, remaining);
            return false;
        }

        for &move_index in &self.tables.phase1_allowed_moves_by_last_face[last_face as usize] {
            self.phase1_nodes += 1;
            if self.phase1_node_limit > 0 && self.phase1_nodes >= self.phase1_node_limit {
                self.interrupted = true;
                self.interrupt_reason = "PHASE1_SEARCH_LIMIT".into();
                return false;
            }

            let next_co = self.tables.co_move.get(co, move_index as usize) as usize;
            let next_eo = self.tables.eo_move.get(eo, move_index as usize) as usize;
            let next_slice = self.tables.slice_move.get(slice, move_index as usize) as usize;
            let next_state = state.apply_move(move_index as usize, &self.tables.move_data);
            self.path.push(move_index);
            let next_face = self.tables.move_data.move_face[move_index as usize];
            if self.dfs(
                &next_state,
                next_co,
                next_eo,
                next_slice,
                depth + 1,
                total_bound,
                next_face,
            ) {
                return true;
            }
            self.path.pop();
            if self.interrupted {
                return false;
            }
        }

        self.remember_failure(cache_key, remaining);
        false
    }
}

pub fn search_twophase_exact_bound(
    scramble: &str,
    tables: &TwophaseTables,
    options: &TwophaseExactOptions,
) -> TwophaseExactSearchResult {
    let moves = match parse_scramble(scramble, &tables.move_data) {
        Ok(moves) => moves,
        Err(reason) => {
            return TwophaseExactSearchResult {
                ok: false,
                found: false,
                interrupted: false,
                solution: String::new(),
                move_count: 0,
                nodes: 0,
                phase1_nodes: 0,
                phase2_nodes: 0,
                bound: options.max_total_depth,
                reason,
            };
        }
    };

    let initial_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
    let co_idx = encode_co(&initial_state.co);
    let eo_idx = encode_eo(&initial_state.eo);
    let slice_idx = encode_slice_from_ep(&initial_state.ep);
    let mut ctx = ExactPhase1SearchCtx {
        tables,
        path: Vec::with_capacity(options.max_total_depth as usize),
        phase1_nodes: 0,
        phase2_nodes: 0,
        phase1_node_limit: options.phase1_node_limit,
        phase2_node_limit: options.phase2_node_limit,
        interrupted: false,
        interrupt_reason: String::new(),
        fail_cache: HashMap::new(),
        phase2_fail_cache: HashMap::new(),
        found_path: None,
    };

    let found = ctx.dfs(
        &initial_state,
        co_idx,
        eo_idx,
        slice_idx,
        0,
        options.max_total_depth,
        LAST_FACE_FREE,
    );

    if let Some(path) = ctx.found_path {
        let solution = solution_string_from_path(&path, &tables.move_data);
        return TwophaseExactSearchResult {
            ok: true,
            found,
            interrupted: false,
            move_count: path.len() as u32,
            nodes: ctx.phase1_nodes + ctx.phase2_nodes,
            phase1_nodes: ctx.phase1_nodes,
            phase2_nodes: ctx.phase2_nodes,
            bound: options.max_total_depth,
            solution,
            reason: String::new(),
        };
    }

    TwophaseExactSearchResult {
        ok: true,
        found: false,
        interrupted: ctx.interrupted,
        solution: String::new(),
        move_count: 0,
        nodes: ctx.phase1_nodes + ctx.phase2_nodes,
        phase1_nodes: ctx.phase1_nodes,
        phase2_nodes: ctx.phase2_nodes,
        bound: options.max_total_depth,
        reason: if ctx.interrupt_reason.is_empty() {
            String::new()
        } else {
            ctx.interrupt_reason
        },
    }
}

impl TwophaseSession {`;

source = source.replace(pattern, replacement);
fs.writeFileSync(path, source);
console.log("applied single-pass exact minmove search");
