from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
MAIN = ROOT / "main.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


index = INDEX.read_text()
index = replace_once(
    index,
    '''              <label for="solverVersionSelect">
                솔버 버전''',
    '''              <label for="fmcQualitySelect" id="fmcQualityField" hidden>
                FMC 품질
                <select id="fmcQualitySelect">
                  <option value="sweetSpot" selected>균형 최적화 (24수 목표)</option>
                  <option value="extreme">극한 최적화 (20수 목표)</option>
                </select>
              </label>
              <label for="solverVersionSelect">
                솔버 버전''',
    "FMC quality selector",
)
INDEX.write_text(index)

main = MAIN.read_text()
main = replace_once(
    main,
    '''const solverModeSelect = document.getElementById("solverModeSelect");
const solverVersionSelect = document.getElementById("solverVersionSelect");''',
    '''const solverModeSelect = document.getElementById("solverModeSelect");
const fmcQualityField = document.getElementById("fmcQualityField");
const fmcQualitySelect = document.getElementById("fmcQualitySelect");
const solverVersionSelect = document.getElementById("solverVersionSelect");''',
    "FMC quality DOM refs",
)
main = replace_once(
    main,
    '''const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);
const VALID_SOLVER_VERSIONS = new Set(["v1", "v2"]);''',
    '''const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);
const VALID_FMC_QUALITY_MODES = new Set(["sweetSpot", "extreme"]);
const VALID_SOLVER_VERSIONS = new Set(["v1", "v2"]);''',
    "FMC quality constants",
)
main = replace_once(
    main,
    '''      solverMode: "strict",
      solverVersion: "v2",''',
    '''      solverMode: "strict",
      fmcQualityMode: "sweetSpot",
      solverVersion: "v2",''',
    "FMC quality default state",
)
main = replace_once(
    main,
    '''    if (!parsed.settings.solverMode) parsed.settings.solverMode = "strict";
    if (!VALID_SOLVER_VERSIONS.has(parsed.settings.solverVersion)) parsed.settings.solverVersion = "v2";''',
    '''    if (!parsed.settings.solverMode) parsed.settings.solverMode = "strict";
    if (!VALID_FMC_QUALITY_MODES.has(parsed.settings.fmcQualityMode)) {
      parsed.settings.fmcQualityMode = "sweetSpot";
    }
    if (!VALID_SOLVER_VERSIONS.has(parsed.settings.solverVersion)) parsed.settings.solverVersion = "v2";''',
    "FMC quality state migration",
)
main = replace_once(
    main,
    '''function updateSolverControls() {
  if (!findSolutionBtn) return;
  const supported = isSolverSupportedEvent(appState.settings.eventId);
  findSolutionBtn.disabled = solverBusy || !currentScramble || !supported;
}
''',
    '''function updateFmcQualityControls() {
  const isFmcMode = appState.settings.solverMode === "fmc";
  if (fmcQualityField) fmcQualityField.hidden = !isFmcMode;
  if (fmcQualitySelect) {
    fmcQualitySelect.disabled = !isFmcMode;
    const selected = VALID_FMC_QUALITY_MODES.has(appState.settings.fmcQualityMode)
      ? appState.settings.fmcQualityMode
      : "sweetSpot";
    fmcQualitySelect.value = selected;
  }
}

function updateSolverControls() {
  updateFmcQualityControls();
  if (!findSolutionBtn) return;
  const supported = isSolverSupportedEvent(appState.settings.eventId);
  findSolutionBtn.disabled = solverBusy || !currentScramble || !supported;
}
''',
    "FMC quality control visibility",
)
main = replace_once(
    main,
    '''    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;
    if (isThreeByThreeFamilyEvent(appState.settings.eventId)) {
      solverStatus.textContent =
        solverMode === "fmc"
          ? "계산 중... (3x3 FMC 스타일 탐색: Direct + NISS + Premove)"''',
    '''    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;
    const fmcQualityMode = VALID_FMC_QUALITY_MODES.has(appState.settings.fmcQualityMode)
      ? appState.settings.fmcQualityMode
      : "sweetSpot";
    const fmcQualityLabel = fmcQualityMode === "extreme"
      ? "극한 최적화 · 20수 목표"
      : "균형 최적화 · 24수 목표";
    if (isThreeByThreeFamilyEvent(appState.settings.eventId)) {
      solverStatus.textContent =
        solverMode === "fmc"
          ? `계산 중... (3x3 FMC ${fmcQualityLabel})`''',
    "FMC quality status label",
)
main = replace_once(
    main,
    '''    const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)
      ? appState.settings.solverVersion
      : "v2";
    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;''',
    '''    const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)
      ? appState.settings.solverVersion
      : "v2";
    const fmcQualityMode = VALID_FMC_QUALITY_MODES.has(appState.settings.fmcQualityMode)
      ? appState.settings.fmcQualityMode
      : "sweetSpot";
    const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;''',
    "FMC quality solve variable",
)
main = replace_once(
    main,
    '''        mode: solverMode,
        solverVersion,
        f2lMethod,''',
    '''        mode: solverMode,
        solverVersion,
        fmcQualityMode,
        f2lMethod,''',
    "FMC quality worker forwarding",
)
main = replace_once(
    main,
    '''        const selectedCrossText =
          isThreeByThreeFamilyEvent(eventId) && selectedCrossColor ? `, cross ${selectedCrossColor}` : "";
        solverStatus.textContent = `완료 (${duration}ms${nodesText}${styleAppliedText}${styleFallbackText}${llPredictionText}${fallbackText}${selectedCrossText})`;''',
    '''        const selectedCrossText =
          isThreeByThreeFamilyEvent(eventId) && selectedCrossColor ? `, cross ${selectedCrossColor}` : "";
        const fmcQualityText = solverMode === "fmc"
          ? `, ${result.qualityMode === "extreme" ? "FMC Extreme" : "FMC Sweet Spot"}${result.qualityTargetReached ? " 목표 달성" : ""}`
          : "";
        solverStatus.textContent = `완료 (${duration}ms${nodesText}${styleAppliedText}${styleFallbackText}${llPredictionText}${fallbackText}${selectedCrossText}${fmcQualityText})`;''',
    "FMC quality completion label",
)
main = replace_once(
    main,
    '''solverModeSelect?.addEventListener("change", () => {
  if (!solverModeSelect) return;
  appState.settings.solverMode = VALID_SOLVER_MODES.has(solverModeSelect.value)
    ? solverModeSelect.value
    : "strict";
  saveState();
});

solverVersionSelect?.addEventListener''',
    '''solverModeSelect?.addEventListener("change", () => {
  if (!solverModeSelect) return;
  appState.settings.solverMode = VALID_SOLVER_MODES.has(solverModeSelect.value)
    ? solverModeSelect.value
    : "strict";
  updateFmcQualityControls();
  saveState();
});

fmcQualitySelect?.addEventListener("change", () => {
  if (!fmcQualitySelect) return;
  appState.settings.fmcQualityMode = VALID_FMC_QUALITY_MODES.has(fmcQualitySelect.value)
    ? fmcQualitySelect.value
    : "sweetSpot";
  saveState();
  resetSolverState();
});

solverVersionSelect?.addEventListener''',
    "FMC quality listeners",
)
main = replace_once(
    main,
    '''    if (solverModeSelect) {
      solverModeSelect.value = appState.settings.solverMode || "strict";
    }
    if (solverVersionSelect) {''',
    '''    if (solverModeSelect) {
      solverModeSelect.value = appState.settings.solverMode || "strict";
    }
    if (fmcQualitySelect) {
      fmcQualitySelect.value = VALID_FMC_QUALITY_MODES.has(appState.settings.fmcQualityMode)
        ? appState.settings.fmcQualityMode
        : "sweetSpot";
    }
    updateFmcQualityControls();
    if (solverVersionSelect) {''',
    "FMC quality initialization",
)
MAIN.write_text(main)

print("Applied FMC quality selector UI and request wiring")
