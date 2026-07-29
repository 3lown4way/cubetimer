#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import re

SOLVER = pathlib.Path("solver/cfop3x3.js")
GENERATOR = pathlib.Path("tools/generate-zbll-case-index.mjs")
MARKER = "const PRECOMPILED_ZB_CASE_INDEX_VERSION = 2;"

text = SOLVER.read_text(encoding="utf-8")
if MARKER in text:
    print("Precompiled ZB case indexes already applied")
    raise SystemExit(0)

text = text.replace(
    "const F2L_COMPACT_KERNEL_VERSION = 2;\n",
    "const F2L_COMPACT_KERNEL_VERSION = 2;\n"
    f"{MARKER}\n",
    1,
)

old_vars = '''let staticZbllCaseIndex = null;
let staticZbllCaseCount = 0;
let staticZbllCaseIndexPromise = null;
let staticZbllCaseLibrary = null;
'''
new_vars = '''let staticZbllCaseIndex = null;
let staticZbllCaseCount = 0;
let staticZblsCaseIndex = null;
let staticZblsCaseCount = 0;
let staticZbllCaseIndexPromise = null;
let staticZbllCaseLibrary = null;
let staticZblsCaseLibrary = null;
'''
if old_vars not in text:
    raise RuntimeError("static ZB variable block not found")
text = text.replace(old_vars, new_vars, 1)

static_pattern = re.compile(
    r"async function ensureStaticZbllCaseIndex\(\) \{.*?\n\}\n\nfunction snapshotCfopLibraryTelemetry",
    re.S,
)
static_replacement = r'''async function ensureStaticZbllCaseIndex() {
  if (staticZbllCaseIndex && staticZblsCaseIndex) return staticZbllCaseIndex;
  if (staticZbllCaseIndexPromise) return staticZbllCaseIndexPromise;
  staticZbllCaseIndexPromise = import("./zbllCaseIndex.js")
    .then((mod) => {
      const zbllIndex = mod?.ZBLL_CASE_INDEX;
      if (zbllIndex && typeof zbllIndex === "object") {
        staticZbllCaseIndex = zbllIndex;
        staticZbllCaseCount = Number.isFinite(mod?.ZBLL_CASE_COUNT)
          ? Math.max(0, Math.floor(mod.ZBLL_CASE_COUNT))
          : Object.keys(zbllIndex).length;
      }
      const zblsIndex = mod?.ZBLS_CASE_INDEX;
      if (zblsIndex && typeof zblsIndex === "object") {
        staticZblsCaseIndex = zblsIndex;
        staticZblsCaseCount = Number.isFinite(mod?.ZBLS_CASE_COUNT)
          ? Math.max(0, Math.floor(mod.ZBLS_CASE_COUNT))
          : Object.keys(zblsIndex).length;
      }
      return staticZbllCaseIndex;
    })
    .catch(() => null);
  return staticZbllCaseIndexPromise;
}

function createStaticSingleStageCaseLibrary(packedIndex, caseCount, useZbllKey) {
  if (!packedIndex || typeof packedIndex !== "object") return null;
  const decodedCases = new Map();
  const decodeCase = (caseKey) => {
    if (decodedCases.has(caseKey)) return decodedCases.get(caseKey);
    const packedCandidates = packedIndex[caseKey];
    if (!Array.isArray(packedCandidates) || packedCandidates.length === 0) {
      decodedCases.set(caseKey, undefined);
      return undefined;
    }
    const candidates = new Array(packedCandidates.length);
    for (let i = 0; i < packedCandidates.length; i++) {
      const packed = packedCandidates[i];
      const text = String(Array.isArray(packed) ? packed[0] || "" : "");
      const formulaKey = String(Array.isArray(packed) ? packed[1] || "" : "") || null;
      const precompiledMoves = Array.isArray(packed?.[2]) ? packed[2] : null;
      const normalizedText = String(Array.isArray(packed) ? packed[3] || "" : "")
        || normalizeFormulaMatchText(text);
      candidates[i] = {
        text,
        normalizedText,
        moves: precompiledMoves || splitMoves(text),
        formulaKey,
      };
    }
    decodedCases.set(caseKey, candidates);
    return candidates;
  };
  return {
    useZbllKey,
    staticIndex: true,
    precompiledMoves: true,
    caseMap: {
      size: caseCount,
      get: decodeCase,
      has(caseKey) {
        return Object.prototype.hasOwnProperty.call(packedIndex, caseKey);
      },
    },
  };
}

function getStaticZbllCaseLibrary() {
  if (!staticZbllCaseIndex) return null;
  if (!staticZbllCaseLibrary) {
    staticZbllCaseLibrary = createStaticSingleStageCaseLibrary(
      staticZbllCaseIndex,
      staticZbllCaseCount,
      true,
    );
  }
  return staticZbllCaseLibrary;
}

function getStaticZblsCaseLibrary() {
  if (!staticZblsCaseIndex) return null;
  if (!staticZblsCaseLibrary) {
    staticZblsCaseLibrary = createStaticSingleStageCaseLibrary(
      staticZblsCaseIndex,
      staticZblsCaseCount,
      false,
    );
  }
  return staticZblsCaseLibrary;
}

function snapshotCfopLibraryTelemetry'''
if not static_pattern.search(text):
    raise RuntimeError("static ZB loader block not found")
text = static_pattern.sub(static_replacement, text, count=1)

# Prefer the generated ZBLS index for opportunity checks after the v2 prewarm import.
old_zbls_start = '''function getZblsLibraryForCtx(ctx) {
  const zblsStage = {
'''
new_zbls_start = '''function getZblsLibraryForCtx(ctx) {
  const staticLibrary = getStaticZblsCaseLibrary();
  if (staticLibrary) return staticLibrary;
  const zblsStage = {
'''
if old_zbls_start not in text:
    raise RuntimeError("getZblsLibraryForCtx anchor not found")
text = text.replace(old_zbls_start, new_zbls_start, 1)

# Add a reusable packer and replace the ZBLL export body, then add ZBLS export.
export_pattern = re.compile(
    r"export async function buildZbllCaseIndexData\(\) \{.*?\n\}\n\nexport async function prewarm3x3StrictCfopLibraries",
    re.S,
)
export_replacement = r'''function packStaticSingleStageCaseIndex(library, errorCode) {
  if (!library?.caseMap || typeof library.caseMap.entries !== "function") {
    throw new Error(errorCode);
  }
  const index = Object.create(null);
  let candidateCount = 0;
  for (const [caseKey, candidates] of library.caseMap.entries()) {
    if (!Array.isArray(candidates) || candidates.length === 0) continue;
    index[caseKey] = candidates.map((candidate) => {
      candidateCount += 1;
      const text = String(candidate?.text || "");
      const moves = Array.isArray(candidate?.moves) ? candidate.moves.slice() : splitMoves(text);
      const normalizedText = String(candidate?.normalizedText || "") || normalizeFormulaMatchText(text);
      return [text, String(candidate?.formulaKey || ""), moves, normalizedText];
    });
  }
  return {
    index,
    caseCount: Object.keys(index).length,
    candidateCount,
  };
}

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
  return packStaticSingleStageCaseIndex(library, "ZBLL_CASE_LIBRARY_EXPORT_UNAVAILABLE");
}

export async function buildZblsCaseIndexData() {
  const ctx = await getCfopContext();
  const stage = {
    name: "ZBLS",
    solverVersion: "v1",
    formulaKeys: ["ZBLS"],
    maxDepth: 22,
    formulaPreAufList: FORMULA_AUF,
    key(data) {
      return buildZblsKey(data, ctx);
    },
  };
  const formulas = filterValidFormulas(getFormulaListForStage(stage), ctx);
  const library = getSingleStageFormulaCaseLibrary(
    stage,
    ctx,
    formulas,
    FORMULA_AUF,
    [""],
    ["ZBLS"],
    buildFormulaKeyLookup(["ZBLS"]),
  );
  return packStaticSingleStageCaseIndex(library, "ZBLS_CASE_LIBRARY_EXPORT_UNAVAILABLE");
}

export async function prewarm3x3StrictCfopLibraries'''
if not export_pattern.search(text):
    raise RuntimeError("ZBLL export function block not found")
text = export_pattern.sub(export_replacement, text, count=1)

# Add ZBLS classification beside ZBLL in the single-stage library factory.
old_classification = '''  const isZbllLibrary = typeof stage.zbllKey === "function" &&
    Array.isArray(canonicalFormulaKeys) && canonicalFormulaKeys.length > 0 &&
    canonicalFormulaKeys.includes("ZBLL") &&
    canonicalFormulaKeys.every((key) => key === "ZBLL" || key === "PLL");
  const solverVersion = normalizeSolverVersion(stage?.solverVersion);
'''
new_classification = '''  const isZbllLibrary = typeof stage.zbllKey === "function" &&
    Array.isArray(canonicalFormulaKeys) && canonicalFormulaKeys.length > 0 &&
    canonicalFormulaKeys.includes("ZBLL") &&
    canonicalFormulaKeys.every((key) => key === "ZBLL" || key === "PLL");
  const isZblsLibrary = stage?.name === "ZBLS" &&
    Array.isArray(canonicalFormulaKeys) && canonicalFormulaKeys.length === 1 &&
    canonicalFormulaKeys[0] === "ZBLS";
  const solverVersion = normalizeSolverVersion(stage?.solverVersion);
'''
if old_classification not in text:
    raise RuntimeError("single-stage classification block not found")
text = text.replace(old_classification, new_classification, 1)

old_cache = '''  const cacheKey = isZbllLibrary ? `${baseCacheKey}::${solverVersion}` : baseCacheKey;
'''
new_cache = '''  const cacheKey = (isZbllLibrary || isZblsLibrary)
    ? `${baseCacheKey}::${solverVersion}`
    : baseCacheKey;
'''
if old_cache not in text:
    raise RuntimeError("single-stage cache key anchor not found")
text = text.replace(old_cache, new_cache, 1)

old_static_select = '''  const useZbllKey = isZbllLibrary;
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
'''
new_static_select = '''  const useZbllKey = isZbllLibrary;
  if (solverVersion === "v2" && (isZbllLibrary || isZblsLibrary)) {
    const staticLibrary = isZbllLibrary
      ? getStaticZbllCaseLibrary()
      : getStaticZblsCaseLibrary();
    if (staticLibrary) {
      singleStageFormulaCaseLibraryCache.set(cacheKey, staticLibrary);
      if (performanceCollector) {
        performanceCollector.libraryCacheHit = true;
        performanceCollector.cacheSize = singleStageFormulaCaseLibraryCache.size;
      }
      return staticLibrary;
    }
  }
'''
if old_static_select not in text:
    raise RuntimeError("static single-stage selection block not found")
text = text.replace(old_static_select, new_static_select, 1)

SOLVER.write_text(text, encoding="utf-8")

generator = '''import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildZbllCaseIndexData, buildZblsCaseIndexData } from "../solver/cfop3x3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(root, "solver", "zbllCaseIndex.js");
const checkOnly = process.argv.includes("--check");
const zbll = await buildZbllCaseIndexData();
const zbls = await buildZblsCaseIndexData();
const source = [
  "// Auto-generated by tools/generate-zbll-case-index.mjs",
  "// Do not edit by hand.",
  `export const ZBLL_CASE_COUNT = ${zbll.caseCount};`,
  `export const ZBLL_CANDIDATE_COUNT = ${zbll.candidateCount};`,
  `export const ZBLL_CASE_INDEX = ${JSON.stringify(zbll.index)};`,
  `export const ZBLS_CASE_COUNT = ${zbls.caseCount};`,
  `export const ZBLS_CANDIDATE_COUNT = ${zbls.candidateCount};`,
  `export const ZBLS_CASE_INDEX = ${JSON.stringify(zbls.index)};`,
  "",
].join("\\n");

if (checkOnly) {
  if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== source) {
    throw new Error("ZB_CASE_INDEX_OUT_OF_DATE");
  }
  console.log(
    `verified ${path.relative(root, outputPath)} ` +
    `zbllCases=${zbll.caseCount} zbllCandidates=${zbll.candidateCount} ` +
    `zblsCases=${zbls.caseCount} zblsCandidates=${zbls.candidateCount}`,
  );
} else {
  fs.writeFileSync(outputPath, source);
  const bytes = Buffer.byteLength(source);
  console.log(`generated ${path.relative(root, outputPath)}`);
  console.log(
    `zbllCases=${zbll.caseCount} zbllCandidates=${zbll.candidateCount} ` +
    `zblsCases=${zbls.caseCount} zblsCandidates=${zbls.candidateCount} bytes=${bytes}`,
  );
}
'''
GENERATOR.write_text(generator, encoding="utf-8")
print("Applied precompiled ZBLL/ZBLS move indexes")
