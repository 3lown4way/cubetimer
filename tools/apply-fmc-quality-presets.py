from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FMC = ROOT / "solver" / "fmcSolver.js"
WORKER = ROOT / "solver" / "solverWorker.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


fmc = FMC.read_text()

preset_code = r'''
const FMC_QUALITY_PRESETS = Object.freeze({
  sweetSpot: Object.freeze({
    targetMoveCount: 24,
    timeBudgetMs: 8000,
    maxPremoveSets: 40,
    insertionCandidateLimit: 2,
    insertionMaxPasses: 2,
    insertionTimeMs: 1800,
    insertionThreshold: 26,
  }),
  extreme: Object.freeze({
    targetMoveCount: 20,
    timeBudgetMs: 90000,
    maxPremoveSets: 180,
    insertionCandidateLimit: 6,
    insertionMaxPasses: 5,
    insertionTimeMs: 20000,
    insertionThreshold: 30,
  }),
  custom: Object.freeze({
    targetMoveCount: 20,
    timeBudgetMs: 30000,
    maxPremoveSets: 120,
    insertionCandidateLimit: 3,
    insertionMaxPasses: 3,
    insertionTimeMs: 5000,
    insertionThreshold: 24,
  }),
});

function normalizeFmcQualityMode(value) {
  const normalized = String(value || "sweetSpot")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (normalized === "extreme" || normalized === "max" || normalized === "maximum") {
    return "extreme";
  }
  if (normalized === "custom" || normalized === "legacy" || normalized === "manual") {
    return "custom";
  }
  return "sweetSpot";
}

function buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp) {
  const requestedPremoveSets = Math.max(0, Math.floor(maxPremoveSets));
  const capPremoves = (limit) => Math.min(requestedPremoveSets, limit);
  const common = {
    forceRzp,
    enableCoverageFallback: options.enableCoverageFallback !== false,
  };
  const stage = (name, stageOptions) => ({
    name,
    options: { ...common, ...stageOptions },
  });

  if (qualityMode === "custom") {
    return [
      stage("custom", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: options.enableMultiInsertion === true,
        enableHtrSkeletons: options.enableHtrSkeletons === true,
        enableSliceInsertion: options.enableSliceInsertion === true,
        enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
        enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      }),
    ];
  }

  if (qualityMode === "extreme") {
    return [
      stage("baseline", { maxPremoveSets: capPremoves(40) }),
      stage("eo-multi-switch", {
        maxPremoveSets: capPremoves(80),
        enableMultiSwitchNiss: true,
      }),
      stage("deep-eo-dr", {
        maxPremoveSets: capPremoves(120),
        enableDeepMultiSwitchNiss: true,
      }),
      stage("full-human-portfolio", {
        maxPremoveSets: requestedPremoveSets,
        enableMultiInsertion: true,
        enableHtrSkeletons: true,
        enableSliceInsertion: true,
        enableDeepMultiSwitchNiss: true,
      }),
    ];
  }

  return [
    stage("baseline", { maxPremoveSets: capPremoves(40) }),
    stage("eo-multi-switch", {
      maxPremoveSets: capPremoves(40),
      enableMultiSwitchNiss: true,
    }),
  ];
}

'''

export_anchor = "export async function solveWithFMCSearch(scramble, onProgress, options = {}) {"
if "const FMC_QUALITY_PRESETS" not in fmc:
    fmc = replace_once(fmc, export_anchor, preset_code + export_anchor, "quality preset insertion")

old_start = '''export async function solveWithFMCSearch(scramble, onProgress, options = {}) {
  const maxPremoveSets = Number.isFinite(options.maxPremoveSets)
    ? Math.max(0, Math.floor(options.maxPremoveSets))
    : 4;
  const forceRzp = options.forceRzp === true;
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(1000, Math.floor(options.timeBudgetMs))
    : 30000;
  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : 20;'''
new_start = '''export async function solveWithFMCSearch(scramble, onProgress, options = {}) {
  const qualityMode = normalizeFmcQualityMode(options.qualityMode);
  const qualityPreset = FMC_QUALITY_PRESETS[qualityMode] || FMC_QUALITY_PRESETS.sweetSpot;
  const maxPremoveSets = Number.isFinite(options.maxPremoveSets)
    ? Math.max(0, Math.floor(options.maxPremoveSets))
    : qualityPreset.maxPremoveSets;
  const forceRzp = options.forceRzp === true;
  const timeBudgetMs = Number.isFinite(options.timeBudgetMs)
    ? Math.max(1000, Math.floor(options.timeBudgetMs))
    : qualityPreset.timeBudgetMs;
  const targetMoveCount = Number.isFinite(options.targetMoveCount)
    ? Math.max(1, Math.floor(options.targetMoveCount))
    : qualityPreset.targetMoveCount;'''
fmc = replace_once(fmc, old_start, new_start, "quality defaults")

replacements = [
    (
        '''  const insertionCandidateLimit = Number.isFinite(options.insertionCandidateLimit)
    ? Math.max(1, Math.floor(options.insertionCandidateLimit))
    : 3;''',
        '''  const insertionCandidateLimit = Number.isFinite(options.insertionCandidateLimit)
    ? Math.max(1, Math.floor(options.insertionCandidateLimit))
    : qualityPreset.insertionCandidateLimit;''',
        "insertion candidate preset",
    ),
    (
        '''  const insertionMaxPasses = Number.isFinite(options.insertionMaxPasses)
    ? Math.max(1, Math.floor(options.insertionMaxPasses))
    : 3;''',
        '''  const insertionMaxPasses = Number.isFinite(options.insertionMaxPasses)
    ? Math.max(1, Math.floor(options.insertionMaxPasses))
    : qualityPreset.insertionMaxPasses;''',
        "insertion passes preset",
    ),
    (
        '''  const insertionTimeMs = Number.isFinite(options.insertionTimeMs)
    ? Math.max(600, Math.floor(options.insertionTimeMs))
    : Math.max(1200, Math.min(16000, Math.floor(timeBudgetMs * 0.22)));''',
        '''  const insertionTimeMs = Number.isFinite(options.insertionTimeMs)
    ? Math.max(600, Math.floor(options.insertionTimeMs))
    : Math.min(qualityPreset.insertionTimeMs, Math.max(1200, Math.floor(timeBudgetMs * 0.35)));''',
        "insertion time preset",
    ),
    (
        '''  const insertionThreshold = Number.isFinite(options.insertionThreshold)
    ? Math.max(1, Math.floor(options.insertionThreshold))
    : Math.max(targetMoveCount + 2, 22);''',
        '''  const insertionThreshold = Number.isFinite(options.insertionThreshold)
    ? Math.max(1, Math.floor(options.insertionThreshold))
    : qualityPreset.insertionThreshold;''',
        "insertion threshold preset",
    ),
]
for old, new, label in replacements:
    fmc = replace_once(fmc, old, new, label)

fmc = replace_once(
    fmc,
    '''  const diagnostics = {
    solver: "fmc",
    totalBudgetMs: timeBudgetMs,''',
    '''  const diagnostics = {
    solver: "fmc",
    qualityMode,
    targetMoveCount,
    totalBudgetMs: timeBudgetMs,
    wasmStages: [],''',
    "quality diagnostics",
)

fmc = replace_once(
    fmc,
    '''  const finalizeDiagnostics = () => ({
    ...diagnostics,
    sessionCacheStats: fmcSessionCache.summarize(),''',
    '''  const finalizeDiagnostics = () => ({
    ...diagnostics,
    qualityTargetReached: Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount,
    sessionCacheStats: fmcSessionCache.summarize(),''',
    "quality final diagnostics",
)

start_marker = "  // === WASM FMC fast path: run entire EO→DR→P2 pipeline (3 axes, NISS, premove sweep) in WASM ==="
end_marker = "\n  if (!wasmFmcDone) {"
start_index = fmc.find(start_marker)
end_index = fmc.find(end_marker, start_index)
if start_index < 0 or end_index < 0:
    raise SystemExit("WASM scheduler block anchors not found")

new_wasm_block = r'''  // === WASM FMC quality scheduler ===
  // Start with the cheapest human pipeline. More expensive stages run only while
  // the current incumbent is above the selected quality target.
  let wasmFmcDone = false;
  try {
    const wasmFmcStartedAt = Date.now();
    const fmcTablesOk = await buildFmcTablesWasm();
    console.warn(`[FMC WASM] buildFmcTablesWasm: ok=${fmcTablesOk}, elapsed=${Date.now() - wasmFmcStartedAt}ms`);
    if (fmcTablesOk) {
      const wasmStages = buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp);
      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {
        if (remainingMs(deadlineTs) <= 250) break;
        if (Number.isFinite(bestMoveCount) && bestMoveCount <= targetMoveCount) break;

        const qualityStage = wasmStages[stageIndex];
        notify({
          type: "fallback_start",
          stageName: `FMC ${qualityStage.name}`,
          reason: Number.isFinite(bestMoveCount) ? `${bestMoveCount}T > ${targetMoveCount}T` : qualityMode,
        });

        const solveStartedAt = Date.now();
        const wasmResult = await solveFmcWasm(scramble, qualityStage.options);
        const stageElapsedMs = Date.now() - solveStartedAt;
        diagnostics.wasmStages.push({
          name: qualityStage.name,
          elapsedMs: stageElapsedMs,
          ok: wasmResult?.ok === true,
          moveCount: Number.isFinite(wasmResult?.moveCount) ? wasmResult.moveCount : null,
          candidateCount: Array.isArray(wasmResult?.candidates) ? wasmResult.candidates.length : 0,
          maxPremoveSets: qualityStage.options.maxPremoveSets,
          multiSwitch: qualityStage.options.enableMultiSwitchNiss === true,
          deepMultiSwitch: qualityStage.options.enableDeepMultiSwitchNiss === true,
          htr: qualityStage.options.enableHtrSkeletons === true,
          sliceInsertion: qualityStage.options.enableSliceInsertion === true,
          multiInsertion: qualityStage.options.enableMultiInsertion === true,
        });
        diagnostics.phaseTimingsMs.direct += stageElapsedMs;
        diagnostics.phaseRuns.direct.calls += 1;

        console.warn(
          `[FMC WASM] stage=${qualityStage.name}, ok=${wasmResult?.ok}, moveCount=${wasmResult?.moveCount}, elapsed=${stageElapsedMs}ms`,
        );

        if (wasmResult?.ok && Array.isArray(wasmResult.candidates)) {
          for (const wc of wasmResult.candidates) {
            if (!wc.ok || !wc.solution) continue;
            const wcMoves = typeof wc.solution === "string" ? wc.solution.split(/\s+/).filter(Boolean) : wc.moves;
            const wcIsNiss =
              /^FMC_(PREMOVE_)?NISS(_|$)/.test(wc.source || "") ||
              /FMC_MULTI_NISS_INVERSE/.test(wc.source || "");
            const maybeInvert = (arr) =>
              wcIsNiss && Array.isArray(arr) && arr.length
                ? invertMoves(arr)
                : Array.isArray(arr) && arr.length
                  ? arr
                  : null;
            const candidate = createCandidate(
              wc.source || "FMC_WASM",
              {
                tag: wc.source || "wasm",
                qualityStage: qualityStage.name,
                axisName: wc.axisName || "",
                eoLength: wc.eoLength,
                drLength: wc.drLength,
                p2Length: wc.p2Length,
                eoMoves: maybeInvert(wc.eoMoves),
                drMoves: maybeInvert(wc.drMoves),
                finishMoves: maybeInvert(wc.finishMoves),
                premoveMoves: wc.premoves ? wc.premoves.split(/\s+/).filter(Boolean) : null,
              },
              wcMoves,
            );
            if (candidate) trackCandidate(candidate);
          }
          wasmFmcDone = true;
          diagnostics.phaseRuns.direct.successes += 1;
          if (
            Number.isFinite(wasmResult.moveCount) &&
            (!Number.isFinite(diagnostics.phaseRuns.direct.bestMoveCount) ||
              wasmResult.moveCount < diagnostics.phaseRuns.direct.bestMoveCount)
          ) {
            diagnostics.phaseRuns.direct.bestMoveCount = wasmResult.moveCount;
            diagnostics.phaseRuns.direct.bestSource = qualityStage.name;
          }
        }

        notify({ type: "fallback_done", stageName: `FMC ${qualityStage.name}` });
      }
    }
  } catch (err) {
    console.warn("[FMC WASM] quality scheduler exception:", err);
  }
'''
fmc = fmc[:start_index] + new_wasm_block + fmc[end_index:]

fmc = replace_once(
    fmc,
    '''    source: best.source,
    attempts,
    stages: fmcStages,''',
    '''    source: best.source,
    qualityMode,
    qualityTarget: targetMoveCount,
    qualityTargetReached: best.moveCount <= targetMoveCount,
    attempts,
    stages: fmcStages,''',
    "successful quality metadata",
)

FMC.write_text(fmc)

worker = WORKER.read_text()
worker = replace_once(
    worker,
    '''    let enableOllPllPrediction = true;
    let ollPllPredictionWeight = 0.35;''',
    '''    let enableOllPllPrediction = true;
    let ollPllPredictionWeight = 0.35;
    let fmcQualityMode = "sweetSpot";
    let fmcTargetMoveCount = null;
    let fmcTimeBudgetMs = null;''',
    "worker FMC variables",
)
worker = replace_once(
    worker,
    '''      if (Number.isFinite(Number(arg1.ollPllPredictionWeight))) {
        ollPllPredictionWeight = Math.max(0, Number(arg1.ollPllPredictionWeight));
      }
    } else {''',
    '''      if (Number.isFinite(Number(arg1.ollPllPredictionWeight))) {
        ollPllPredictionWeight = Math.max(0, Number(arg1.ollPllPredictionWeight));
      }
      if (typeof arg1.fmcQualityMode === "string" && arg1.fmcQualityMode) {
        fmcQualityMode = arg1.fmcQualityMode;
      }
      if (Number.isFinite(Number(arg1.fmcTargetMoveCount))) {
        fmcTargetMoveCount = Math.max(1, Math.floor(Number(arg1.fmcTargetMoveCount)));
      }
      if (Number.isFinite(Number(arg1.fmcTimeBudgetMs))) {
        fmcTimeBudgetMs = Math.max(1000, Math.floor(Number(arg1.fmcTimeBudgetMs)));
      }
    } else {''',
    "worker FMC request options",
)
worker = replace_once(
    worker,
    '''    mode = normalizeMode(mode);
    solverVersion = normalizeSolverVersion(solverVersion);''',
    '''    const requestedMode = String(mode || "").trim().toLowerCase();
    if (requestedMode === "fmc-extreme" || requestedMode === "extreme-fmc") {
      mode = "fmc";
      fmcQualityMode = "extreme";
    } else if (
      requestedMode === "fmc-sweet" ||
      requestedMode === "fmc-sweetspot" ||
      requestedMode === "sweetspot-fmc"
    ) {
      mode = "fmc";
      fmcQualityMode = "sweetSpot";
    }
    mode = normalizeMode(mode);
    solverVersion = normalizeSolverVersion(solverVersion);''',
    "worker FMC mode aliases",
)

old_fmc_block = '''        if (mode === "fmc") {
          const fmcResult = await withTimeout(
            solveWithFMCSearchLazy(scramble, onProgress, {
              maxPremoveSets: 12,
              timeBudgetMs: 30000,
              sweepBudgetMs: 10000,
              sweepIncludeInverse: true,
              targetMoveCount: 20,
              allowCfopFallback: false,
              premoveAllowCfopFallback: false,
              preferNonCfop: true,
              directProfileLevel: "deep",
              directPhaseAttemptTimeoutMs: 4000,
              // directStageBudgetMs not set → defaults to min(8000, timeBudgetMs * 0.42) = 8000ms
              // nissStageBudgetMs not set → same
              sweepProfileLevel: "balanced",
              sweepPhaseAttemptTimeoutMs: 1600,
              sweepAttemptBudgetMs: 1600,
              sweepUseScout: true,
              sweepScoutProfileLevel: "light",
              sweepScoutPhaseAttemptTimeoutMs: 700,
              sweepScoutAttemptBudgetMs: 700,
              sweepScoutIncludeInverse: true,
              sweepRefineSets: 8,
              verifyLimit: 18,
              enableInsertions: true,
              insertionCandidateLimit: 3,
              insertionMaxPasses: 3,
              insertionMinWindow: 3,
              insertionMaxWindow: 7,
              insertionMaxDepth: 6,
              insertionTimeMs: 5000,
              insertionThreshold: 24,
              crossColors: normalizeCrossColorList(crossColor),
            }),
            FMC_333_TIMEOUT_MS,
          ).catch(() => ({ ok: false, reason: "FMC_TIMEOUT" }));'''
new_fmc_block = '''        if (mode === "fmc") {
          const normalizedFmcQuality = String(fmcQualityMode || "sweetSpot").trim().toLowerCase();
          const isExtremeFmc = normalizedFmcQuality === "extreme";
          const effectiveFmcTimeBudgetMs = Number.isFinite(fmcTimeBudgetMs)
            ? fmcTimeBudgetMs
            : isExtremeFmc
              ? 90000
              : 8000;
          const effectiveFmcTargetMoveCount = Number.isFinite(fmcTargetMoveCount)
            ? fmcTargetMoveCount
            : isExtremeFmc
              ? 20
              : 24;
          const fmcResult = await withTimeout(
            solveWithFMCSearchLazy(scramble, onProgress, {
              qualityMode: isExtremeFmc ? "extreme" : "sweetSpot",
              timeBudgetMs: effectiveFmcTimeBudgetMs,
              targetMoveCount: effectiveFmcTargetMoveCount,
              allowCfopFallback: false,
              premoveAllowCfopFallback: false,
              preferNonCfop: true,
              verifyLimit: isExtremeFmc ? 32 : 18,
              enableInsertions: true,
              crossColors: normalizeCrossColorList(crossColor),
            }),
            Math.min(FMC_333_TIMEOUT_MS, effectiveFmcTimeBudgetMs + 15000),
          ).catch(() => ({ ok: false, reason: "FMC_TIMEOUT" }));'''
worker = replace_once(worker, old_fmc_block, new_fmc_block, "worker FMC preset call")
WORKER.write_text(worker)

print("Applied FMC sweet-spot and extreme quality presets")
