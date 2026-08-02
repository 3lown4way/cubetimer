import { expose } from "../vendor/comlink/index.js";
import { solveWithFMCSearch } from "../solver/fmcSolver.js";
import { buildFmcTablesWasm } from "../solver/wasmSolver.js";
import { FMC_EXTREME_PROFILE, buildFmcExtremeOptions } from "../solver/fmcExtremeProfile.js";

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
    const warmed = await buildFmcTablesWasm();
    return { ok: warmed === true, worker: "FMC_BENCHMARK_HUMAN_ONLY", warmed: warmed === true };
  },

  async solve(payload = {}, onProgress) {
    const scramble = String(payload.scramble || "").trim();
    if (!scramble) return { ok: false, reason: "NO_SCRAMBLE" };

    const qualityMode = normalizeQualityMode(payload.fmcQualityMode);
    const timeBudgetMs = Number.isFinite(Number(payload.fmcTimeBudgetMs))
      ? Math.max(100, Math.floor(Number(payload.fmcTimeBudgetMs)))
      : qualityMode === "extreme"
        ? 90000
        : 8000;
    const targetMoveCount = Number.isFinite(Number(payload.fmcTargetMoveCount))
      ? Math.max(1, Math.floor(Number(payload.fmcTargetMoveCount)))
      : qualityMode === "extreme"
        ? 20
        : 24;

    const solveOptions = qualityMode === "extreme"
      ? buildFmcExtremeOptions({
          timeBudgetMs,
          targetMoveCount,
          crossColors: normalizeCrossColorList(payload.crossColor),
        })
      : {
          qualityMode,
          timeBudgetMs,
          targetMoveCount,
          allowCfopFallback: false,
          premoveAllowCfopFallback: false,
          preferNonCfop: true,
          verifyLimit: 18,
          enableInsertions: true,
          enableCoverageFallback: false,
          requireTargetReached: false,
          crossColors: normalizeCrossColorList(payload.crossColor),
        };
    const result = await solveWithFMCSearch(scramble, onProgress, solveOptions);

    const actualExtremeProfile = result?.extremeProfileId || result?.performanceDiagnostics?.extremeProfileId || "";
    if (qualityMode === "extreme" && actualExtremeProfile && actualExtremeProfile !== FMC_EXTREME_PROFILE.id) {
      return {
        ok: false,
        reason: "FMC_EXTREME_PROFILE_MISMATCH",
        expectedProfile: FMC_EXTREME_PROFILE.id,
        actualProfile: actualExtremeProfile,
        rejectedResult: result,
      };
    }
    if (result?.source === "FMC_TWOPHASE_FALLBACK") {
      return {
        ok: false,
        reason: "UNEXPECTED_FMC_TWOPHASE_FALLBACK",
        rejectedResult: result,
      };
    }
    if (result?.ok && result.qualityMode !== qualityMode) {
      return {
        ok: false,
        reason: "FMC_QUALITY_MODE_DOWNGRADE_REJECTED",
        requestedQualityMode: qualityMode,
        actualQualityMode: result.qualityMode || "unknown",
        rejectedResult: result,
      };
    }
    if (result?.ok && result.qualityDowngraded === true) {
      return {
        ok: false,
        reason: "FMC_QUALITY_MODE_DOWNGRADE_REJECTED",
        rejectedResult: result,
      };
    }
    if (
      qualityMode === "extreme" &&
      result?.ok &&
      (result.qualityTargetReached !== true || Number(result.moveCount) > targetMoveCount)
    ) {
      return {
        ok: false,
        reason: "FMC_EXTREME_TARGET_NOT_REACHED",
        requestedTarget: targetMoveCount,
        rejectedResult: result,
      };
    }

    return result || { ok: false, reason: "FMC_NO_RESULT" };
  },
};

expose(api);
