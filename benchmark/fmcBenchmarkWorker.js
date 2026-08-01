import { expose } from "../vendor/comlink/index.js";
import { solveWithFMCSearch } from "../solver/fmcSolver.js";

function normalizeCrossColorList(crossColor) {
  const normalized = String(crossColor || "D").toUpperCase();
  if (
    normalized === "CN" ||
    normalized === "COLOR_NEUTRAL" ||
    normalized === "COLOR-NEUTRAL" ||
    normalized === "AUTO"
  ) {
    return ["D", "U", "F", "B", "R", "L"];
  }
  return [normalized];
}

function normalizeQualityMode(value) {
  return String(value || "sweetSpot").trim().toLowerCase() === "extreme"
    ? "extreme"
    : "sweetSpot";
}

const api = {
  async ping() {
    return { ok: true, worker: "FMC_BENCHMARK_HUMAN_ONLY" };
  },

  async solve(payload = {}, onProgress) {
    const scramble = String(payload.scramble || "").trim();
    if (!scramble) return { ok: false, reason: "NO_SCRAMBLE" };

    const qualityMode = normalizeQualityMode(payload.fmcQualityMode);
    const timeBudgetMs = Number.isFinite(Number(payload.fmcTimeBudgetMs))
      ? Math.max(1000, Math.floor(Number(payload.fmcTimeBudgetMs)))
      : qualityMode === "extreme"
        ? 90000
        : 8000;
    const targetMoveCount = Number.isFinite(Number(payload.fmcTargetMoveCount))
      ? Math.max(1, Math.floor(Number(payload.fmcTargetMoveCount)))
      : qualityMode === "extreme"
        ? 20
        : 24;

    const result = await solveWithFMCSearch(scramble, onProgress, {
      qualityMode,
      timeBudgetMs,
      targetMoveCount,
      allowCfopFallback: false,
      premoveAllowCfopFallback: false,
      preferNonCfop: true,
      verifyLimit: qualityMode === "extreme" ? 32 : 18,
      enableInsertions: true,
      enableCoverageFallback: false,
      crossColors: normalizeCrossColorList(payload.crossColor),
    });

    if (result?.source === "FMC_TWOPHASE_FALLBACK") {
      return {
        ok: false,
        reason: "UNEXPECTED_FMC_TWOPHASE_FALLBACK",
        rejectedResult: result,
      };
    }

    return result || { ok: false, reason: "FMC_NO_RESULT" };
  },
};

expose(api);
