from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"{label} marker not found")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Solver menu
# ---------------------------------------------------------------------------
index_path = Path("index.html")
index = index_path.read_text()
version_control = '''              <label for="solverVersionSelect">
                솔버 버전
                <select id="solverVersionSelect">
                  <option value="v1">v1 (기존 안정 버전)</option>
                  <option value="v2" selected>v2 (최적화 버전)</option>
                </select>
              </label>
'''
if 'id="solverVersionSelect"' not in index:
    marker = '''              <label for="f2lMethodSelect">
'''
    if marker not in index:
        raise RuntimeError("solver version menu marker not found")
    index = index.replace(marker, version_control + marker, 1)
index_path.write_text(index)


# ---------------------------------------------------------------------------
# Main-thread state, persistence, and worker payload
# ---------------------------------------------------------------------------
main_path = Path("main.js")
main = main_path.read_text()
main = replace_once(
    main,
    'const solverModeSelect = document.getElementById("solverModeSelect");\nconst f2lMethodSelect = document.getElementById("f2lMethodSelect");',
    'const solverModeSelect = document.getElementById("solverModeSelect");\nconst solverVersionSelect = document.getElementById("solverVersionSelect");\nconst f2lMethodSelect = document.getElementById("f2lMethodSelect");',
    "solver version element",
)
main = replace_once(
    main,
    'const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);\nconst VALID_F2L_METHODS',
    'const VALID_SOLVER_MODES = new Set(["strict", "minmove", "twophase", "zb", "roux", "fmc"]);\nconst VALID_SOLVER_VERSIONS = new Set(["v1", "v2"]);\nconst VALID_F2L_METHODS',
    "solver version constants",
)
main = replace_once(
    main,
    '      solverMode: "strict",\n      f2lMethod:',
    '      solverMode: "strict",\n      solverVersion: "v2",\n      f2lMethod:',
    "default solver version",
)
main = replace_once(
    main,
    '    if (!parsed.settings.solverMode) parsed.settings.solverMode = "strict";\n',
    '    if (!parsed.settings.solverMode) parsed.settings.solverMode = "strict";\n    if (!VALID_SOLVER_VERSIONS.has(parsed.settings.solverVersion)) parsed.settings.solverVersion = "v2";\n',
    "solver version migration",
)
main = replace_once(
    main,
    '    String(payload.mode || "strict").trim(),\n    String(payload.f2lMethod',
    '    String(payload.mode || "strict").trim(),\n    String(payload.solverVersion || "v2").trim(),\n    String(payload.f2lMethod',
    "warmup version key",
)
main = replace_once(
    main,
    '    mode: solverMode,\n    f2lMethod,\n    styleProfile,',
    '    mode: solverMode,\n    solverVersion: VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)\n      ? appState.settings.solverVersion\n      : "v2",\n    f2lMethod,\n    styleProfile,',
    "warmup version payload",
)
main = replace_once(
    main,
    '    const solverMode = appState.settings.solverMode || "strict";\n    const f2lMethod',
    '    const solverMode = appState.settings.solverMode || "strict";\n    const solverVersion = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)\n      ? appState.settings.solverVersion\n      : "v2";\n    const f2lMethod',
    "solve version selection",
)
main = replace_once(
    main,
    '        mode: solverMode,\n        f2lMethod,',
    '        mode: solverMode,\n        solverVersion,\n        f2lMethod,',
    "solve version payload",
)
version_listener = '''
solverVersionSelect?.addEventListener("change", () => {
  if (!solverVersionSelect) return;
  appState.settings.solverVersion = VALID_SOLVER_VERSIONS.has(solverVersionSelect.value)
    ? solverVersionSelect.value
    : "v2";
  saveState();
});
'''
if 'solverVersionSelect?.addEventListener("change"' not in main:
    marker = '''
f2lMethodSelect?.addEventListener("change", () => {
'''
    if marker not in main:
        raise RuntimeError("solver version listener marker not found")
    main = main.replace(marker, version_listener + marker, 1)
main = replace_once(
    main,
    '    if (solverModeSelect) {\n      solverModeSelect.value = appState.settings.solverMode || "strict";\n    }\n    if (f2lMethodSelect)',
    '    if (solverModeSelect) {\n      solverModeSelect.value = appState.settings.solverMode || "strict";\n    }\n    if (solverVersionSelect) {\n      solverVersionSelect.value = VALID_SOLVER_VERSIONS.has(appState.settings.solverVersion)\n        ? appState.settings.solverVersion\n        : "v2";\n    }\n    if (f2lMethodSelect)',
    "solver version initialization",
)
main_path.write_text(main)


# ---------------------------------------------------------------------------
# Worker version routing
# ---------------------------------------------------------------------------
worker_path = Path("solver/solverWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'const TWOPHASE_333_MAX_FRONTIERS = 2;',
    'const TWOPHASE_333_V1_MAX_FRONTIERS = 12;\nconst TWOPHASE_333_V2_MAX_FRONTIERS = 2;',
    "versioned two-phase constants",
)
normalize_version = '''
function normalizeSolverVersion(version) {
  return String(version || "v2").toLowerCase() === "v1" ? "v1" : "v2";
}

function getTwophaseFrontierLimit(solverVersion) {
  return normalizeSolverVersion(solverVersion) === "v1"
    ? TWOPHASE_333_V1_MAX_FRONTIERS
    : TWOPHASE_333_V2_MAX_FRONTIERS;
}
'''
if 'function normalizeSolverVersion(version)' not in worker:
    marker = '''
function normalizeF2LMethod(method) {
'''
    if marker not in worker:
        raise RuntimeError("worker version normalization marker not found")
    worker = worker.replace(marker, normalize_version + marker, 1)
worker = replace_once(
    worker,
    'async function solveWithInternal3x3TwoPhase(scramble, onProgress) {\n  const inverseSolution',
    'async function solveWithInternal3x3TwoPhase(scramble, onProgress, solverVersion = "v2") {\n  const maxFrontiers = getTwophaseFrontierLimit(solverVersion);\n  const inverseSolution',
    "two-phase version argument",
)
worker = worker.replace('maxPhase1Solutions: TWOPHASE_333_MAX_FRONTIERS,', 'maxPhase1Solutions: maxFrontiers,', 2)
worker = replace_once(
    worker,
    '    let mode = "strict";\n    let f2lMethod',
    '    let mode = "strict";\n    let solverVersion = "v2";\n    let f2lMethod',
    "worker version variable",
)
worker = replace_once(
    worker,
    '      if (typeof arg1.f2lMethod === "string" && arg1.f2lMethod) {',
    '      if (typeof arg1.solverVersion === "string" && arg1.solverVersion) {\n        solverVersion = arg1.solverVersion;\n      }\n      if (typeof arg1.f2lMethod === "string" && arg1.f2lMethod) {',
    "worker version parsing",
)
worker = replace_once(
    worker,
    '    mode = normalizeMode(mode);\n    f2lMethod = normalizeF2LMethod(f2lMethod);',
    '    mode = normalizeMode(mode);\n    solverVersion = normalizeSolverVersion(solverVersion);\n    f2lMethod = normalizeF2LMethod(f2lMethod);',
    "worker version normalization",
)
worker = replace_once(
    worker,
    '      return await solveWithInternal3x3TwoPhase(scramble, onProgress);',
    '      return await solveWithInternal3x3TwoPhase(scramble, onProgress, solverVersion);',
    "worker two-phase routing",
)
worker = replace_once(
    worker,
    '          mode,\n          f2lMethod,',
    '          mode,\n          solverVersion,\n          f2lMethod,',
    "worker CFOP version payload",
)
worker_path.write_text(worker)


# ---------------------------------------------------------------------------
# CFOP/ZBLL v1-v2 implementation
# ---------------------------------------------------------------------------
cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()
cfop = replace_once(
    cfop,
    'const singleStageFormulaCaseLibraryCache = new Map();\nconst SINGLE_STAGE_LIBRARY_CACHE_LIMIT',
    '''const singleStageFormulaCaseLibraryCache = new Map();
let staticZbllCaseIndex = null;
let staticZbllCaseCount = 0;
let staticZbllCaseIndexPromise = null;
let staticZbllCaseLibrary = null;
const SINGLE_STAGE_LIBRARY_CACHE_LIMIT''',
    "static ZBLL cache state",
)
static_helpers = '''
async function ensureStaticZbllCaseIndex() {
  if (staticZbllCaseIndex) return staticZbllCaseIndex;
  if (staticZbllCaseIndexPromise) return staticZbllCaseIndexPromise;
  staticZbllCaseIndexPromise = import("./zbllCaseIndex.js")
    .then((mod) => {
      const index = mod?.ZBLL_CASE_INDEX;
      if (!index || typeof index !== "object") return null;
      staticZbllCaseIndex = index;
      staticZbllCaseCount = Number.isFinite(mod?.ZBLL_CASE_COUNT)
        ? Math.max(0, Math.floor(mod.ZBLL_CASE_COUNT))
        : Object.keys(index).length;
      return staticZbllCaseIndex;
    })
    .catch(() => null);
  return staticZbllCaseIndexPromise;
}

function getStaticZbllCaseLibrary() {
  if (!staticZbllCaseIndex) return null;
  if (staticZbllCaseLibrary) return staticZbllCaseLibrary;
  const packedIndex = staticZbllCaseIndex;
  staticZbllCaseLibrary = {
    useZbllKey: true,
    staticIndex: true,
    caseMap: {
      size: staticZbllCaseCount,
      get(caseKey) {
        const packedCandidates = packedIndex[caseKey];
        if (!Array.isArray(packedCandidates) || packedCandidates.length === 0) return undefined;
        return packedCandidates.map((packed) => {
          const text = String(Array.isArray(packed) ? packed[0] || "" : "");
          const formulaKey = String(Array.isArray(packed) ? packed[1] || "" : "") || null;
          return {
            text,
            normalizedText: normalizeFormulaMatchText(text),
            moves: splitMoves(text),
            formulaKey,
          };
        });
      },
    },
  };
  return staticZbllCaseLibrary;
}
'''
if 'async function ensureStaticZbllCaseIndex()' not in cfop:
    marker = '''
function snapshotCfopLibraryTelemetry() {
'''
    if marker not in cfop:
        raise RuntimeError("static ZBLL helper marker not found")
    cfop = cfop.replace(marker, static_helpers + marker, 1)
normalize_cfop_version = '''
function normalizeSolverVersion(version) {
  return String(version || "v2").toLowerCase() === "v1" ? "v1" : "v2";
}
'''
if 'function normalizeSolverVersion(version)' not in cfop:
    marker = '''
function normalizeSolveMode(mode) {
'''
    if marker not in cfop:
        raise RuntimeError("CFOP version normalization marker not found")
    cfop = cfop.replace(marker, normalize_cfop_version + marker, 1)
cfop = replace_once(
    cfop,
    'function getStageDefinitions(options, ctx, profile, solveMode) {\n  const useZbStages',
    'function getStageDefinitions(options, ctx, profile, solveMode) {\n  const solverVersion = normalizeSolverVersion(options.solverVersion);\n  const useZbStages',
    "stage solver version",
)
cfop = replace_once(
    cfop,
    '  const preferCompactF2L =\n    solveMode === "strict" &&',
    '  const preferCompactF2L =\n    solverVersion === "v2" &&\n    solveMode === "strict" &&',
    "versioned compact F2L",
)
# Add the version to each formula-driven stage that can select ZBLL.
cfop = replace_once(
    cfop,
    '      name: f2lStageName,\n      displayName: f2lStageDisplayName,',
    '      name: f2lStageName,\n      displayName: f2lStageDisplayName,\n      solverVersion,',
    "F2L stage version",
)
cfop = replace_once(
    cfop,
    '      name: stage3Name,\n      displayName: stage3Name,',
    '      name: stage3Name,\n      displayName: stage3Name,\n      solverVersion,',
    "stage3 version",
)
cfop = replace_once(
    cfop,
    '      name: stage4Name,\n      displayName: stage4Name,',
    '      name: stage4Name,\n      displayName: stage4Name,\n      solverVersion,',
    "stage4 version",
)
# Separate the v1 dynamic and v2 static ZBLL cache namespaces.
cfop = replace_once(
    cfop,
    '''  const cacheKey = getSingleStageCaseLibraryKey(
    stage,
    libraryFormulas,
    preAufList,
    postAufList,
    canonicalFormulaKeys,
  );''',
    '''  const isZbllLibrary = typeof stage.zbllKey === "function" &&
    Array.isArray(canonicalFormulaKeys) && canonicalFormulaKeys.length > 0 &&
    canonicalFormulaKeys.includes("ZBLL") &&
    canonicalFormulaKeys.every((key) => key === "ZBLL" || key === "PLL");
  const solverVersion = normalizeSolverVersion(stage?.solverVersion);
  const baseCacheKey = getSingleStageCaseLibraryKey(
    stage,
    libraryFormulas,
    preAufList,
    postAufList,
    canonicalFormulaKeys,
  );
  const cacheKey = isZbllLibrary ? `${baseCacheKey}::${solverVersion}` : baseCacheKey;''',
    "versioned ZBLL cache key",
)
cfop = replace_once(
    cfop,
    '''  const useZbllKey = typeof stage.zbllKey === "function" &&
    Array.isArray(canonicalFormulaKeys) && canonicalFormulaKeys.length > 0 &&
    canonicalFormulaKeys.includes("ZBLL") &&
    canonicalFormulaKeys.every(k => k === "ZBLL" || k === "PLL");
  const getKeyFn''',
    '''  const useZbllKey = isZbllLibrary;
  if (useZbllKey && solverVersion === "v2") {
    const staticLibrary = getStaticZbllCaseLibrary();
    if (staticLibrary) {
      singleStageFormulaCaseLibraryCache.set(cacheKey, staticLibrary);
      if (performanceCollector) {
        performanceCollector.libraryCacheHit = true;
        performanceCollector.cacheSize = singleStageFormulaCaseLibraryCache.size;
      }
      return staticLibrary;
    }
  }
  const getKeyFn''',
    "static ZBLL dispatch",
)
# Load the static module only for v2 ZB/mixed-ZBLL solves; a failed load safely falls back.
cfop = replace_once(
    cfop,
    '  const solveMode = normalizeSolveMode(options.mode);\n  const modeProfile',
    '  const solveMode = normalizeSolveMode(options.mode);\n  const solverVersion = normalizeSolverVersion(options.solverVersion);\n  if (solverVersion === "v2" && (solveMode === "zb" || options.enableMixedCfopStages === true)) {\n    await ensureStaticZbllCaseIndex();\n  }\n  const modeProfile',
    "static ZBLL load",
)
# Restore explicit prewarm behavior only for v1; v2 remains lazy/static.
cfop = replace_once(
    cfop,
    '  if (options.includeSingleStage !== false) {\n  }',
    '  if (options.includeSingleStage !== false && normalizeSolverVersion(options.solverVersion) === "v1") {\n    _warmOllPllLibraries(ctx);\n  }\n  if (options.includeSingleStage !== false && normalizeSolverVersion(options.solverVersion) === "v2") {\n    await ensureStaticZbllCaseIndex();\n  }',
    "versioned prewarm",
)
# Export the canonical dynamic index builder used by the build-time generator.
export_builder = '''
export async function buildZbllCaseIndexData() {
  const ctx = await getCfopContext();
  const stage = {
    name: "ZBLL",
    solverVersion: "v1",
    formulaKeys: ["ZBLL", "PLL"],
    maxDepth: 22,
    formulaPreAufList: FORMULA_AUF,
    formulaPostAufList: FORMULA_AUF,
    key(data) {
      const c = buildKeyForOrbit(data.CORNERS, [0, 1, 2, 3, 4, 5, 6, 7], true, true);
      const e = buildKeyForOrbit(data.EDGES, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], true, true);
      return `C:${c}|E:${e}`;
    },
    zbllKey(data) {
      const topC = buildKeyForOrbit(data.CORNERS, ctx.topCornerPositions, true, true);
      const topE = buildKeyForOrbit(data.EDGES, ctx.topEdgePositions, true, true);
      return `ZC:${topC}|ZE:${topE}`;
    },
  };
  const formulas = filterValidFormulas(getFormulaListForStage(stage), ctx);
  const library = getSingleStageFormulaCaseLibrary(
    stage,
    ctx,
    formulas,
    FORMULA_AUF,
    FORMULA_AUF,
    ["ZBLL", "PLL"],
    buildFormulaKeyLookup(["ZBLL", "PLL"]),
  );
  if (!library?.caseMap || typeof library.caseMap.entries !== "function") {
    throw new Error("ZBLL_CASE_LIBRARY_EXPORT_UNAVAILABLE");
  }
  const index = Object.create(null);
  let candidateCount = 0;
  for (const [caseKey, candidates] of library.caseMap.entries()) {
    if (!Array.isArray(candidates) || candidates.length === 0) continue;
    index[caseKey] = candidates.map((candidate) => {
      candidateCount += 1;
      return [String(candidate?.text || ""), String(candidate?.formulaKey || "")];
    });
  }
  return {
    index,
    caseCount: Object.keys(index).length,
    candidateCount,
  };
}
'''
if 'export async function buildZbllCaseIndexData()' not in cfop:
    marker = '''
export async function prewarm3x3StrictCfopLibraries(options = {}) {
'''
    if marker not in cfop:
        raise RuntimeError("ZBLL export builder marker not found")
    cfop = cfop.replace(marker, export_builder + marker, 1)
cfop_path.write_text(cfop)


# ---------------------------------------------------------------------------
# Deterministic generated-index tool
# ---------------------------------------------------------------------------
generator_path = Path("tools/generate-zbll-case-index.mjs")
generator_path.write_text('''import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildZbllCaseIndexData } from "../solver/cfop3x3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "solver", "zbllCaseIndex.js");
const checkOnly = process.argv.includes("--check");
const { index, caseCount, candidateCount } = await buildZbllCaseIndexData();
const source = [
  "// Auto-generated by tools/generate-zbll-case-index.mjs",
  "// Do not edit by hand.",
  `export const ZBLL_CASE_COUNT = ${caseCount};`,
  `export const ZBLL_CASE_INDEX = ${JSON.stringify(index)};`,
  "",
].join("\\n");

if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== source) {
    throw new Error("ZBLL_CASE_INDEX_OUT_OF_DATE");
  }
  console.log(`verified ${path.relative(root, outputPath)} cases=${caseCount} candidates=${candidateCount}`);
} else {
  fs.writeFileSync(outputPath, source);
  const bytes = Buffer.byteLength(source);
  console.log(`generated ${path.relative(root, outputPath)}`);
  console.log(`cases=${caseCount} candidates=${candidateCount} bytes=${bytes}`);
}
''')

print("solver v1/v2 patch applied")
