from pathlib import Path
import re
import subprocess

ADVANCED_REF = "origin/agent/fmc-extreme-independent-frontier-v2"


def show(path: str) -> str:
    return subprocess.check_output(
        ["git", "show", f"{ADVANCED_REF}:{path}"],
        text=True,
    )


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# 1. Restore the exact independent-frontier-v2 FMC engine that was benchmarked.
# ---------------------------------------------------------------------------
fmc = show("solver/fmcSolver.js")
fmc = fmc.replace(
    '''  ensureTwophase333Ready,\n  prepareTwophase333,\n  searchTwophase333,\n  dropTwophase333Search,\n''',
    "",
    1,
)
fmc = replace_once(
    fmc,
    '} from "./wasmSolver.js";\n',
    '} from "./wasmSolver.js";\nimport { FMC_EXTREME_PROFILE } from "./fmcExtremeProfile.js";\n',
    "profile import",
)
fmc = replace_once(
    fmc,
    '    enableCoverageFallback: options.enableCoverageFallback !== false,',
    '    enableCoverageFallback: false,',
    "coverage fallback disable",
)
fmc = replace_once(
    fmc,
    '''  extreme: Object.freeze({\n    targetMoveCount: 20,\n    timeBudgetMs: 300000,\n    maxPremoveSets: 180,\n    insertionCandidateLimit: 6,\n    insertionMaxPasses: 5,\n    insertionTimeMs: 20000,\n    insertionThreshold: 30,\n  }),''',
    '''  extreme: Object.freeze({\n    targetMoveCount: FMC_EXTREME_PROFILE.targetMoveCount,\n    timeBudgetMs: FMC_EXTREME_PROFILE.defaultTimeBudgetMs,\n    maxPremoveSets: FMC_EXTREME_PROFILE.maxPremoveSets,\n    insertionCandidateLimit: FMC_EXTREME_PROFILE.insertionCandidateLimit,\n    insertionMaxPasses: FMC_EXTREME_PROFILE.insertionMaxPasses,\n    insertionTimeMs: FMC_EXTREME_PROFILE.insertionTimeMs,\n    insertionThreshold: FMC_EXTREME_PROFILE.insertionThreshold,\n  }),''',
    "extreme preset",
)
fmc = replace_once(
    fmc,
    '''    const requestedVariants = Number.isFinite(options.extremeVariantCount)\n      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))\n      : 12;''',
    '''    const requestedVariants = Number.isFinite(options.extremeVariantCount)\n      ? Math.max(4, Math.min(24, Math.floor(options.extremeVariantCount)))\n      : FMC_EXTREME_PROFILE.extremeVariantCount;''',
    "variant count",
)
fmc = replace_once(
    fmc,
    ''': Math.min(requestedPremoveSets, 48);''',
    ''': Math.min(requestedPremoveSets, FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves);''',
    "reserved compression premoves",
)
fmc = replace_once(
    fmc,
    '''  const continueBelowTarget = qualityMode === "extreme" && options.continueBelowTarget !== false;''',
    '''  const continueBelowTarget =\n    qualityMode === "extreme" &&\n    (options.continueBelowTarget !== undefined\n      ? options.continueBelowTarget !== false\n      : FMC_EXTREME_PROFILE.continueBelowTarget);''',
    "continue below target",
)
fmc = replace_once(
    fmc,
    '''    qualityMode,\n    targetMoveCount,\n    totalBudgetMs: timeBudgetMs,''',
    '''    qualityMode,\n    extremeProfileId: qualityMode === "extreme" ? FMC_EXTREME_PROFILE.id : null,\n    targetMoveCount,\n    totalBudgetMs: timeBudgetMs,''',
    "diagnostic profile identity",
)
fmc = fmc.replace('type: "fallback_start",\n          stageName: `FMC ${qualityStage.name}`', 'type: "quality_stage_start",\n          stageName: `FMC ${qualityStage.name}`')
fmc = fmc.replace('notify({ type: "fallback_done", stageName: `FMC ${qualityStage.name}` });', 'notify({ type: "quality_stage_done", stageName: `FMC ${qualityStage.name}` });')
fmc = fmc.replace('type: "fallback_start",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 'type: "insertion_start",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`')
fmc = fmc.replace('type: "fallback_done",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`', 'type: "insertion_done",\n              stageName: `FMC Insertion ${i + 1}/${insertionTargets.length}`')
fmc = fmc.replace('reason: "FMC_HUMAN_TARGET_NOT_REACHED",', 'reason: "FMC_EXTREME_TARGET_NOT_REACHED",', 1)
fmc = replace_once(
    fmc,
    '''      qualityMode,\n      qualityTarget: targetMoveCount,\n      qualityTargetReached: false,''',
    '''      qualityMode,\n      extremeProfileId: FMC_EXTREME_PROFILE.id,\n      qualityTarget: targetMoveCount,\n      qualityTargetReached: false,\n      qualityDowngraded: false,\n      moveCount: best.moveCount,\n      bestCandidate: { solution: best.solution, moveCount: best.moveCount, source: best.source },''',
    "target miss metadata",
)
fmc = replace_once(
    fmc,
    '''    qualityMode,\n    qualityTarget: targetMoveCount,\n    qualityTargetReached: best.moveCount <= targetMoveCount,''',
    '''    qualityMode,\n    extremeProfileId: qualityMode === "extreme" ? FMC_EXTREME_PROFILE.id : null,\n    qualityTarget: targetMoveCount,\n    qualityTargetReached: best.moveCount <= targetMoveCount,\n    qualityDowngraded: false,''',
    "success profile metadata",
)
Path("solver/fmcSolver.js").write_text(fmc)

# ---------------------------------------------------------------------------
# 2. Restore the exact advanced Rust frontier engine, but remove its EO-depth
#    fallback. Its L1/L2/L3 variants are the selected Extreme method itself.
# ---------------------------------------------------------------------------
rust = show("solver-wasm/src/fmc_search.rs")
rust = rust.replace("    pub eo_fallback_used: bool,\n", "")
rust = rust.replace("                eo_fallback_used: false,\n", "")
rust = rust.replace("        eo_fallback_used: false,\n", "")
solve_start = rust.index("/// Run the normal depth-5 human FMC profile first.")
solve_end = rust.index("/// Convert FmcCandidate to a JSON-friendly representation.", solve_start)
solve_function = r'''/// Run the selected human FMC frontier. L3 performs additional independent
/// variants inside the same method; no alternate solver or EO-depth fallback runs.
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
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
) -> FmcResult {
    let requested_eo_depth = FMC_MAX_EO_DEPTH.saturating_add(search_level.min(3));
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
        search_level,
        search_variant,
        incumbent_move_count,
        requested_eo_depth,
    );
    if !primary.ok {
        return primary;
    }

    let mut best_result = primary;
    let mut best_count = fmc_result_best_move_count(&best_result);

    if search_level >= 3 && best_count > FMC_EXTREME_RETRY_TARGET {
        let secondary_variant = solve_fmc_with_eo_depth(
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
            search_level,
            search_variant.wrapping_add(FMC_EXTREME_RETRY_VARIANT_OFFSET),
            incumbent_move_count,
            requested_eo_depth,
        );
        let secondary_count = fmc_result_best_move_count(&secondary_variant);
        if secondary_variant.ok && secondary_count < best_count {
            best_result = secondary_variant;
            best_count = secondary_count;
        }
    }

    if search_level >= 3 && best_count > FMC_EXTREME_SUB20_TARGET {
        let sub20_variant = solve_fmc_with_eo_depth(
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
            search_level,
            search_variant.wrapping_add(FMC_EXTREME_SUB20_VARIANT_OFFSET),
            incumbent_move_count,
            requested_eo_depth,
        );
        let sub20_count = fmc_result_best_move_count(&sub20_variant);
        if sub20_variant.ok && sub20_count < best_count {
            best_result = sub20_variant;
        }
    }

    best_result
}

'''
rust = rust[:solve_start] + solve_function + rust[solve_end:]
if "eo_fallback_used" in rust:
    raise SystemExit("EO fallback marker remains in advanced FMC Rust")
Path("solver-wasm/src/fmc_search.rs").write_text(rust)

# ---------------------------------------------------------------------------
# 3. Bind the current WASM API to searchLevel/searchVariant/incumbentMoveCount.
# ---------------------------------------------------------------------------
lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
options_start = lib.index("#[derive(Deserialize)]\nstruct FmcOptionsJson")
function_start = lib.index("#[wasm_bindgen]\npub fn solve_fmc_wasm", options_start)
opt_block = r'''#[derive(Deserialize)]
struct FmcOptionsJson {
    #[serde(rename = "maxPremoveSets", default = "default_max_premove_sets")]
    max_premove_sets: usize,
    #[serde(rename = "forceRzp", default)]
    force_rzp: bool,
    #[serde(rename = "enableMultiInsertion", default)]
    enable_multi_insertion: bool,
    #[serde(rename = "enableHtrSkeletons", default)]
    enable_htr_skeletons: bool,
    #[serde(rename = "enableSliceInsertion", default)]
    enable_slice_insertion: bool,
    #[serde(rename = "enableMultiSwitchNiss", default)]
    enable_multi_switch_niss: bool,
    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
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
    120
}

'''
lib = lib[:options_start] + opt_block + lib[function_start:]
function_start = lib.index("#[wasm_bindgen]\npub fn solve_fmc_wasm")
function_end = lib.index("#[wasm_bindgen]\npub fn optimize_insertion_wasm", function_start)
solve_api = r'''#[wasm_bindgen]
pub fn solve_fmc_wasm(scramble: &str, options_json: &str) -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    let fmc_guard = FMC_TABLES.lock().unwrap();
    let Some(fmc_tables) = fmc_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "FMC_TABLES_NOT_BUILT"}).to_string();
    };
    let options: FmcOptionsJson = match serde_json::from_str(options_json) {
        Ok(o) => o,
        Err(e) => {
            return serde_json::json!({"ok": false, "reason": format!("BAD_OPTIONS: {e}")})
                .to_string()
        }
    };

    let result = solve_fmc(
        scramble,
        tables,
        fmc_tables,
        options.max_premove_sets,
        options.force_rzp,
        options.enable_multi_insertion,
        options.enable_htr_skeletons,
        options.enable_slice_insertion,
        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.search_level,
        options.search_variant,
        options.incumbent_move_count,
    );

    if !result.ok {
        return serde_json::json!({"ok": false, "reason": "FMC_NO_SOLUTION"}).to_string();
    }

    let candidates_json: Vec<serde_json::Value> = result
        .candidates
        .iter()
        .map(|c| candidate_to_json(c, tables))
        .collect();
    let skeletons_json: Vec<serde_json::Value> = result
        .skeletons
        .iter()
        .map(|s| skeleton_to_json(s, tables))
        .collect();
    let best = &result.candidates[0];
    let best_solution = minmove_core::solution_string_from_path(&best.moves, &tables.move_data);

    serde_json::json!({
        "ok": true,
        "solution": best_solution,
        "moveCount": best.moves.len(),
        "candidates": candidates_json,
        "skeletonCount": skeletons_json.len(),
        "skeletons": skeletons_json,
        "insertionCandidateCount": result.insertion_candidate_count,
        "mixedInsertionCandidateCount": result.mixed_insertion_candidate_count,
        "multiInsertionCandidateCount": result.multi_insertion_candidate_count,
        "multiInsertionTransitionCount": result.multi_insertion_transition_count,
        "multiInsertionPairCount": result.multi_insertion_pair_count,
        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,
        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
        "htrSkeletonCount": result.skeletons.iter().filter(|skeleton| (4..=7).contains(&skeleton.source_tag)).count(),
    })
    .to_string()
}

'''
lib = lib[:function_start] + solve_api + lib[function_end:]
lib_path.write_text(lib)

wasm_path = Path("solver/wasmSolver.js")
wasm = wasm_path.read_text()
wasm = replace_once(
    wasm,
    '''      maxEoDepth: Number.isFinite(options.maxEoDepth) ? Math.max(5, Math.min(7, Math.floor(options.maxEoDepth))) : 5,\n      timeBudgetMs: Number.isFinite(options.timeBudgetMs) ? Math.max(0, Math.floor(options.timeBudgetMs)) : 8000,\n      targetMoveCount: Number.isFinite(options.targetMoveCount) ? Math.max(1, Math.floor(options.targetMoveCount)) : 24,''',
    '''      searchLevel: Number.isFinite(options.searchLevel) ? Math.max(0, Math.min(3, Math.floor(options.searchLevel))) : 0,\n      searchVariant: Number.isFinite(options.searchVariant) ? Math.max(0, Math.floor(options.searchVariant)) : 0,\n      incumbentMoveCount: Number.isFinite(options.incumbentMoveCount)\n        ? Math.max(1, Math.min(40, Math.floor(options.incumbentMoveCount)))\n        : 40,''',
    "WASM frontier options",
)
wasm_path.write_text(wasm)

# ---------------------------------------------------------------------------
# 4. Make the website worker use the same 24-variant shared profile.
# ---------------------------------------------------------------------------
worker_path = Path("benchmark/fmcBenchmarkWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { buildFmcTablesWasm } from "../solver/wasmSolver.js";\n',
    'import { buildFmcTablesWasm } from "../solver/wasmSolver.js";\nimport { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "../solver/fmcExtremeProfile.js";\n',
    "worker profile import",
)
old_call = '''    const result = await solveWithFMCSearch(scramble, onProgress, {\n      qualityMode,\n      timeBudgetMs,\n      targetMoveCount,\n      allowCfopFallback: false,\n      premoveAllowCfopFallback: false,\n      preferNonCfop: true,\n      verifyLimit: qualityMode === "extreme" ? 32 : 18,\n      enableInsertions: true,\n      enableCoverageFallback: false,\n      requireTargetReached: qualityMode === "extreme",\n      crossColors: normalizeCrossColorList(payload.crossColor),\n    });'''
new_call = '''    const solveOptions = qualityMode === "extreme"\n      ? buildFmcExtremeOptions({\n          timeBudgetMs,\n          targetMoveCount,\n          crossColors: normalizeCrossColorList(payload.crossColor),\n        })\n      : {\n          qualityMode,\n          timeBudgetMs,\n          targetMoveCount,\n          allowCfopFallback: false,\n          premoveAllowCfopFallback: false,\n          preferNonCfop: true,\n          verifyLimit: 18,\n          enableInsertions: true,\n          enableCoverageFallback: false,\n          requireTargetReached: false,\n          crossColors: normalizeCrossColorList(payload.crossColor),\n        };\n    const result = await solveWithFMCSearch(scramble, onProgress, solveOptions);'''
worker = replace_once(worker, old_call, new_call, "worker solve options")
worker = replace_once(
    worker,
    '''    if (result?.source === "FMC_TWOPHASE_FALLBACK") {''',
    '''    const actualExtremeProfile = result?.extremeProfileId || result?.performanceDiagnostics?.extremeProfileId || "";\n    if (qualityMode === "extreme" && actualExtremeProfile && actualExtremeProfile !== FMC_EXTREME_PROFILE.id) {\n      return {\n        ok: false,\n        reason: "FMC_EXTREME_PROFILE_MISMATCH",\n        expectedProfile: FMC_EXTREME_PROFILE.id,\n        actualProfile: actualExtremeProfile,\n        rejectedResult: result,\n      };\n    }\n    if (result?.source === "FMC_TWOPHASE_FALLBACK") {''',
    "worker profile guard",
)
worker_path.write_text(worker)

# ---------------------------------------------------------------------------
# 5. Independent policy and runtime parity tests.
# ---------------------------------------------------------------------------
policy_path = Path("benchmark/benchmark-no-fallback-policy.js")
policy = policy_path.read_text()
policy = 'import { FMC_EXTREME_PROFILE } from "../solver/fmcExtremeProfile.js";\n\n' + policy
policy = replace_once(
    policy,
    '''    if (requestedQuality === "extreme") {\n      const target = Number.isFinite(Number(config?.fmcTargetMoveCount))''',
    '''    if (requestedQuality === "extreme") {\n      if (String(result?.extremeProfileId || "") !== FMC_EXTREME_PROFILE.id) {\n        return reject("FMC_EXTREME_PROFILE_MISMATCH");\n      }\n      const target = Number.isFinite(Number(config?.fmcTargetMoveCount))''',
    "policy profile identity",
)
policy_path.write_text(policy)

test_path = Path("benchmark/benchmark-no-fallback-policy.test.mjs")
tests = test_path.read_text()
tests = tests.replace(
    'qualityMode: "extreme", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20',
    'qualityMode: "extreme", extremeProfileId: "independent-frontier-v2-24", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20',
)
marker = '\nconsole.log("benchmark no-fallback policy verified");\n'
extra = '''\nassert.equal(enforceBenchmarkNoFallback({\n  config: { mode: "fmc", fmcQualityMode: "extreme", fmcTargetMoveCount: 20 },\n  result: { ok: true, source: "FMC_WASM", qualityMode: "extreme", extremeProfileId: "wrong-profile", qualityTargetReached: true, qualityDowngraded: false, moveCount: 20 },\n}).reason, "FMC_EXTREME_PROFILE_MISMATCH");\n'''
if marker not in tests:
    raise SystemExit("policy test marker missing")
test_path.write_text(tests.replace(marker, extra + marker, 1))

Path("benchmark-fmc-extreme-contract.mjs").write_text(r'''import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";
import { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "./solver/fmcExtremeProfile.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
assert.equal(await buildFmcTablesWasm(), true);
const startedAt = performance.now();
const result = await solveWithFMCSearch(scramble, null, buildFmcExtremeOptions({
  timeBudgetMs: 60000,
  targetMoveCount: 20,
}));
const elapsedMs = performance.now() - startedAt;
const diagnostics = result?.performanceDiagnostics || {};
const stages = diagnostics.wasmStages || [];

assert.equal(FMC_EXTREME_PROFILE.extremeVariantCount, 24);
assert.equal(result?.extremeProfileId || diagnostics.extremeProfileId, FMC_EXTREME_PROFILE.id);
assert.equal(stages.length, 24, `site-parity Extreme executed ${stages.length} variants`);
assert.equal(stages[0]?.name, "human-L1-V0");
assert.equal(stages[1]?.name, "human-L3-V7-reserved");
assert.ok(stages.some((stage) => stage.name === "human-L3-V23"));
assert.equal(stages.some((stage) => /baseline|sweet/i.test(stage.name)), false);
assert.equal(result?.qualityDowngraded, false);
if (result?.ok) {
  assert.equal(result.qualityTargetReached, true);
  assert.ok(result.moveCount <= 20);
} else {
  assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");
  assert.ok(Number(result?.bestCandidate?.moveCount) > 20);
}

console.log(JSON.stringify({
  profile: FMC_EXTREME_PROFILE.id,
  elapsedMs,
  ok: result?.ok === true,
  reason: result?.reason || "",
  moveCount: result?.moveCount ?? result?.bestCandidate?.moveCount ?? null,
  variantCount: stages.length,
  variants: stages.map((stage) => stage.name),
}));
''')

Path("tools/verify-benchmark-no-fallback.mjs").write_text(r'''import fs from "node:fs";

const enhanced = fs.readFileSync(new URL("../benchmark/benchmark-enhanced.js", import.meta.url), "utf8");
const legacy = fs.readFileSync(new URL("../benchmark/benchmark.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../solver/solverWorker.js", import.meta.url), "utf8");
const roux = fs.readFileSync(new URL("../solver/roux3x3.js", import.meta.url), "utf8");
const fmcWorker = fs.readFileSync(new URL("../benchmark/fmcBenchmarkWorker.js", import.meta.url), "utf8");
const fmcSolver = fs.readFileSync(new URL("../solver/fmcSolver.js", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../solver/fmcExtremeProfile.js", import.meta.url), "utf8");
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

for (const token of [
  'id: "independent-frontier-v2-24"',
  "extremeVariantCount: 24",
  "maxPremoveSets: 180",
  "extremeReservedCompressionPremoves: 48",
]) {
  if (!profile.includes(token)) throw new Error(`shared Extreme profile token missing: ${token}`);
}
for (const token of [
  'stage(`human-L${searchLevel}-V${variant}',
  "FMC_EXTREME_PROFILE.extremeVariantCount",
  "FMC_EXTREME_PROFILE.extremeReservedCompressionPremoves",
  "FMC_EXTREME_TARGET_NOT_REACHED",
  'type: "quality_stage_start"',
  'type: "quality_stage_done"',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`independent-frontier-v2 token missing: ${token}`);
}
if (fmcSolver.includes('stage("extreme-target-unbounded"')) {
  throw new Error("site still uses the simplified one-pass Extreme implementation");
}
for (const token of ["searchLevel", "searchVariant", "incumbentMoveCount"]) {
  if (!wasmSolver.includes(token) || !rustApi.includes(token)) {
    throw new Error(`advanced WASM frontier option missing: ${token}`);
  }
}
for (const token of [
  "raw_exploration_limit",
  "search_variant",
  "multi_insertion_transition_count",
  "FMC_EXTREME_SUB20_TARGET",
]) {
  if (!rustFmc.includes(token)) throw new Error(`advanced Rust frontier token missing: ${token}`);
}
for (const source of [fmcSolver, wasmSolver, rustFmc, rustApi]) {
  if (source.includes("FMC_TWOPHASE_FALLBACK") || source.includes("eo_fallback_used")) {
    throw new Error("FMC fallback architecture remains");
  }
}
for (const token of [
  "buildFmcExtremeOptions",
  "FMC_EXTREME_PROFILE",
  "FMC_EXTREME_PROFILE_MISMATCH",
  "FMC_EXTREME_TARGET_NOT_REACHED",
]) {
  if (!fmcWorker.includes(token)) throw new Error(`site-parity worker token missing: ${token}`);
}
if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {
  throw new Error("site per-run timeout is not propagated");
}
console.log("benchmark no-fallback routing and FMC Extreme site parity verified");
''')

# Patcher is temporary and must not remain in the product branch.
Path("tools/apply-fmc-extreme-site-parity.py").unlink()
