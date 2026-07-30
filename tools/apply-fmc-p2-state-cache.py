from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
source = path.read_text(encoding="utf-8")

marker = "// --- Single-Axis EO→DR→P2 Pipeline ---\n"
cache_impl = r'''#[derive(Default)]
struct FmcP2Cache {
    solved: std::collections::HashMap<(usize, usize, usize, u64), Vec<u8>>,
    exact_failed: std::collections::HashSet<(usize, usize, usize, u8, u64)>,
    lookups: u64,
    hits: u64,
    searches: u64,
}

impl FmcP2Cache {
    fn solve(
        &mut self,
        input: &Phase2Input,
        tables: &TwophaseTables,
        max_depth: u8,
        node_limit: u64,
    ) -> Option<Vec<u8>> {
        self.lookups += 1;
        let solved_key = (input.cp_idx, input.ep_idx, input.sep_idx, node_limit);
        if let Some(moves) = self.solved.get(&solved_key) {
            if moves.len() <= max_depth as usize {
                self.hits += 1;
                return Some(moves.clone());
            }
        }

        let failed_key = (
            input.cp_idx,
            input.ep_idx,
            input.sep_idx,
            max_depth,
            node_limit,
        );
        if self.exact_failed.contains(&failed_key) {
            self.hits += 1;
            return None;
        }

        self.searches += 1;
        let result = solve_phase2(input, tables, max_depth, node_limit);
        if result.ok {
            self.solved.insert(solved_key, result.moves.clone());
            Some(result.moves)
        } else {
            self.exact_failed.insert(failed_key);
            None
        }
    }
}

'''
if "struct FmcP2Cache" in source:
    raise SystemExit("FmcP2Cache already present")
if marker not in source:
    raise SystemExit("single-axis marker not found")
source = source.replace(marker, cache_impl + marker, 1)

old_signature = """    max_p2_depth: u8,\n    p2_node_limit: u64,\n    current_best: &mut usize,\n"""
new_signature = """    max_p2_depth: u8,\n    p2_node_limit: u64,\n    p2_cache: &mut FmcP2Cache,\n    current_best: &mut usize,\n"""
if source.count(old_signature) != 1:
    raise SystemExit(f"unexpected solve signature count: {source.count(old_signature)}")
source = source.replace(old_signature, new_signature, 1)

old_p2 = """            let p2_cap = (*current_best - partial_len).min(max_p2_depth as usize) as u8;\n            let p2_result = solve_phase2(&p2_input, tables, p2_cap, p2_node_limit);\n            if !p2_result.ok {\n                continue;\n            }\n            let p2_global: Vec<u8> = p2_result\n                .moves\n                .iter()\n"""
new_p2 = """            let p2_cap = (*current_best - partial_len).min(max_p2_depth as usize) as u8;\n            let p2_moves = match p2_cache.solve(&p2_input, tables, p2_cap, p2_node_limit) {\n                Some(moves) => moves,\n                None => continue,\n            };\n            let p2_global: Vec<u8> = p2_moves\n                .iter()\n"""
if source.count(old_p2) != 1:
    raise SystemExit(f"unexpected phase-2 block count: {source.count(old_p2)}")
source = source.replace(old_p2, new_p2, 1)

old_init = """    let mut all_candidates: Vec<FmcCandidate> = Vec::new();\n    let mut best_count = 40usize;\n"""
new_init = """    let mut all_candidates: Vec<FmcCandidate> = Vec::new();\n    let mut best_count = 40usize;\n    let mut p2_cache = FmcP2Cache::default();\n"""
if source.count(old_init) != 1:
    raise SystemExit(f"unexpected solver init count: {source.count(old_init)}")
source = source.replace(old_init, new_init, 1)

normal_call = """            FMC_MAX_P2_DEPTH,\n            FMC_P2_NODE_LIMIT,\n            &mut best_count,\n"""
normal_replacement = """            FMC_MAX_P2_DEPTH,\n            FMC_P2_NODE_LIMIT,\n            &mut p2_cache,\n            &mut best_count,\n"""
if source.count(normal_call) != 2:
    raise SystemExit(f"unexpected direct/NISS call count: {source.count(normal_call)}")
source = source.replace(normal_call, normal_replacement)

premove_call = """                    FMC_MAX_P2_DEPTH,\n                    FMC_PM_P2_NODE_LIMIT,\n                    &mut best_count,\n"""
premove_replacement = """                    FMC_MAX_P2_DEPTH,\n                    FMC_PM_P2_NODE_LIMIT,\n                    &mut p2_cache,\n                    &mut best_count,\n"""
if source.count(premove_call) != 2:
    raise SystemExit(f"unexpected premove call count: {source.count(premove_call)}")
source = source.replace(premove_call, premove_replacement)

# Keep counters available to the optimizer without changing the public result schema.
old_return = """    FmcResult {\n        ok: !all_candidates.is_empty(),\n        candidates: all_candidates,\n    }\n"""
new_return = """    let _p2_cache_stats = (p2_cache.lookups, p2_cache.hits, p2_cache.searches);\n\n    FmcResult {\n        ok: !all_candidates.is_empty(),\n        candidates: all_candidates,\n    }\n"""
if source.count(old_return) != 1:
    raise SystemExit(f"unexpected result return count: {source.count(old_return)}")
source = source.replace(old_return, new_return, 1)

path.write_text(source, encoding="utf-8")
