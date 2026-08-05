from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one {label} match, found {count}")
    return text.replace(old, new, 1)


rust_path = Path("solver-wasm/src/twophase_search.rs")
rust = rust_path.read_text()
rust = replace_once(
    rust,
    '''pub struct TwophaseExactOptions {
    #[serde(rename = "maxTotalDepth")]
    pub max_total_depth: u8,
    #[serde(rename = "phase1NodeLimit", default)]''',
    '''pub struct TwophaseExactOptions {
    #[serde(rename = "maxTotalDepth")]
    pub max_total_depth: u8,
    #[serde(rename = "excludedSolution", default)]
    pub excluded_solution: Option<String>,
    #[serde(rename = "phase1NodeLimit", default)]''',
    "exact excluded option",
)
rust = replace_once(
    rust,
    '''struct Phase2SearchCtx<'a, 'b> {
    tables: &'a TwophaseTables,
    path: Vec<u8>,
    nodes: u64,
    node_limit: u64,
    node_limit_hit: bool,
    fail_cache: &'b mut FixedFailTable,
}''',
    '''struct Phase2SearchCtx<'a, 'b> {
    tables: &'a TwophaseTables,
    path: Vec<u8>,
    nodes: u64,
    node_limit: u64,
    node_limit_hit: bool,
    excluded_global_path: Option<Vec<u8>>,
    fail_cache: &'b mut FixedFailTable,
}''',
    "phase2 excluded field",
)
rust = replace_once(
    rust,
    '''        if cp == 0 && ep == 0 && sep == 0 {
            return FOUND_SENTINEL;
        }

        let remaining = (bound - depth) as u32;
        let cache_key = ((((cp as u64) * 40320 + ep as u64) * SEP_SIZE as u64 + sep as u64) * 7)
            + last_face as u64;
        let seen_mask = self.fail_cache.get(cache_key);''',
    '''        if cp == 0 && ep == 0 && sep == 0 {
            let is_excluded = self.excluded_global_path.as_ref().map_or(false, |excluded| {
                excluded.len() == self.path.len()
                    && self
                        .path
                        .iter()
                        .zip(excluded.iter())
                        .all(|(&local_index, &global_index)| {
                            self.tables.phase2_move_indices[local_index as usize] == global_index
                        })
            });
            if !is_excluded {
                return FOUND_SENTINEL;
            }
            return (bound as u16) + 1;
        }

        let remaining = (bound - depth) as u32;
        let cache_key = ((((cp as u64) * 40320 + ep as u64) * SEP_SIZE as u64 + sep as u64) * 7)
            + last_face as u64;
        let seen_mask = if self.excluded_global_path.is_none() {
            self.fail_cache.get(cache_key)
        } else {
            0
        };''',
    "phase2 solved exclusion",
)
rust = replace_once(
    rust,
    '''        self.fail_cache.insert_or(cache_key, bit);
        min_next.unwrap_or((bound as u16) + 1)''',
    '''        if self.excluded_global_path.is_none() {
            self.fail_cache.insert_or(cache_key, bit);
        }
        min_next.unwrap_or((bound as u16) + 1)''',
    "phase2 exclusion-safe cache",
)
rust = replace_once(
    rust,
    '''pub(crate) fn solve_phase2(
    input: &Phase2Input,
    tables: &TwophaseTables,
    max_depth: u8,
    node_limit: u64,
) -> Phase2SolveResult {
    if input.cp_idx == 0 && input.ep_idx == 0 && input.sep_idx == 0 {
        return Phase2SolveResult {''',
    '''fn solve_phase2_excluding(
    input: &Phase2Input,
    tables: &TwophaseTables,
    max_depth: u8,
    node_limit: u64,
    excluded_global_path: Option<&[u8]>,
) -> Phase2SolveResult {
    if input.cp_idx == 0
        && input.ep_idx == 0
        && input.sep_idx == 0
        && !excluded_global_path.map_or(false, |path| path.is_empty())
    {
        return Phase2SolveResult {''',
    "phase2 excluding signature",
)
rust = replace_once(
    rust,
    '''        node_limit,
        node_limit_hit: false,
        fail_cache: &mut fail_cache,
    };''',
    '''        node_limit,
        node_limit_hit: false,
        excluded_global_path: excluded_global_path.map(|path| path.to_vec()),
        fail_cache: &mut fail_cache,
    };''',
    "phase2 excluded initialization",
)
rust = replace_once(
    rust,
    '''    Phase2SolveResult {
        ok: false,
        moves: Vec::new(),
        depth: 0,
        nodes: ctx.nodes,
        reason: if ctx.node_limit_hit {
            "PHASE2_SEARCH_LIMIT".into()
        } else {
            "PHASE2_NOT_FOUND".into()
        },
    }
}

fn run_phase2_pass(''',
    '''    Phase2SolveResult {
        ok: false,
        moves: Vec::new(),
        depth: 0,
        nodes: ctx.nodes,
        reason: if ctx.node_limit_hit {
            "PHASE2_SEARCH_LIMIT".into()
        } else {
            "PHASE2_NOT_FOUND".into()
        },
    }
}

pub(crate) fn solve_phase2(
    input: &Phase2Input,
    tables: &TwophaseTables,
    max_depth: u8,
    node_limit: u64,
) -> Phase2SolveResult {
    solve_phase2_excluding(input, tables, max_depth, node_limit, None)
}

fn run_phase2_pass(''',
    "phase2 public wrapper",
)
rust = replace_once(
    rust,
    '''    interrupt_reason: String,
    fail_cache: HashMap<u128, u32>,
    found_path: Option<Vec<u8>>,
}''',
    '''    interrupt_reason: String,
    fail_cache: HashMap<u128, u32>,
    excluded_path: Option<Vec<u8>>,
    found_path: Option<Vec<u8>>,
}''',
    "exact excluded field",
)
rust = replace_once(
    rust,
    '''        if let Some(mask) = self.fail_cache.get(&cache_key) {
            if remaining_phase1 < 32 && (mask & (1u32 << remaining_phase1)) != 0 {
                return false;
            }
        }''',
    '''        if self.excluded_path.is_none() {
            if let Some(mask) = self.fail_cache.get(&cache_key) {
                if remaining_phase1 < 32 && (mask & (1u32 << remaining_phase1)) != 0 {
                    return false;
                }
            }
        }''',
    "exact exclusion-safe cache read",
)
rust = replace_once(
    rust,
    '''            let phase2 = solve_phase2(
                &phase2_input,
                self.tables,
                total_bound - target_phase1_depth,
                self.remaining_phase2_budget(),
            );''',
    '''            let excluded_suffix = self.excluded_path.as_ref().and_then(|excluded| {
                excluded
                    .starts_with(&self.path)
                    .then(|| excluded[self.path.len()..].to_vec())
            });
            let phase2 = solve_phase2_excluding(
                &phase2_input,
                self.tables,
                total_bound - target_phase1_depth,
                self.remaining_phase2_budget(),
                excluded_suffix.as_deref(),
            );''',
    "exact phase2 exclusion",
)
rust = replace_once(
    rust,
    '''        if remaining_phase1 < 32 {
            if self.fail_cache.len() >= PHASE1_EXACT_FAIL_CACHE_LIMIT {''',
    '''        if self.excluded_path.is_none() && remaining_phase1 < 32 {
            if self.fail_cache.len() >= PHASE1_EXACT_FAIL_CACHE_LIMIT {''',
    "exact exclusion-safe cache write",
)
rust = replace_once(
    rust,
    '''    let initial_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
    let co_idx = encode_co(&initial_state.co);''',
    '''    let excluded_path = options
        .excluded_solution
        .as_deref()
        .and_then(|solution| parse_scramble(solution, &tables.move_data).ok());
    let initial_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
    let co_idx = encode_co(&initial_state.co);''',
    "parse exact excluded path",
)
rust = replace_once(
    rust,
    '''        interrupt_reason: String::new(),
        fail_cache: HashMap::new(),
        found_path: None,
    };''',
    '''        interrupt_reason: String::new(),
        fail_cache: HashMap::new(),
        excluded_path,
        found_path: None,
    };''',
    "exact excluded context initialization",
)
rust_path.write_text(rust)

minmove_path = Path("solver/minmoveExactV2.js")
minmove = minmove_path.read_text()
minmove = replace_once(
    minmove,
    '''        if (incumbentLength > 0 && candidateLength > incumbentLength) continue;
        return {''',
    '''        return {''',
    "allow longer nontrivial seed",
)
minmove = replace_once(
    minmove,
    '''    if (!candidateSolution || candidateLength > incumbentLength) continue;
    if (shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)) continue;''',
    '''    if (!candidateSolution || (incumbentSolution && candidateLength > incumbentLength)) continue;
    if (shouldRejectLiteralInverseSolution(normalizedScramble, candidateSolution)) continue;''',
    "accept first longer seed",
)
minmove = replace_once(
    minmove,
    '''      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: targetBound,
        phase1NodeLimit: profile.phase1NodeLimit,''',
    '''      const searched = await searchTwophaseExact333(normalizedScramble, {
        maxTotalDepth: targetBound,
        excludedSolution: rejectLiteralInverse ? inverseScramble : undefined,
        phase1NodeLimit: profile.phase1NodeLimit,''',
    "exact excluded solution option",
)
minmove_path.write_text(minmove)

Path("tools/apply-exact-inverse-exclusion.py").unlink(missing_ok=True)
