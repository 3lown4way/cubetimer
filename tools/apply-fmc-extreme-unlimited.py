from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Extreme uses no in-process time ceiling. The benchmark worker remains the
# hard per-run timeout and may terminate the synchronous WASM worker externally.
fmc_path = Path("solver/fmcSolver.js")
fmc = fmc_path.read_text()
fmc = replace_once(
    fmc,
    'stage("extreme-target-deadline", {',
    'stage("extreme-target-unbounded", {',
    "Extreme stage name",
)
fmc = replace_once(
    fmc,
    '''        const stageBudgetMs = Math.max(50, remainingBeforeStage - 75);
        const stageOptions = {
          ...qualityStage.options,
          timeBudgetMs: stageBudgetMs,
          targetMoveCount,
        };
''',
    '''        const stageBudgetMs = Math.max(50, remainingBeforeStage - 75);
        const internalBudgetUnlimited = qualityMode === "extreme";
        const stageOptions = {
          ...qualityStage.options,
          // Extreme is intentionally unbounded inside WASM. The benchmark
          // worker's per-run timeout is the only wall-clock limit.
          timeBudgetMs: internalBudgetUnlimited ? 0 : stageBudgetMs,
          targetMoveCount,
        };
''',
    "Extreme stage budget propagation",
)
fmc = replace_once(
    fmc,
    '''          budgetMs: stageBudgetMs,
          wasmElapsedMs: Number.isFinite(wasmResult?.elapsedMs) ? wasmResult.elapsedMs : null,
''',
    '''          budgetMs: internalBudgetUnlimited ? null : stageBudgetMs,
          internalBudgetUnlimited,
          wasmElapsedMs: Number.isFinite(wasmResult?.elapsedMs) ? wasmResult.elapsedMs : null,
''',
    "Extreme diagnostics",
)
fmc_path.write_text(fmc)

wasm_path = Path("solver/wasmSolver.js")
wasm = wasm_path.read_text()
wasm = replace_once(
    wasm,
    'timeBudgetMs: Number.isFinite(options.timeBudgetMs) ? Math.max(50, Math.floor(options.timeBudgetMs)) : 8000,',
    'timeBudgetMs: Number.isFinite(options.timeBudgetMs) ? Math.max(0, Math.floor(options.timeBudgetMs)) : 8000,',
    "WASM zero-budget sentinel",
)
wasm_path.write_text(wasm)

rust_path = Path("solver-wasm/src/fmc_search.rs")
rust = rust_path.read_text()
rust = replace_once(
    rust,
    '''        let started_ms = fmc_now_ms();
        let duration_ms = time_budget_ms.max(50) as f64;
        Self {
            started_ms,
            deadline_ms: started_ms + duration_ms,
''',
    '''        let started_ms = fmc_now_ms();
        // A zero budget is the explicit Extreme sentinel: no internal wall-clock
        // deadline. The outer worker timeout remains able to terminate WASM.
        let deadline_ms = if time_budget_ms == 0 {
            f64::INFINITY
        } else {
            started_ms + time_budget_ms.max(50) as f64
        };
        Self {
            started_ms,
            deadline_ms,
''',
    "Rust unlimited deadline sentinel",
)
rust_path.write_text(rust)

contract = '''import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { solveWithFMCSearch } from "./solver/fmcSolver.js";
import { buildFmcTablesWasm } from "./solver/wasmSolver.js";

const scramble = "R2 U' F2 L2 D B2 R' D2 F U2 L' U B' R2 F2 D' L2 U' R F' U2";
assert.equal(await buildFmcTablesWasm(), true);

const startedAt = performance.now();
const result = await solveWithFMCSearch(scramble, null, {
  qualityMode: "extreme",
  // This remains the outer worker/run limit. It must not become a WASM budget.
  timeBudgetMs: 500,
  targetMoveCount: 1,
  maxPremoveSets: 12,
  enableCoverageFallback: false,
  requireTargetReached: true,
  verifyLimit: 32,
});
const elapsedMs = performance.now() - startedAt;

assert.equal(result?.qualityMode || result?.performanceDiagnostics?.qualityMode, "extreme");
assert.notEqual(result?.qualityDowngraded, true);
const stages = result?.performanceDiagnostics?.wasmStages || [];
assert.equal(stages.length, 1, `Extreme must use one unbounded pass: ${stages.map((stage) => stage.name)}`);
const stage = stages[0];
assert.equal(stage.name, "extreme-target-unbounded");
assert.equal(stage.internalBudgetUnlimited, true);
assert.equal(stage.budgetMs, null);
assert.equal(stage.timedOut, false);
assert.ok(stage.processedAxisCalls > 0);
assert.equal(stage.processedPremoveSets, 12, JSON.stringify(stage));
assert.equal(result?.ok, false);
assert.equal(result?.reason, "FMC_EXTREME_TARGET_NOT_REACHED");

console.log(JSON.stringify({
  elapsedMs,
  result: result?.reason || result?.moveCount,
  stage,
}));
'''
Path("benchmark-fmc-extreme-contract.mjs").write_text(contract)

verifier_path = Path("tools/verify-benchmark-no-fallback.mjs")
verifier = verifier_path.read_text()
start = verifier.index('for (const token of [\n  \'stage("extreme-target-deadline"\'')
end_marker = 'console.log("FMC Extreme real deadline contract verified");\n'
end = verifier.index(end_marker, start) + len(end_marker)
replacement = '''for (const token of [
  'stage("extreme-target-unbounded"',
  'const internalBudgetUnlimited = qualityMode === "extreme"',
  'timeBudgetMs: internalBudgetUnlimited ? 0 : stageBudgetMs',
  'internalBudgetUnlimited',
  'targetMoveCount',
  'processedAxisCalls',
  'processedPremoveSets',
  'FMC_EXTREME_TARGET_NOT_REACHED',
]) {
  if (!fmcSolver.includes(token)) throw new Error(`FMC unlimited-Extreme token missing: ${token}`);
}
if (!enhanced.includes('payload.fmcTimeBudgetMs = Math.max(100, config.timeoutMs - 150)')) {
  throw new Error("enhanced benchmark outer worker timeout is not propagated");
}
if (
  enhanced.includes('const budget = config.fmcQualityMode === "extreme" ? 90000 : 8000') ||
  enhanced.includes('Math.min(budget, Math.max(100, config.timeoutMs - 100))') ||
  enhanced.includes('if (Number(elements.timeout.value) < 105) elements.timeout.value = "120"')
) {
  throw new Error("Extreme still has an independent fixed timeout");
}
for (const token of ["timeBudgetMs", "targetMoveCount", "maxEoDepth"]) {
  if (!wasmSolver.includes(token) || !rustApi.includes(token)) {
    throw new Error(`WASM option propagation missing: ${token}`);
  }
}
for (const token of [
  "FmcSearchBudget",
  "time_budget_ms == 0",
  "f64::INFINITY",
  "budget.should_stop",
  "processed_premove_sets",
  "timed_out",
]) {
  if (!rustFmc.includes(token)) throw new Error(`Rust unlimited-budget token missing: ${token}`);
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
console.log("FMC Extreme unlimited internal budget contract verified");
'''
verifier_path.write_text(verifier[:start] + replacement + verifier[end:])
