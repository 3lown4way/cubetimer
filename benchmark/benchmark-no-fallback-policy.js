import { FMC_EXTREME_PROFILE } from "../solver/fmcExtremeProfile.js";

const FALLBACK_MARKER = /(?:FALLBACK|RETRY|EXTERNAL_CUBING_SEARCH)/i;
const MINMOVE_TARGET_HTM = 18;
const MINMOVE_MAX_HTM = 20;

function normalizeAlgorithm(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).join(" ");
}

function countMoves(value) {
  const normalized = normalizeAlgorithm(value);
  return normalized ? normalized.split(" ").length : 0;
}

function invertMove(token) {
  const move = String(token || "").trim();
  if (!/^[URFDLB](?:2'|2|')?$/.test(move)) return "";
  if (move.endsWith("2") || move.endsWith("2'")) return `${move[0]}2`;
  return move.endsWith("'") ? move.slice(0, -1) : `${move}'`;
}

export function invertBenchmarkScramble(scramble) {
  const moves = normalizeAlgorithm(scramble).split(" ").filter(Boolean);
  if (!moves.length) return "";
  const inverse = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const move = invertMove(moves[index]);
    if (!move) return "";
    inverse.push(move);
  }
  return inverse.join(" ");
}

function reject(reason) {
  return { ok: false, reason, source: `REJECTED_${reason}` };
}

export function enforceBenchmarkNoFallback({ config = {}, scramble = "", result = {} } = {}) {
  if (result?.ok !== true) return { ok: true, reason: "", source: "" };

  const source = String(result?.source || result?.proofSource || "");
  const proofSource = String(result?.proofSource || "");
  const metadata = [
    source,
    proofSource,
    result?.candidateSource,
    result?.fallbackFrom,
    result?.fallbackSource,
    result?.fallbackReason,
  ].filter(Boolean).join(" ");

  if (
    result?.fallbackUsed === true
    || result?.usedFallback === true
    || FALLBACK_MARKER.test(metadata)
  ) return reject("BENCHMARK_FALLBACK_FORBIDDEN");

  const mode = String(config?.mode || "").toLowerCase();
  if ((mode === "strict" || mode === "zb") && !/^INTERNAL_3X3_CFOP/.test(source)) {
    return reject("BENCHMARK_METHOD_SOURCE_MISMATCH");
  }
  if (mode === "roux" && !/^INTERNAL_3X3_ROUX/.test(source)) {
    return reject("BENCHMARK_METHOD_SOURCE_MISMATCH");
  }
  if (mode === "twophase") {
    if (!/^WASM_3X3_TWOPHASE/.test(source)) {
      return reject("BENCHMARK_METHOD_SOURCE_MISMATCH");
    }
    const inverse = invertBenchmarkScramble(scramble);
    if (inverse && normalizeAlgorithm(result?.solution) === inverse) {
      return reject("TWOPHASE_TRIVIAL_INVERSE_REJECTED");
    }
  }
  if (mode === "minmove") {
    // MinMove is best-effort rather than proof-only, but the output contract is
    // strict: target <=18 HTM, hard maximum <=20 HTM, and no literal inverse.
    const normalizedSolution = normalizeAlgorithm(result?.solution);
    const moveCount = Number.isFinite(Number(result?.moveCount))
      ? Math.floor(Number(result.moveCount))
      : countMoves(normalizedSolution);
    if (!normalizedSolution || moveCount <= 0) {
      return reject("MINMOVE_INVALID_RESULT");
    }
    if (moveCount > MINMOVE_MAX_HTM || countMoves(normalizedSolution) > MINMOVE_MAX_HTM) {
      return reject("MINMOVE_OVER_20_REJECTED");
    }
    if (result?.targetReached === true && moveCount > MINMOVE_TARGET_HTM) {
      return reject("MINMOVE_TARGET_FLAG_MISMATCH");
    }
    const inverse = invertBenchmarkScramble(scramble);
    if (inverse && normalizedSolution === inverse) {
      return reject("MINMOVE_TRIVIAL_INVERSE_REJECTED");
    }
  }
  if (mode === "fmc") {
    const requestedQuality = String(config?.fmcQualityMode || "sweetSpot").trim().toLowerCase();
    const actualQuality = String(result?.qualityMode || "").trim().toLowerCase();
    if (!actualQuality || actualQuality !== requestedQuality || result?.qualityDowngraded === true) {
      return reject("FMC_QUALITY_MODE_DOWNGRADE_REJECTED");
    }
    if (requestedQuality === "extreme") {
      if (String(result?.extremeProfileId || "") !== FMC_EXTREME_PROFILE.id) {
        return reject("FMC_EXTREME_PROFILE_MISMATCH");
      }
      const moveCount = Number(result?.moveCount);
      if (!Number.isFinite(moveCount) || moveCount <= 0 || !normalizeAlgorithm(result?.solution)) {
        return reject("FMC_EXTREME_INVALID_BEST_RESULT");
      }
      const target = Number.isFinite(Number(config?.fmcTargetMoveCount))
        ? Number(config.fmcTargetMoveCount)
        : FMC_EXTREME_PROFILE.targetMoveCount;
      if (result?.qualityTargetReached === true && moveCount > target) {
        return reject("FMC_EXTREME_TARGET_FLAG_MISMATCH");
      }
    }
  }
  return { ok: true, reason: "", source: "" };
}
