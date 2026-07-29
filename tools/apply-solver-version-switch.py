from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} marker not found")
    return text.replace(old, new, 1)


# UI
index_path = Path("index.html")
index = index_path.read_text()
version_select = '''              <label for="solverVersionSelect">
                솔버 버전
                <select id="solverVersionSelect">
                  <option value="v1">v1 기존 엔진</option>
                  <option value="v2" selected>v2 최적화 엔진</option>
                </select>
              </label>
'''
index = replace_once(
    index,
    '''              <label for="f2lMethodSelect">
''',
    version_select + '''              <label for="f2lMethodSelect">
''',
    "solver version select",
)
index_path.write_text(index)

# Main-thread state and solve request
main_path = Path("main.js")
main = main_path.read_text()
main = replace_once(
    main,
    'const solverModeSelect = document.getElementById("solverModeSelect");\n',
    'const solverModeSelect = document.getElementById("solverModeSelect");\nconst solverVersionSelect = document.getElementById("solverVersionSelect");\n',
    "solver version element",
)
main = replace_once(
    main,
    '      solverMode: "strict",\n',
    '      solverMode: "strict",\n      solverVersion: "v2",\n',
    "default solver version",
)
main = replace_once(
    main,
    'const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);\n',
    'const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);\nconst VALID_SOLVER_VERSIONS = new Set(["v1", "v2"]);\n',
    "valid solver versions",
)
main = replace_once(
    main,
    '    const solverMode = appState.settings.solverMode || "strict";\n',
    '    const solverMode = appState.settings.solverMode || "strict";\n    const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)\n      ? appState.settings.solverVersion\n      : "v2";\n',
    "solve version selection",
)
main = replace_once(
    main,
    '        mode: solverMode,\n        f2lMethod,\n',
    '        mode: solverMode,\n        solverVersion,\n        f2lMethod,\n',
    "solve request version",
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

''',
    '''solverModeSelect?.addEventListener("change", () => {
  if (!solverModeSelect) return;
  appState.settings.solverMode = VALID_SOLVER_MODES.has(solverModeSelect.value)
    ? solverModeSelect.value
    : "strict";
  saveState();
});

solverVersionSelect?.addEventListener("change", () => {
  if (!solverVersionSelect) return;
  appState.settings.solverVersion = VALID_SOLVER_VERSIONS.has(solverVersionSelect.value)
    ? solverVersionSelect.value
    : "v2";
  saveState();
});

''',
    "solver version listener",
)
main = replace_once(
    main,
    '''    if (solverModeSelect) {
      solverModeSelect.value = appState.settings.solverMode || "strict";
    }
''',
    '''    if (solverModeSelect) {
      solverModeSelect.value = appState.settings.solverMode || "strict";
    }
    if (solverVersionSelect) {
      const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)
        ? appState.settings.solverVersion
        : "v2";
      appState.settings.solverVersion = solverVersion;
      solverVersionSelect.value = solverVersion;
    }
''',
    "solver version restore",
)
main_path.write_text(main)

# Worker routing
worker_path = Path("solver/solverWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'async function solveWithInternal3x3TwoPhase(scramble, onProgress) {\n',
    '''async function solveWithInternal3x3TwoPhase(scramble, onProgress, options = {}) {
  const maxFrontiers = options.solverVersion === "v1" ? 12 : TWOPHASE_333_MAX_FRONTIERS;
''',
    "two-phase version options",
)
worker = worker.replace('maxPhase1Solutions: TWOPHASE_333_MAX_FRONTIERS,', 'maxPhase1Solutions: maxFrontiers,', 2)
worker = replace_once(
    worker,
    '    let mode = "strict";\n    let f2lMethod = "legacy";\n',
    '    let mode = "strict";\n    let solverVersion = "v2";\n    let f2lMethod = "legacy";\n',
    "worker version variable",
)
worker = replace_once(
    worker,
    '''      if (typeof arg1.mode === "string" && arg1.mode) {
        mode = arg1.mode;
      }
''',
    '''      if (typeof arg1.mode === "string" && arg1.mode) {
        mode = arg1.mode;
      }
      if (arg1.solverVersion === "v1" || arg1.solverVersion === "v2") {
        solverVersion = arg1.solverVersion;
      }
''',
    "worker version parsing",
)
worker = replace_once(
    worker,
    '      return await solveWithInternal3x3TwoPhase(scramble, onProgress);\n',
    '      return await solveWithInternal3x3TwoPhase(scramble, onProgress, { solverVersion });\n',
    "two-phase version dispatch",
)
worker = replace_once(
    worker,
    '''          mode,
          f2lMethod,
''',
    '''          mode,
          solverVersion,
          f2lMethod,
''',
    "strict version dispatch",
)
worker_path.write_text(worker)

# CFOP route: v1 keeps formula beam; v2 may use compact F2L.
cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()
cfop = replace_once(
    cfop,
    '''  const preferCompactF2L =
    solveMode === "strict" &&
''',
    '''  const preferCompactF2L =
    options.solverVersion !== "v1" &&
    solveMode === "strict" &&
''',
    "versioned compact F2L",
)
cfop_path.write_text(cfop)

print("solver v1/v2 switch applied")
