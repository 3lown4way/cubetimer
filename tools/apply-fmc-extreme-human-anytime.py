from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    (ROOT / path).write_text(text)

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"MISSING:{label}")
    return text.replace(old, new, 1)

# ---- Rust WASM option wiring ----
lib_path = "solver-wasm/src/lib.rs"
lib = read(lib_path)
lib = replace_once(
    lib,
    '''    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
}
fn default_max_premove_sets() -> usize {
''',
    '''    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
    #[serde(rename = "searchLevel", default)]
    search_level: u8,
    #[serde(rename = "searchVariant", default)]
    search_variant: u32,
    #[serde(
        rename = "incumbentMoveCount",
        default = "default_fmc_incumbent_move_count"
    )]
    incumbent_move_count: usize,
}
fn default_fmc_incumbent_move_count() -> usize {
    40
}
fn default_max_premove_sets() -> usize {
''',
    "lib options",
)
lib = replace_once(
    lib,
    '''        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
    );
''',
    '''        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.search_level,
        options.search_variant,
        options.incumbent_move_count,
    );
''',
    "lib solve args",
)
write(lib_path, lib)

# ---- Rust human-search widening and diversification ----
fmc_path = "solver-wasm/src/fmc_search.rs"
fmc = read(fmc_path)

fmc = replace_once(
    fmc,
    '''struct EoSearchCtx<'a> {
    tables: &'a TwophaseTables,
    eo_dist: &'a [u8],
    path: Vec<u8>,
    solutions: Vec<Vec<u8>>,
    limit: usize,
}
''',
    '''struct EoSearchCtx<'a> {
    tables: &'a TwophaseTables,
    eo_dist: &'a [u8],
    path: Vec<u8>,
    solutions: Vec<Vec<u8>>,
    limit: usize,
    variant: u32,
}
''',
    "eo ctx",
)

old_loop = '''        for &m in &self.tables.phase1_allowed_moves_by_last_face[last_face as usize] {
            if self.solutions.len() >= self.limit {
                return 255;
            }
'''
new_loop = '''        let allowed = &self.tables.phase1_allowed_moves_by_last_face[last_face as usize];
        let allowed_len = allowed.len();
        let rotation = if allowed_len == 0 {
            0
        } else {
            ((self.variant / 2) as usize) % allowed_len
        };
        for offset in 0..allowed_len {
            let forward_index = (offset + rotation) % allowed_len;
            let index = if self.variant & 1 == 0 {
                forward_index
            } else {
                allowed_len - 1 - forward_index
            };
            let m = allowed[index];
            if self.solutions.len() >= self.limit {
                return 255;
            }
'''
fmc = replace_once(fmc, old_loop, new_loop, "eo variant move order")

fmc = replace_once(
    fmc,
    '''    max_depth: u8,
    limit: usize,
) -> Vec<Vec<u8>> {
''',
    '''    max_depth: u8,
    limit: usize,
    variant: u32,
) -> Vec<Vec<u8>> {
''',
    "find eo signature",
)
fmc = replace_once(
    fmc,
    '''        solutions: Vec::new(),
        limit,
    };
''',
    '''        solutions: Vec::new(),
        limit,
        variant,
    };
''',
    "find eo ctx init",
)

fmc = replace_once(
    fmc,
    '''        FMC_MULTI_NISS_BOUNDARY_EO_LIMIT,
    );
''',
    '''        FMC_MULTI_NISS_BOUNDARY_EO_LIMIT,
        0,
    );
''',
    "boundary eo call",
)

fmc = replace_once(
    fmc,
    '''    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    force_rzp: bool,
''',
    '''    p2_cache: &mut FmcP2Cache,
    current_best: &mut usize,
    search_variant: u32,
    force_rzp: bool,
''',
    "single axis signature",
)
fmc = replace_once(
    fmc,
    '''    let eo_seqs = find_eo_sequences(eo_idx, tables, fmc_tables, max_eo_depth, eo_limit);
''',
    '''    let eo_seqs = find_eo_sequences(
        eo_idx,
        tables,
        fmc_tables,
        max_eo_depth,
        eo_limit,
        search_variant,
    );
''',
    "single axis eo call",
)

fmc = replace_once(
    fmc,
    '''            p2_cache,
            &mut continuation_best,
            force_rzp,
            false,
''',
    '''            p2_cache,
            &mut continuation_best,
            0,
            force_rzp,
            false,
''',
    "continuation variant",
)

fmc = replace_once(
    fmc,
    '''    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    max_eo_depth: u8,
) -> FmcResult {
''',
    '''    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
    max_eo_depth: u8,
) -> FmcResult {
''',
    "with depth signature",
)

fmc = replace_once(
    fmc,
    '''    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut all_skeletons: Vec<FmcSkeletonCandidate> = Vec::new();
''',
    '''    let search_level = search_level.min(3) as usize;
    let direct_eo_limit = [FMC_EO_LIMIT, 12, 24, 48][search_level];
    let premove_eo_limit = [FMC_PM_EO_LIMIT, 6, 12, 24][search_level];
    let p2_node_limit =
        [FMC_P2_NODE_LIMIT, 8_000_000, 24_000_000, 64_000_000][search_level];
    let premove_p2_node_limit =
        [FMC_PM_P2_NODE_LIMIT, 2_000_000, 8_000_000, 20_000_000][search_level];
    let skeleton_beam_limit = [FMC_SKELETON_BEAM_LIMIT, 48, 96, 160][search_level];

    let mut all_candidates: Vec<FmcCandidate> = Vec::new();
    let mut all_skeletons: Vec<FmcSkeletonCandidate> = Vec::new();
''',
    "search profile locals",
)
fmc = replace_once(
    fmc,
    '''    let mut best_count = 40usize;
''',
    '''    let mut best_count = incumbent_move_count.clamp(1, 40);
''',
    "incumbent bound",
)

start = fmc.index("fn solve_fmc_with_eo_depth(")
end = fmc.index("\n/// Run the normal depth-5 human FMC profile first.", start)
body = fmc[start:end]
body = body.replace("FMC_EO_LIMIT,", "direct_eo_limit,")
body = body.replace("FMC_PM_EO_LIMIT,", "premove_eo_limit,")
body = body.replace("FMC_P2_NODE_LIMIT,", "p2_node_limit,")
body = body.replace("FMC_PM_P2_NODE_LIMIT,", "premove_p2_node_limit,")

needle = '''            &mut p2_cache,
            &mut best_count,
            force_rzp,
            enable_htr_skeletons,
'''
repls = [
    '''            &mut p2_cache,
            &mut best_count,
            search_variant.wrapping_add(axis as u32 * 17),
            force_rzp,
            enable_htr_skeletons,
''',
    '''            &mut p2_cache,
            &mut best_count,
            search_variant.wrapping_add(101 + axis as u32 * 17),
            force_rzp,
            enable_htr_skeletons,
''',
]
for i, replacement in enumerate(repls):
    if needle not in body:
        raise SystemExit(f"MISSING:top single axis {i}")
    body = body.replace(needle, replacement, 1)

needle_pm = '''                    &mut p2_cache,
                    &mut best_count,
                    force_rzp,
                    enable_htr_skeletons,
'''
pm_repls = [
    '''                    &mut p2_cache,
                    &mut best_count,
                    search_variant
                        .wrapping_add(1009)
                        .wrapping_add(pm_idx as u32 * 131)
                        .wrapping_add(axis as u32 * 17),
                    force_rzp,
                    enable_htr_skeletons,
''',
    '''                    &mut p2_cache,
                    &mut best_count,
                    search_variant
                        .wrapping_add(2003)
                        .wrapping_add(pm_idx as u32 * 131)
                        .wrapping_add(axis as u32 * 17),
                    force_rzp,
                    enable_htr_skeletons,
''',
]
for i, replacement in enumerate(pm_repls):
    if needle_pm not in body:
        raise SystemExit(f"MISSING:pm single axis {i}")
    body = body.replace(needle_pm, replacement, 1)

body = replace_once(
    body,
    '''    for pm_idx in 0..pm_limit {
        let premove = &premove_sets[pm_idx];
''',
    '''    for pm_idx in 0..pm_limit {
        let premove_index = if premove_sets.is_empty() {
            0
        } else {
            ((search_variant as usize * 37) + pm_idx * 53) % premove_sets.len()
        };
        let premove = &premove_sets[premove_index];
''',
    "premove variant order",
)

body = body.replace(
    "let skeletons = finalize_skeleton_beam(all_skeletons);",
    "let skeletons = finalize_skeleton_beam(all_skeletons, skeleton_beam_limit);",
)
fmc = fmc[:start] + body + fmc[end:]

fmc = replace_once(
    fmc,
    '''fn finalize_skeleton_beam(mut candidates: Vec<FmcSkeletonCandidate>) -> Vec<FmcSkeletonCandidate> {
''',
    '''fn finalize_skeleton_beam(
    mut candidates: Vec<FmcSkeletonCandidate>,
    beam_limit: usize,
) -> Vec<FmcSkeletonCandidate> {
''',
    "beam signature",
)
beam_start = fmc.index("fn finalize_skeleton_beam(")
beam_end = fmc.index("\n/// Create guaranteed insertion skeletons", beam_start)
beam_body = fmc[beam_start:beam_end].replace("FMC_SKELETON_BEAM_LIMIT", "beam_limit")
fmc = fmc[:beam_start] + beam_body + fmc[beam_end:]

fmc = replace_once(
    fmc,
    '''    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
) -> FmcResult {
    let primary = solve_fmc_with_eo_depth(
''',
    '''    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
) -> FmcResult {
    let requested_eo_depth = FMC_MAX_EO_DEPTH.saturating_add(search_level.min(3));
    let primary = solve_fmc_with_eo_depth(
''',
    "public solve signature",
)
fmc = replace_once(
    fmc,
    '''        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        FMC_MAX_EO_DEPTH,
    );
''',
    '''        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        search_level,
        search_variant,
        incumbent_move_count,
        requested_eo_depth,
    );
''',
    "primary args",
)
fmc = replace_once(
    fmc,
    '''        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        FMC_MAX_EO_DEPTH.saturating_add(1),
    );
''',
    '''        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        search_level,
        search_variant,
        incumbent_move_count,
        requested_eo_depth.saturating_add(1),
    );
''',
    "fallback args",
)
write(fmc_path, fmc)

# ---- JS human-anytime scheduler ----
solver_path = "solver/fmcSolver.js"
solver = read(solver_path)
solver = solver.replace("timeBudgetMs: 90000,", "timeBudgetMs: 300000,", 1)

extreme_pattern = re.compile(
    r'''  if \(qualityMode === "extreme"\) \{\n    return \[\n.*?\n    \];\n  \}\n''',
    re.S,
)
extreme_replacement = '''  if (qualityMode === "extreme") {
    const requestedVariants = Number.isFinite(options.extremeVariantCount)
      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))
      : 12;
    const stages = [];
    for (let variant = 0; variant < requestedVariants; variant += 1) {
      const searchLevel = variant === 0 ? 0 : variant < 3 ? 1 : variant < 7 ? 2 : 3;
      const premoveCap =
        searchLevel === 0 ? 40 : searchLevel === 1 ? 90 : searchLevel === 2 ? 140 : requestedPremoveSets;
      stages.push(
        stage(`human-L${searchLevel}-V${variant}`, {
          maxPremoveSets: capPremoves(premoveCap),
          searchLevel,
          searchVariant: variant,
          enableMultiSwitchNiss: searchLevel >= 1,
          enableDeepMultiSwitchNiss: searchLevel >= 2,
          enableHtrSkeletons: searchLevel >= 2,
          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
        }),
      );
    }
    return stages;
  }
'''
solver, count = extreme_pattern.subn(extreme_replacement, solver, count=1)
if count != 1:
    raise SystemExit("MISSING:extreme scheduler")

solver = replace_once(
    solver,
    '''  let wasmFmcDone = false;
  try {
''',
    '''  let wasmFmcDone = false;
  const continueBelowTarget = qualityMode === "extreme" && options.continueBelowTarget !== false;
  try {
''',
    "continue below target",
)
solver = replace_once(
    solver,
    '''        if (Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount) break;

        const qualityStage = wasmStages[stageIndex];
''',
    '''        if (
          Number.isFinite(bestMoveCount) &&
          bestMoveCount <= targetMoveCount &&
          !continueBelowTarget
        ) {
          break;
        }

        const qualityStage = wasmStages[stageIndex];
''',
    "scheduler early exit",
)
solver = replace_once(
    solver,
    '''        const solveStartedAt = Date.now();
        const wasmResult = await solveFmcWasm(scramble, qualityStage.options);
''',
    '''        const stageOptions = {
          ...qualityStage.options,
          incumbentMoveCount: Number.isFinite(bestMoveCount)
            ? Math.max(1, bestMoveCount - (bestMoveCount <= targetMoveCount ? 1 : 0))
            : 40,
        };
        const solveStartedAt = Date.now();
        const wasmResult = await solveFmcWasm(scramble, stageOptions);
''',
    "stage incumbent",
)
solver = solver.replace("qualityStage.options.maxPremoveSets", "stageOptions.maxPremoveSets")
solver = solver.replace("qualityStage.options.enableMultiSwitchNiss", "stageOptions.enableMultiSwitchNiss")
solver = solver.replace("qualityStage.options.enableDeepMultiSwitchNiss", "stageOptions.enableDeepMultiSwitchNiss")
solver = solver.replace("qualityStage.options.enableHtrSkeletons", "stageOptions.enableHtrSkeletons")
solver = solver.replace("qualityStage.options.enableSliceInsertion", "stageOptions.enableSliceInsertion")
solver = solver.replace("qualityStage.options.enableMultiInsertion", "stageOptions.enableMultiInsertion")

solver = replace_once(
    solver,
    '''  const best = rankedCandidates[0];
  diagnostics.selectedCandidate = {
''',
    '''  const best = rankedCandidates[0];
  if (qualityMode === "extreme" && best.moveCount > targetMoveCount) {
    return {
      ok: false,
      reason: "FMC_HUMAN_TARGET_NOT_REACHED",
      qualityMode,
      qualityTarget: targetMoveCount,
      qualityTargetReached: false,
      bestHumanSolution: best.solution,
      bestHumanMoveCount: best.moveCount,
      bestHumanSource: best.source,
      attempts,
      performanceDiagnostics: finalizeDiagnostics(),
    };
  }
  diagnostics.selectedCandidate = {
''',
    "human target gate",
)
solver = replace_once(
    solver,
    '''    qualityTargetReached: best.moveCount <= targetMoveCount,
''',
    '''    qualityTargetReached: best.moveCount <= targetMoveCount,
    humanStyle: true,
    continueBelowTarget,
''',
    "human result metadata",
)
write(solver_path, solver)

# ---- Worker defaults and option forwarding ----
worker_path = "solver/solverWorker.js"
worker = read(worker_path)
worker = worker.replace("const FMC_333_TIMEOUT_MS = 120000;", "const FMC_333_TIMEOUT_MS = 660000;", 1)
worker = replace_once(
    worker,
    '''    let fmcQualityMode = "sweetSpot";
    let fmcTargetMoveCount = null;
    let fmcTimeBudgetMs = null;
''',
    '''    let fmcQualityMode = "sweetSpot";
    let fmcTargetMoveCount = null;
    let fmcTimeBudgetMs = null;
    let fmcContinueBelowTarget = true;
''',
    "worker local option",
)
worker = replace_once(
    worker,
    '''      if (Number.isFinite(Number(arg1.fmcTimeBudgetMs))) {
        fmcTimeBudgetMs = Math.max(1000, Math.floor(Number(arg1.fmcTimeBudgetMs)));
      }
''',
    '''      if (Number.isFinite(Number(arg1.fmcTimeBudgetMs))) {
        fmcTimeBudgetMs = Math.max(1000, Math.floor(Number(arg1.fmcTimeBudgetMs)));
      }
      if (typeof arg1.fmcContinueBelowTarget === "boolean") {
        fmcContinueBelowTarget = arg1.fmcContinueBelowTarget;
      }
''',
    "worker parse option",
)
worker = worker.replace("? 90000\n              : 8000;", "? 300000\n              : 8000;", 1)
worker = replace_once(
    worker,
    '''              enableInsertions: true,
              crossColors: normalizeCrossColorList(crossColor),
''',
    '''              enableInsertions: true,
              continueBelowTarget: isExtremeFmc && fmcContinueBelowTarget,
              crossColors: normalizeCrossColorList(crossColor),
''',
    "worker forward option",
)
write(worker_path, worker)

print("Applied FMC Extreme human anytime search")
