import { expose } from "../vendor/comlink/index.js";
import { solveWithFMCSearch } from "../solver/fmcSolver.js";
import { FMC_EXTREME_PROFILE } from "../solver/fmcExtremeProfile.js";
import {
  solveWithFmcExtremeHybrid,
  warmFmcExtremeHybrid,
} from "../solver/fmcExtremeHybrid.js";

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

function normalizeTimeBudgetMs(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1000, Math.floor(numeric))
    : fallback;
}

function containsForbiddenFallback(result) {
  const metadata = [
    result?.source,
    result?.candidateSource,
    result?.proofSource,
    result?.fallbackFrom,
    result?.fallbackSource,
    result?.fallbackReason,
  ].filter(Boolean).join(" ");
  return result?.fallbackUsed === true
    || result?.usedFallback === true
    || /(?:FALLBACK|EXTERNAL_CUBING_SEARCH)/i.test(metadata);
}

const api = {
  async ping() {
    const warmed = await warmFmcExtremeHybrid();
    return {
      ok: warmed === true,
      worker: "FMC_BENCHMARK_HYBRID_120S",
      warmed: warmed === true,
      extremeProfileId: FMC_EXTREME_PROFILE.id,
    };
  },

  async solve(payload = {}, onProgress) {
    const scramble = String(payload.scramble || "").trim();
    if (!scramble) return { ok: false, reason: "NO_SCRAMBLE" };

    const qualityMode = normalizeQualityMode(payload.fmcQualityMode);
    const timeBudgetMs = normalizeTimeBudgetMs(
      payload.fmcTimeBudgetMs,
      qualityMode === "extreme" ? FMC_EXTREME_PROFILE.defaultTimeBudgetMs : 8000,
    );
    const targetMoveCount = Number.isFinite(Number(payload.fmcTargetMoveCount))
      ? Math.max(1, Math.floor(Number(payload.fmcTargetMoveCount)))
      : qualityMode === "extreme"
        ? FMC_EXTREME_PROFILE.targetMoveCount
        : 24;
    const crossColors = normalizeCrossColorList(payload.crossColor);

    const result = qualityMode === "extreme"
      ? await solveWithFmcExtremeHybrid(scramble, onProgress, {
          timeBudgetMs,
          targetMoveCount,
          crossColors,
        })
      : await solveWithFMCSearch(scramble, onProgress, {
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
          crossColors,
        });

    const actualExtremeProfile = result?.extremeProfileId
      || result?.performanceDiagnostics?.extremeProfileId
      || "";
    if (
      qualityMode === "extreme"
      && actualExtremeProfile
      && actualExtremeProfile !== FMC_EXTREME_PROFILE.id
    ) {
      return {
        ok: false,
        reason: "FMC_EXTREME_PROFILE_MISMATCH",
        expectedProfile: FMC_EXTREME_PROFILE.id,
        actualProfile: actualExtremeProfile,
        rejectedResult: result,
      };
    }
    if (containsForbiddenFallback(result)) {
      return {
        ok: false,
        reason: "UNEXPECTED_FMC_FALLBACK",
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

    return result || { ok: false, reason: "FMC_NO_RESULT" };
  },
};

expose(api);
