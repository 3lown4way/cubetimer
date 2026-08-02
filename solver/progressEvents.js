const COLOR_NEUTRAL_PROBE_START_STAGE = "Color Neutral Cross Probe";
const COLOR_NEUTRAL_PROBE_DONE_PREFIX = "Color Neutral -> ";

function normalizeProgressMode(mode) {
  return String(mode || "strict").trim().toLowerCase();
}

export function normalizeCfopProgressEvent(progress, mode = "strict") {
  if (!progress || typeof progress !== "object") return progress;

  const stageName = String(progress.stageName || "");
  const isColorNeutralProbeStart =
    progress.type === "fallback_start" && stageName === COLOR_NEUTRAL_PROBE_START_STAGE;
  const isColorNeutralProbeDone =
    progress.type === "fallback_done" && stageName.startsWith(COLOR_NEUTRAL_PROBE_DONE_PREFIX);

  if (!isColorNeutralProbeStart && !isColorNeutralProbeDone) return progress;

  const isZb = normalizeProgressMode(mode) === "zb";
  const selectedStage = isColorNeutralProbeDone
    ? stageName.slice(COLOR_NEUTRAL_PROBE_DONE_PREFIX.length).trim()
    : "";
  const baseStageName = isZb
    ? "Color Neutral ZB Opening Probe"
    : COLOR_NEUTRAL_PROBE_START_STAGE;
  const normalized = {
    ...progress,
    type: isColorNeutralProbeStart ? "probe_start" : "probe_done",
    stageName: selectedStage ? `${baseStageName} -> ${selectedStage}` : baseStageName,
  };

  if (isZb) normalized.reason = "BEST_ZB_OPENING_SCAN";
  return normalized;
}
