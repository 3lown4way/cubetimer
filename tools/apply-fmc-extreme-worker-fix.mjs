import fs from "node:fs/promises";

const workerPath = "solver/solverWorker.js";
const original = await fs.readFile(workerPath, "utf8");
let updated = original;

if (!updated.includes("async function solveWithFmcExtremeHybridLazy(")) {
  const marker = `async function solveWithFMCSearchLazy(scramble, onProgress, options) {
  const { solveWithFMCSearch } = await getFmcSolverModule();
  return solveWithFMCSearch(scramble, onProgress, options);
}
`;
  if (!updated.includes(marker)) {
    throw new Error("FMC_LAZY_HELPER_MARKER_NOT_FOUND");
  }
  const helper = `${marker}
async function solveWithFmcExtremeHybridLazy(scramble, onProgress, options) {
  const { solveWithFmcExtremeHybrid } = await import("./fmcExtremeHybrid.js");
  return solveWithFmcExtremeHybrid(scramble, onProgress, options);
}
`;
  updated = updated.replace(marker, helper);
}

const blockPattern = /        if \(mode === "fmc"\) \{\n          const normalizedFmcQuality[\s\S]*?          return fmcResult \|\| \{ ok: false, reason: "FMC_FAILED" \};\n        \}/g;
const replacement = `        if (mode === "fmc") {
          const normalizedFmcQuality = String(fmcQualityMode || "sweetSpot").trim().toLowerCase();
          const isExtremeFmc = normalizedFmcQuality === "extreme";
          const effectiveFmcTimeBudgetMs = Number.isFinite(fmcTimeBudgetMs)
            ? fmcTimeBudgetMs
            : isExtremeFmc
              ? 120000
              : 8000;
          const effectiveFmcTargetMoveCount = Number.isFinite(fmcTargetMoveCount)
            ? fmcTargetMoveCount
            : isExtremeFmc
              ? 20
              : 24;
          const crossColors = normalizeCrossColorList(crossColor);
          const fmcPromise = isExtremeFmc
            ? solveWithFmcExtremeHybridLazy(scramble, onProgress, {
                timeBudgetMs: effectiveFmcTimeBudgetMs,
                targetMoveCount: effectiveFmcTargetMoveCount,
                crossColors,
              })
            : solveWithFMCSearchLazy(scramble, onProgress, {
                qualityMode: "sweetSpot",
                timeBudgetMs: effectiveFmcTimeBudgetMs,
                targetMoveCount: effectiveFmcTargetMoveCount,
                allowCfopFallback: false,
                premoveAllowCfopFallback: false,
                preferNonCfop: true,
                verifyLimit: 18,
                enableInsertions: true,
                crossColors,
              });
          const fmcTimeoutMs = isExtremeFmc
            ? effectiveFmcTimeBudgetMs + 15000
            : Math.min(FMC_333_TIMEOUT_MS, effectiveFmcTimeBudgetMs + 15000);
          const fmcResult = await withTimeout(fmcPromise, fmcTimeoutMs)
            .catch(() => ({ ok: false, reason: "FMC_TIMEOUT" }));
          if (fmcResult?.ok) {
            return fmcResult;
          }
          return fmcResult || { ok: false, reason: "FMC_FAILED" };
        }`;

let replaced = 0;
updated = updated.replace(blockPattern, () => {
  replaced += 1;
  return replacement;
});

if (replaced !== 2 && !original.includes("solveWithFmcExtremeHybridLazy(scramble, onProgress")) {
  throw new Error(`FMC_WORKER_BLOCK_COUNT_${replaced}`);
}

if (updated === original) {
  console.log("FMC extreme worker fix already applied");
} else {
  await fs.writeFile(workerPath, updated, "utf8");
  console.log(`Patched ${workerPath}; replaced ${replaced} FMC blocks`);
}
