from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing {label}: {old[:180]!r}")
    return text.replace(old, new, 1)


# ---------- Rust WASM clock dependency ----------
cargo = Path("solver-wasm/Cargo.toml")
cargo_text = cargo.read_text()
if "js-sys" not in cargo_text:
    cargo_text += "\n[target.'cfg(target_arch = \"wasm32\")'.dependencies]\njs-sys = \"0.3\"\n"
cargo.write_text(cargo_text)


# ---------- Rust FMC search: real deadline inside the search loops ----------
fmc_path = Path("solver-wasm/src/fmc_search.rs")
fmc = fmc_path.read_text()

clock_anchor = "const FMC_HTR_TAIL_SLACK: usize = 2;\n"
clock_block = r'''const FMC_HTR_TAIL_SLACK: usize = 2;

#[cfg(target_arch = "wasm32")]
fn fmc_now_ms() -> f64 {
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn fmc_now_ms() -> f64 {
    static START: Lazy<std::time::Instant> = Lazy::new(std::time::Instant::now);
    START.elapsed().as_secs_f64() * 1000.0
}

#[derive(Clone, Debug)]
struct FmcSearchBudget {
    started_ms: f64,
    deadline_ms: f64,
    target_move_count: usize,
    timed_out: bool,
    checkpoints: u64,
}

impl FmcSearchBudget {
    fn new(time_budget_ms: u32, target_move_count: usize) -> Self {
        let started_ms = fmc_now_ms();
        let duration_ms = time_budget_ms.max(50) as f64;
        Self {
            started_ms,
            deadline_ms: started_ms + duration_ms,
            target_move_count: target_move_count.max(1),
            timed_out: false,
            checkpoints: 0,
        }
    }

    fn remaining_ms(&self) -> f64 {
        (self.deadline_ms - fmc_now_ms()).max(0.0)
    }

    fn should_stop(&mut self, best_move_count: usize) -> bool {
        self.checkpoints = self.checkpoints.saturating_add(1);
        if best_move_count <= self.target_move_count {
            return true;
        }
        if self.remaining_ms() <= 0.0 {
            self.timed_out = true;
            return true;
        }
        false
    }

    fn mark_timeout_if_expired(&mut self) {
        if self.remaining_ms() <= 0.0 {
            self.timed_out = true;
        }
    }

    fn elapsed_ms(&self) -> u32 {
        (fmc_now_ms() - self.started_ms)
            .max(0.0)
            .min(u32::MAX as f64) as u32
    }
}
'''
fmc = replace_once(fmc, clock_anchor, clock_block, "FMC budget clock anchor")

old_result = r'''pub struct FmcResult {
    pub ok: bool,
    pub candidates: Vec<FmcCandidate>,
    pub skeletons: Vec<FmcSkeletonCandidate>,
    pub insertion_candidate_count: usize,
    pub mixed_insertion_candidate_count: usize,
    pub multi_insertion_candidate_count: usize,
    pub slice_insertion_candidate_count: usize,
    pub multi_switch_niss_candidate_count: usize,
    pub eo_fallback_used: bool,
}
'''
new_result = r'''pub struct FmcResult {
    pub ok: bool,
    pub candidates: Vec<FmcCandidate>,
    pub skeletons: Vec<FmcSkeletonCandidate>,
    pub insertion_candidate_count: usize,
    pub mixed_insertion_candidate_count: usize,
    pub multi_insertion_candidate_count: usize,
    pub slice_insertion_candidate_count: usize,
    pub multi_switch_niss_candidate_count: usize,
    pub timed_out: bool,
    pub elapsed_ms: u32,
    pub processed_axis_calls: usize,
    pub processed_premove_sets: usize,
    pub target_move_count: usize,
    pub target_reached: bool,
    pub budget_checkpoints: u64,
}
'''
fmc = replace_once(fmc, old_result, new_result, "FmcResult")

old_sig = r'''fn solve_fmc_with_eo_depth(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    max_eo_depth: u8,
) -> FmcResult {
    // Parse scramble
'''
new_sig = r'''fn solve_fmc_with_eo_depth(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    time_budget_ms: u32,
    target_move_count: usize,
    max_eo_depth: u8,
) -> FmcResult {
    let mut budget = FmcSearchBudget::new(time_budget_ms, target_move_count);
    let mut processed_axis_calls = 0usize;
    let mut processed_premove_sets = 0usize;

    // Parse scramble
'''
fmc = replace_once(fmc, old_sig, new_sig, "solve_fmc_with_eo_depth signature")

# Remove the old fallback marker from every constructor.
fmc = fmc.replace("                eo_fallback_used: false,\n", "")
fmc = fmc.replace("        eo_fallback_used: false,\n", "")

parse_tail = r'''                multi_insertion_candidate_count: 0,
                slice_insertion_candidate_count: 0,
                multi_switch_niss_candidate_count: 0,
            }
'''
parse_new = r'''                multi_insertion_candidate_count: 0,
                slice_insertion_candidate_count: 0,
                multi_switch_niss_candidate_count: 0,
                timed_out: false,
                elapsed_ms: budget.elapsed_ms(),
                processed_axis_calls,
                processed_premove_sets,
                target_move_count: target_move_count.max(1),
                target_reached: false,
                budget_checkpoints: budget.checkpoints,
            }
'''
fmc = replace_once(fmc, parse_tail, parse_new, "parse error stats")

fmc = replace_once(
    fmc,
    "    // --- Phase 1: Direct solve across 3 axes ---\n    for axis in 0..3u8 {\n        let state = direct_axis_states[axis as usize];\n",
    "    // --- Phase 1: Direct solve across 3 axes ---\n    'direct_axes: for axis in 0..3u8 {\n        if budget.should_stop(best_count) {\n            break 'direct_axes;\n        }\n        processed_axis_calls += 1;\n        let state = direct_axis_states[axis as usize];\n",
    "direct axis deadline",
)

fmc = replace_once(
    fmc,
    "    for axis in 0..3u8 {\n        let state = inverse_axis_states[axis as usize];\n",
    "    'inverse_axes: for axis in 0..3u8 {\n        if budget.should_stop(best_count) {\n            break 'inverse_axes;\n        }\n        processed_axis_calls += 1;\n        let state = inverse_axis_states[axis as usize];\n",
    "inverse axis deadline",
)

htr_call = "            force_rzp,\n            enable_htr_skeletons,\n        );"
htr_replacement = "            force_rzp,\n            enable_htr_skeletons && budget.remaining_ms() >= 1500.0,\n        );"
if fmc.count(htr_call) != 4:
    raise SystemExit(f"expected 4 single-axis HTR calls, found {fmc.count(htr_call)}")
fmc = fmc.replace(htr_call, htr_replacement)

fmc = replace_once(
    fmc,
    "    if enable_multi_switch_niss || enable_deep_multi_switch_niss {\n        for axis in 0..3u8 {\n",
    "    if enable_multi_switch_niss || enable_deep_multi_switch_niss {\n        'multi_switch_axes: for axis in 0..3u8 {\n            if budget.should_stop(best_count) {\n                break 'multi_switch_axes;\n            }\n            processed_axis_calls += 1;\n",
    "multi-switch outer deadline",
)

fmc = replace_once(
    fmc,
    "            let inverse_results = solve_multi_switch_niss_single_axis(\n",
    "            if budget.should_stop(best_count) {\n                break 'multi_switch_axes;\n            }\n            processed_axis_calls += 1;\n            let inverse_results = solve_multi_switch_niss_single_axis(\n",
    "multi-switch inverse deadline",
)

fmc = replace_once(
    fmc,
    "    for pm_idx in 0..pm_limit {\n        let premove = &premove_sets[pm_idx];\n",
    "    'premove_sets: for pm_idx in 0..pm_limit {\n        if budget.should_stop(best_count) {\n            break 'premove_sets;\n        }\n        processed_premove_sets = pm_idx + 1;\n        let premove = &premove_sets[pm_idx];\n",
    "premove outer deadline",
)

# Two premove axis loops, direct then inverse.
premove_axis = "            for axis in 0..3u8 {\n                let state = "
if fmc.count(premove_axis) != 2:
    raise SystemExit(f"expected 2 premove axis loops, found {fmc.count(premove_axis)}")
fmc = fmc.replace(
    premove_axis,
    "            for axis in 0..3u8 {\n                if budget.should_stop(best_count) {\n                    break 'premove_sets;\n                }\n                processed_axis_calls += 1;\n                let state = ",
)

# Do not launch insertion portfolios after the deadline or after the target is met.
fmc = replace_once(
    fmc,
    "    let relocation_skeletons = synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables);\n    all_skeletons.extend(relocation_skeletons);\n    if enable_slice_insertion {\n",
    "    let insertion_budget_available =\n        !budget.should_stop(best_count) && budget.remaining_ms() >= 250.0;\n    let relocation_skeletons = if insertion_budget_available {\n        synthesize_relocation_skeletons(&all_candidates, tables, fmc_tables)\n    } else {\n        Vec::new()\n    };\n    all_skeletons.extend(relocation_skeletons);\n    if enable_slice_insertion && insertion_budget_available {\n",
    "insertion deadline guard",
)
fmc = replace_once(
    fmc,
    "    if enable_multi_insertion {\n        let multi_relocation_skeletons =\n",
    "    if enable_multi_insertion && insertion_budget_available {\n        let multi_relocation_skeletons =\n",
    "multi relocation deadline",
)
fmc = replace_once(
    fmc,
    "    let inserted_candidates =\n        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables);\n",
    "    let inserted_candidates = if insertion_budget_available && budget.remaining_ms() >= 120.0 {\n        optimize_skeleton_insertions(&original_scramble_state, &skeletons, tables, fmc_tables)\n    } else {\n        Vec::new()\n    };\n",
    "single insertion deadline",
)
fmc = replace_once(
    fmc,
    "    let mut multi_inserted_candidates = if enable_multi_insertion {\n",
    "    let mut multi_inserted_candidates = if enable_multi_insertion\n        && insertion_budget_available\n        && budget.remaining_ms() >= 1200.0\n    {\n",
    "multi insertion deadline",
)

final_old = r'''    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
        insertion_candidate_count,
        mixed_insertion_candidate_count,
        multi_insertion_candidate_count,
        slice_insertion_candidate_count,
        multi_switch_niss_candidate_count,
    }
}

/// Run the normal depth-5 human FMC profile first. Only when it produces no
/// candidate at all, retry the same pipeline with depth-6 EO coverage.
pub fn solve_fmc(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
) -> FmcResult {
    let primary = solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        FMC_MAX_EO_DEPTH,
    );
    if primary.ok {
        return primary;
    }

    let mut fallback = solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        FMC_MAX_EO_DEPTH.saturating_add(1),
    );
    fallback.eo_fallback_used = fallback.ok;
    fallback
}
'''
final_new = r'''    let target_reached = all_candidates
        .first()
        .is_some_and(|candidate| candidate.moves.len() <= target_move_count.max(1));
    if !target_reached {
        budget.mark_timeout_if_expired();
    }

    FmcResult {
        ok: !all_candidates.is_empty(),
        candidates: all_candidates,
        skeletons,
        insertion_candidate_count,
        mixed_insertion_candidate_count,
        multi_insertion_candidate_count,
        slice_insertion_candidate_count,
        multi_switch_niss_candidate_count,
        timed_out: budget.timed_out,
        elapsed_ms: budget.elapsed_ms(),
        processed_axis_calls,
        processed_premove_sets,
        target_move_count: target_move_count.max(1),
        target_reached,
        budget_checkpoints: budget.checkpoints,
    }
}

/// Run one direct human-style FMC search profile. EO depth is selected up front;
/// there is no retry or alternate-method fallback after failure.
pub fn solve_fmc(
    scramble: &str,
    tables: &TwophaseTables,
    fmc_tables: &FmcTables,
    max_premove_sets: usize,
    force_rzp: bool,
    enable_multi_insertion: bool,
    enable_htr_skeletons: bool,
    enable_slice_insertion: bool,
    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    max_eo_depth: u8,
    time_budget_ms: u32,
    target_move_count: usize,
) -> FmcResult {
    solve_fmc_with_eo_depth(
        scramble,
        tables,
        fmc_tables,
        max_premove_sets,
        force_rzp,
        enable_multi_insertion,
        enable_htr_skeletons,
        enable_slice_insertion,
        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        time_budget_ms,
        target_move_count,
        max_eo_depth.max(FMC_MAX_EO_DEPTH).min(FMC_MAX_EO_DEPTH.saturating_add(2)),
    )
}
'''
fmc = replace_once(fmc, final_old, final_new, "final result and fallback removal")
fmc_path.write_text(fmc)


# ---------- Rust WASM API ----------
lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    '''    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
}
fn default_max_premove_sets() -> usize {
    120
}
''',
    '''    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
    #[serde(rename = "maxEoDepth", default = "default_fmc_max_eo_depth")]
    max_eo_depth: u8,
    #[serde(rename = "timeBudgetMs", default = "default_fmc_time_budget_ms")]
    time_budget_ms: u32,
    #[serde(rename = "targetMoveCount", default = "default_fmc_target_move_count")]
    target_move_count: usize,
}
fn default_max_premove_sets() -> usize {
    120
}
fn default_fmc_max_eo_depth() -> u8 {
    5
}
fn default_fmc_time_budget_ms() -> u32 {
    8_000
}
fn default_fmc_target_move_count() -> usize {
    24
}
''',
    "FMC API options",
)
lib = replace_once(
    lib,
    '''        options.enable_slice_insertion,
        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
    );

    if !result.ok {
        return serde_json::json!({"ok": false, "reason": "FMC_NO_SOLUTION"}).to_string();
    }
''',
    '''        options.enable_slice_insertion,
        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.max_eo_depth,
        options.time_budget_ms,
        options.target_move_count,
    );

    if !result.ok {
        return serde_json::json!({
            "ok": false,
            "reason": if result.timed_out { "FMC_TIME_BUDGET_EXHAUSTED" } else { "FMC_NO_SOLUTION" },
            "timedOut": result.timed_out,
            "elapsedMs": result.elapsed_ms,
            "processedAxisCalls": result.processed_axis_calls,
            "processedPremoveSets": result.processed_premove_sets,
            "targetMoveCount": result.target_move_count,
            "targetReached": result.target_reached,
            "budgetCheckpoints": result.budget_checkpoints,
        })
        .to_string();
    }
''',
    "FMC API solve call",
)
lib = lib.replace('        "eoFallbackUsed": result.eo_fallback_used,\n', '')
lib = replace_once(
    lib,
    '''        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
''',
    '''        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "timedOut": result.timed_out,
        "elapsedMs": result.elapsed_ms,
        "processedAxisCalls": result.processed_axis_calls,
        "processedPremoveSets": result.processed_premove_sets,
        "targetMoveCount": result.target_move_count,
        "targetReached": result.target_reached,
        "budgetCheckpoints": result.budget_checkpoints,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
''',
    "FMC API diagnostics",
)
lib_path.write_text(lib)


# ---------- JS WASM adapter: pass deadline and remove two-phase fallback ----------
wasm_path = Path("solver/wasmSolver.js")
wasm = wasm_path.read_text()
start = wasm.index("async function solveFmcTwophaseFallback(")
end = wasm.index("/**\n * Run the full FMC pipeline", start)
wasm = wasm[:start] + wasm[end:]
wasm = wasm.replace(
    " * A two-phase coverage fallback runs only when the human-style FMC pipeline returns no candidate.\n",
    " * No alternate solver or coverage fallback is permitted.\n",
)
wasm = replace_once(
    wasm,
    '''      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
    });
''',
    '''      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      maxEoDepth: Number.isFinite(options.maxEoDepth) ? Math.max(5, Math.min(7, Math.floor(options.maxEoDepth))) : 5,
      timeBudgetMs: Number.isFinite(options.timeBudgetMs) ? Math.max(50, Math.floor(options.timeBudgetMs)) : 8000,
      targetMoveCount: Number.isFinite(options.targetMoveCount) ? Math.max(1, Math.floor(options.targetMoveCount)) : 24,
    });
''',
    "WASM FMC deadline options",
)
wasm = replace_once(
    wasm,
    '''    if (!parsed || parsed.ok === undefined) return null;
    if (parsed.ok || options.enableCoverageFallback === false) return parsed;
    return await solveFmcTwophaseFallback(api, scramble, parsed);
''',
    '''    if (!parsed || parsed.ok === undefined) return null;
    return parsed;
''',
    "WASM fallback removal",
)
wasm_path.write_text(wasm)


# ---------- JS FMC scheduler: one target-driven Extreme pass with the real remaining deadline ----------
solver_path = Path("solver/fmcSolver.js")
solver = solver_path.read_text()
solver = solver.replace(
    "    enableCoverageFallback: options.enableCoverageFallback !== false,\n",
    "    enableCoverageFallback: false,\n",
    1,
)
extreme_start = solver.index('  if (qualityMode === "extreme") {')
extreme_end = solver.index('\n\n  return [\n    stage("baseline"', extreme_start)
solver = solver[:extreme_start] + r'''  if (qualityMode === "extreme") {
    return [
      stage("extreme-target-deadline", {
        maxPremoveSets: requestedPremoveSets,
        maxEoDepth: 6,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableMultiSwitchNiss: true,
        enableDeepMultiSwitchNiss: true,
      }, 100),
    ];
  }''' + solver[extreme_end:]

solver = replace_once(
    solver,
    '''        const solveStartedAt = Date.now();
        const wasmResult = await solveFmcWasm(scramble, qualityStage.options);
        const stageElapsedMs = Date.now() - solveStartedAt;
''',
    '''        const stageBudgetMs = Math.max(50, remainingBeforeStage - 75);
        const stageOptions = {
          ...qualityStage.options,
          timeBudgetMs: stageBudgetMs,
          targetMoveCount,
        };
        const solveStartedAt = Date.now();
        const wasmResult = await solveFmcWasm(scramble, stageOptions);
        const stageElapsedMs = Date.now() - solveStartedAt;
''',
    "stage deadline propagation",
)
solver = solver.replace("          maxPremoveSets: qualityStage.options.maxPremoveSets,\n", "          maxPremoveSets: stageOptions.maxPremoveSets,\n          budgetMs: stageBudgetMs,\n          wasmElapsedMs: Number.isFinite(wasmResult?.elapsedMs) ? wasmResult.elapsedMs : null,\n          timedOut: wasmResult?.timedOut === true,\n          processedAxisCalls: Number.isFinite(wasmResult?.processedAxisCalls) ? wasmResult.processedAxisCalls : 0,\n          processedPremoveSets: Number.isFinite(wasmResult?.processedPremoveSets) ? wasmResult.processedPremoveSets : 0,\n          budgetCheckpoints: Number.isFinite(wasmResult?.budgetCheckpoints) ? wasmResult.budgetCheckpoints : 0,\n          targetReached: wasmResult?.targetReached === true,\n", 1)
solver = solver.replace("qualityStage.options.enableMultiSwitchNiss", "stageOptions.enableMultiSwitchNiss")
solver = solver.replace("qualityStage.options.enableDeepMultiSwitchNiss", "stageOptions.enableDeepMultiSwitchNiss")
solver = solver.replace("qualityStage.options.enableHtrSkeletons", "stageOptions.enableHtrSkeletons")
solver = solver.replace("qualityStage.options.enableSliceInsertion", "stageOptions.enableSliceInsertion")
solver = solver.replace("qualityStage.options.enableMultiInsertion", "stageOptions.enableMultiInsertion")
solver_path.write_text(solver)


# ---------- Benchmark UI: the user's per-run timeout is the FMC budget ----------
enhanced_path = Path("benchmark/benchmark-enhanced.js")
enhanced = enhanced_path.read_text()
enhanced = enhanced.replace('  if (Number(elements.timeout.value) < 105) elements.timeout.value = "120";\n', '')
enhanced = replace_once(
    enhanced,
    '''  if (config.mode === "fmc") {
    const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000;
    payload.fmcQualityMode = config.fmcQualityMode;
    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;
    payload.fmcTimeBudgetMs = Math.max(100, Math.min(budget, Math.max(100, config.timeoutMs - 100)));
  }
''',
    '''  if (config.mode === "fmc") {
    payload.fmcQualityMode = config.fmcQualityMode;
    payload.fmcTargetMoveCount = config.fmcTargetMoveCount;
    payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150);
  }
''',
    "enhanced benchmark FMC budget",
)
enhanced_path.write_text(enhanced)

legacy_path = Path("benchmark/benchmark.js")
legacy = legacy_path.read_text()
legacy = legacy.replace('  if (Number(elements.timeout.value) < 105) elements.timeout.value = "120";\n', '')
legacy = legacy.replace(
    'payload.fmcTimeBudgetMs = Math.max(100, Math.min(budget, Math.max(100, config.timeoutMs - 100)));',
    'payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150);',
)
legacy = legacy.replace('    const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000;\n', '')
legacy_path.write_text(legacy)


# ---------- Runtime regression: different per-run budgets must produce different work ----------
contract = Path("benchmark-fmc-extreme-contract.mjs")
contract.write_text(r'''import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
assert.equal(await buildFmcTablesWasm(), true);

async function run(timeBudgetMs) {
  const startedAt = performance.now();
  const result = await solveWithFMCSearch(scramble, null, {
    qualityMode: "extreme",
    timeBudgetMs,
    targetMoveCount: 20,
    maxPremoveSets: 180,
    enableCoverageFallback: false,
    requireTargetReached: true,
    verifyLimit: 32,
  });
  return { result, elapsedMs: performance.now() - startedAt };
}

const shortRun = await run(500);
const longRun = await run(2200);

for (const run of [shortRun, longRun]) {
  const { result, elapsedMs } = run;
  assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
  assert.notEqual(result?.qualityDowngraded, true);
  const stages = result?.performanceDiagnostics?.wasmStages || [];
  assert.equal(stages.length, 1, `Extreme must use one deadline-driven pass: ${stages.map((stage) => stage.name)}`);
  assert.equal(stages[0].name, "extreme-target-deadline");
  assert.ok(stages[0].budgetMs > 0);
  assert.ok(stages[0].processedAxisCalls > 0);
  assert.ok(elapsedMs < stages[0].budgetMs + 1200, `deadline overrun: elapsed=${elapsedMs} budget=${stages[0].budgetMs}`);
  if (result?.ok) {
    assert.equal(result.qualityTargetReached, true);
    assert.ok(result.moveCount <= 20);
  } else {
    assert.ok(["FMC_EXTREME_TARGET_NOT_REACHED", "FMC_NO_VALID_SOLUTION", "FMC_WASM_NOT_READY"].includes(result?.reason));
  }
}

const shortStage = shortRun.result.performanceDiagnostics.wasmStages[0];
const longStage = longRun.result.performanceDiagnostics.wasmStages[0];
assert.ok(longStage.budgetMs > shortStage.budgetMs);
const moreWork =
  longStage.processedAxisCalls > shortStage.processedAxisCalls ||
  longStage.processedPremoveSets > shortStage.processedPremoveSets ||
  longRun.result?.qualityTargetReached === true;
assert.ok(moreWork, JSON.stringify({ shortStage, longStage }));

console.log(JSON.stringify({
  short: {
    elapsedMs: shortRun.elapsedMs,
    result: shortRun.result?.reason || shortRun.result?.moveCount,
    stage: shortStage,
  },
  long: {
    elapsedMs: longRun.elapsedMs,
    result: longRun.result?.reason || longRun.result?.moveCount,
    stage: longStage,
  },
}));
''')


# ---------- Static contract ----------
verify = Path("tools/verify-benchmark-no-fallback.mjs")
verify.write_text(r'''import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
const wasmSolver = fs.readFileSync(new URL("../solver/wasmSolver.js", import.meta.url), "utf8");
const rustFmc = fs.readFileSync(new URL("../solver-wasm/src/fmc_search.rs", import.meta.url), "utf8");
const rustApi = fs.readFileSync(new URL("../solver-wasm/src/lib.rs", import.meta.url), "utf8");

for (const source of [enhanced, legacy]) {
  if (!source.includes("benchmarkNoFallback: true")) throw new Error("benchmark no-fallback payload missing");
  if (!source.includes("enableStyleFallback: false")) throw new Error("benchmark style fallback still enabled");
  if (!source.includes("enforceBenchmarkNoFallback")) throw new Error("benchmark result policy missing");
}
for (const token of [
  "TWOPHASE_WASM_FAILED_NO_FALLBACK",
  "TWOPHASE_TRIVIAL_INVERSE_REJECTED",
  "MINMOVE_FALLBACK_RESULT_REJECTED",
  "!benchmarkNoFallback && mode === \"strict\"",
  "benchmarkNoFallback || mode === \"zb\"",
]) {
  if (!worker.includes(token)) throw new Error(`worker no-fallback token missing: ${token}`);
}
if ((worker.match(/enableRecovery: !benchmarkNoFallback,/g) || []).length !== 2) {
  throw new Error("Roux benchmark recovery is not disabled on both attempts");
}
if (!roux.includes("const allowCrossMethodRecovery = options.enableRecovery !== false")) {
  throw new Error("Roux v1 does not honor recovery disable flag");
}
console.log("benchmark no-fallback routing verified");

for (const token of [
  'stage("extreme-target-deadline"',
  'timeBudgetMs: stageBudgetMs',
  'targetMoveCount',
  'processedAxisCalls',
  'processedPremoveSets',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC real-deadline token missing: ${token}`);
}
if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {
  throw new Error("enhanced benchmark timeout is not the FMC budget");
}
if (enhanced.includes("90000") || enhanced.includes('elements.timeout.value = "120"')) {
  throw new Error("Extreme still has an independent fixed timeout");
}
for (const token of ["timeBudgetMs", "targetMoveCount", "maxEoDepth"]) {
  if (!wasmSolver.includes(token) || !rustApi.includes(token)) {
    throw new Error(`WASM deadline propagation missing: ${token}`);
  }
}
for (const token of ["FmcSearchBudget", "budget.should_stop", "processed_premove_sets", "timed_out"]) {
  if (!rustFmc.includes(token)) throw new Error(`Rust deadline checkpoint missing: ${token}`);
}
for (const source of [wasmSolver, rustFmc]) {
  if (source.includes("FMC_TWOPHASE_FALLBACK") || source.includes("eo_fallback_used")) {
    throw new Error("FMC fallback architecture remains");
  }
}
for (const token of [
  'requireTargetReached: qualityMode === "extreme"',
  'FMC_QUALITY_MODE_DOWNGRADE_REJECTED',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcWorker.includes(token)) throw new Error(`FMC benchmark worker guard missing: ${token}`);
}
console.log("FMC Extreme real deadline contract verified");
''')

# The patcher is temporary and must not remain in the merged tree.
Path("tools/apply-fmc-real-deadline.py").unlink()
