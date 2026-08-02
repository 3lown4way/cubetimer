from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing replacement target: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# CFOP / Pure ZB: the old CN probe stopped after the first <=6 move cross.
# Since D/yellow is first, that made color-neutral effectively yellow-first.
# Probe all six colors and expose the complete probe diagnostics.
# ---------------------------------------------------------------------------
cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()
cfop = replace_once(
    cfop,
    "const CN_CROSS_PROBE_BUDGET_MS = 40;",
    "const CN_CROSS_PROBE_BUDGET_MS = 80;",
    "CFOP per-color CN budget",
)
cfop = replace_once(
    cfop,
    "const CN_PROBE_TOTAL_BUDGET_MS = 300;",
    "const CN_PROBE_TOTAL_BUDGET_MS = 700;",
    "CFOP total CN budget",
)
cfop = replace_once(
    cfop,
    "    let bestProbe = null;\n",
    "    let bestProbe = null;\n    const colorNeutralCandidates = [];\n",
    "CFOP CN diagnostics declaration",
)
cfop = replace_once(
    cfop,
    '''      if (bestColorProbe && (!bestProbe || compareCrossProbeResults(bestColorProbe, bestProbe) < 0)) {\n        bestProbe = bestColorProbe;\n      }\n      // Early exit: a short cross (≤6 moves) is good enough — no need to probe remaining colors.\n      if (bestProbe && bestProbe.ok && bestProbe.moveCount <= 6) break;\n''',
    '''      const colorDiagnostic = bestColorProbe || {\n        color: candidateColor,\n        ok: false,\n        stageRank: 0,\n        moveCount: Number.MAX_SAFE_INTEGER,\n        bound: Number.MAX_SAFE_INTEGER,\n        nodes: Number.MAX_SAFE_INTEGER,\n        compositeScore: Number.MAX_SAFE_INTEGER,\n      };\n      colorNeutralCandidates.push({ ...colorDiagnostic });\n      if (bestColorProbe && (!bestProbe || compareCrossProbeResults(bestColorProbe, bestProbe) < 0)) {\n        bestProbe = bestColorProbe;\n      }\n''',
    "CFOP remove yellow-first early exit",
)
cfop = replace_once(
    cfop,
    '''        selectedCrossColor:\n          typeof colorNeutralResult.selectedCrossColor === "string"\n            ? colorNeutralResult.selectedCrossColor\n            : selectedCrossColor,\n''',
    '''        selectedCrossColor:\n          typeof colorNeutralResult.selectedCrossColor === "string"\n            ? colorNeutralResult.selectedCrossColor\n            : selectedCrossColor,\n        colorNeutralCandidates,\n''',
    "CFOP CN result diagnostics",
)
cfop_path.write_text(cfop)


# ---------------------------------------------------------------------------
# Roux v1: choose the orientation by comparing exact/compact FB probes for all
# six faces, then run the normal Roux pipeline once on the selected face.
# ---------------------------------------------------------------------------
roux1_path = Path("solver/roux3x3.js")
roux1 = roux1_path.read_text()
roux1 = replace_once(
    roux1,
    '''const ROTATION_INVERSE = {\n  "x": "x'", "x'": "x", "x2": "x2",\n  "z": "z'", "z'": "z", "z2": "z2",\n  "y": "y'", "y'": "y", "y2": "y2",\n};\n''',
    '''const ROTATION_INVERSE = {\n  "x": "x'", "x'": "x", "x2": "x2",\n  "z": "z'", "z'": "z", "z2": "z2",\n  "y": "y'", "y'": "y", "y2": "y2",\n};\nconst ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\n\nfunction isRouxColorNeutral(value) {\n  const normalized = String(value || "D").toUpperCase();\n  return normalized === "CN" || normalized === "COLOR_NEUTRAL"\n    || normalized === "COLOR-NEUTRAL" || normalized === "AUTO";\n}\n\nfunction compareRouxFbColorProbe(a, b) {\n  if (a.ok !== b.ok) return a.ok ? -1 : 1;\n  if (a.fbMoveCount !== b.fbMoveCount) return a.fbMoveCount - b.fbMoveCount;\n  if (a.nodes !== b.nodes) return a.nodes - b.nodes;\n  return ROUX_COLOR_SEQUENCE.indexOf(a.color) - ROUX_COLOR_SEQUENCE.indexOf(b.color);\n}\n''',
    "Roux v1 CN helpers",
)
old_wrapper = '''export async function solve3x3RouxFromPattern(pattern, options = {}) {\n  const { getDefaultPattern } = await import('./context.js');\n  await ensurePruneTables(getDefaultPattern);\n  const solvedPattern = await getDefaultPattern("333");\n\n  // Apply a rotation (via conjugation) so the selected cross color face is treated as D.\n  const rawCrossColor = String(options.crossColor || "D").toUpperCase();\n  const colorKey =\n    rawCrossColor === "CN" || rawCrossColor === "COLOR_NEUTRAL" ? "D" : rawCrossColor;\n  const preRotation = ROUX_FACE_ROTATION[colorKey] ?? "";\n\n  const workingPattern = preRotation\n    ? transformPatternForRouxFace(pattern, solvedPattern, preRotation)\n    : pattern;\n\n  if (!workingPattern) {\n    return { ok: false, reason: "CROSS_COLOR_TRANSFORM_FAILED", source: "INTERNAL_3X3_ROUX" };\n  }\n\n  const result = await _solveRouxFromPattern(workingPattern, options, solvedPattern);\n\n  if (result?.ok && preRotation) {\n    const invRotation = ROTATION_INVERSE[preRotation] || "";\n    const rotMoves = preRotation.split(" ").filter(Boolean);\n    const solMoves = result.solution ? result.solution.split(/\\s+/).filter(Boolean) : [];\n    const invMoves = invRotation ? invRotation.split(" ").filter(Boolean) : [];\n    const combined = simplifyMoves([...rotMoves, ...solMoves, ...invMoves]);\n    return {\n      ...result,\n      solution: combined.join(" "),\n      moveCount: combined.length,\n    };\n  }\n  return result;\n}\n'''
new_wrapper = '''export async function solve3x3RouxFromPattern(pattern, options = {}) {\n  const { getDefaultPattern } = await import('./context.js');\n  await ensurePruneTables(getDefaultPattern);\n  const solvedPattern = await getDefaultPattern("333");\n\n  const rawCrossColor = String(options.crossColor || "D").toUpperCase();\n  if (isRouxColorNeutral(rawCrossColor) && !options.__colorNeutralApplied) {\n    const colorNeutralCandidates = [];\n    let bestProbe = null;\n    for (const color of ROUX_COLOR_SEQUENCE) {\n      const rotation = ROUX_FACE_ROTATION[color] || "";\n      const transformed = rotation\n        ? transformPatternForRouxFace(pattern, solvedPattern, rotation)\n        : pattern;\n      let probe = null;\n      if (transformed) probe = fbIDASearch(transformed, pruneTables);\n      const diagnostic = {\n        color,\n        ok: probe?.ok === true,\n        fbMoveCount: probe?.ok && Array.isArray(probe.moves)\n          ? probe.moves.length\n          : Number.MAX_SAFE_INTEGER,\n        nodes: Number.isFinite(probe?.nodes) ? probe.nodes : Number.MAX_SAFE_INTEGER,\n      };\n      colorNeutralCandidates.push(diagnostic);\n      if (!bestProbe || compareRouxFbColorProbe(diagnostic, bestProbe) < 0) bestProbe = diagnostic;\n    }\n    const selectedCrossColor = bestProbe?.ok ? bestProbe.color : "D";\n    const selectedResult = await solve3x3RouxFromPattern(pattern, {\n      ...options,\n      crossColor: selectedCrossColor,\n      __colorNeutralApplied: true,\n    });\n    return selectedResult && typeof selectedResult === "object"\n      ? { ...selectedResult, selectedCrossColor, colorNeutralCandidates }\n      : selectedResult;\n  }\n\n  const colorKey = Object.prototype.hasOwnProperty.call(ROUX_FACE_ROTATION, rawCrossColor)\n    ? rawCrossColor\n    : "D";\n  const preRotation = ROUX_FACE_ROTATION[colorKey] ?? "";\n  const workingPattern = preRotation\n    ? transformPatternForRouxFace(pattern, solvedPattern, preRotation)\n    : pattern;\n\n  if (!workingPattern) {\n    return { ok: false, reason: "CROSS_COLOR_TRANSFORM_FAILED", source: "INTERNAL_3X3_ROUX", selectedCrossColor: colorKey };\n  }\n\n  const result = await _solveRouxFromPattern(workingPattern, options, solvedPattern);\n  if (result?.ok && preRotation) {\n    const invRotation = ROTATION_INVERSE[preRotation] || "";\n    const rotMoves = preRotation.split(" ").filter(Boolean);\n    const solMoves = result.solution ? result.solution.split(/\\s+/).filter(Boolean) : [];\n    const invMoves = invRotation ? invRotation.split(" ").filter(Boolean) : [];\n    const combined = simplifyMoves([...rotMoves, ...solMoves, ...invMoves]);\n    return {\n      ...result,\n      solution: combined.join(" "),\n      moveCount: combined.length,\n      selectedCrossColor: colorKey,\n    };\n  }\n  return result && typeof result === "object"\n    ? { ...result, selectedCrossColor: colorKey }\n    : result;\n}\n'''
roux1 = replace_once(roux1, old_wrapper, new_wrapper, "Roux v1 wrapper")
roux1_path.write_text(roux1)


# ---------------------------------------------------------------------------
# Roux v2: exact stages are cheap after table initialization, so evaluate the
# complete Roux solution for all six orientations and select the shortest core
# Roux solution (cube rotations are not used to bias the orientation ranking).
# ---------------------------------------------------------------------------
roux2_path = Path("solver/roux3x3v2.js")
roux2 = roux2_path.read_text()
roux2 = replace_once(
    roux2,
    '''const ROTATION_INVERSE = Object.freeze({\n  x: "x'",\n  "x'": "x",\n  x2: "x2",\n  z: "z'",\n  "z'": "z",\n  z2: "z2",\n  y: "y'",\n  "y'": "y",\n  y2: "y2",\n});\n''',
    '''const ROTATION_INVERSE = Object.freeze({\n  x: "x'",\n  "x'": "x",\n  x2: "x2",\n  z: "z'",\n  "z'": "z",\n  z2: "z2",\n  y: "y'",\n  "y'": "y",\n  y2: "y2",\n});\nconst ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\n\nfunction isRouxColorNeutral(value) {\n  const normalized = String(value || "D").toUpperCase();\n  return normalized === "CN" || normalized === "COLOR_NEUTRAL"\n    || normalized === "COLOR-NEUTRAL" || normalized === "AUTO";\n}\n\nfunction compareRouxColorResults(a, b) {\n  if (a.ok !== b.ok) return a.ok ? -1 : 1;\n  if (a.coreMoveCount !== b.coreMoveCount) return a.coreMoveCount - b.coreMoveCount;\n  if (a.moveCount !== b.moveCount) return a.moveCount - b.moveCount;\n  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;\n  return ROUX_COLOR_SEQUENCE.indexOf(a.color) - ROUX_COLOR_SEQUENCE.indexOf(b.color);\n}\n''',
    "Roux v2 CN helpers",
)
roux2 = replace_once(
    roux2,
    '''  const rawCrossColor = String(options.crossColor || "D").toUpperCase();\n  const colorKey = rawCrossColor === "CN" || rawCrossColor === "COLOR_NEUTRAL"\n    ? "D"\n    : rawCrossColor;\n  const preRotation = ROUX_FACE_ROTATION[colorKey] ?? "";\n''',
    '''  const rawCrossColor = String(options.crossColor || "D").toUpperCase();\n  if (isRouxColorNeutral(rawCrossColor) && !options.__colorNeutralApplied) {\n    const colorNeutralCandidates = [];\n    let bestResult = null;\n    let bestDiagnostic = null;\n    for (const color of ROUX_COLOR_SEQUENCE) {\n      const candidateResult = await solve3x3RouxV2FromPattern(pattern, {\n        ...options,\n        crossColor: color,\n        __colorNeutralApplied: true,\n      });\n      const diagnostic = {\n        color,\n        ok: candidateResult?.ok === true,\n        coreMoveCount: Number.isFinite(candidateResult?.coreMoveCount)\n          ? candidateResult.coreMoveCount\n          : Number.MAX_SAFE_INTEGER,\n        moveCount: Number.isFinite(candidateResult?.moveCount)\n          ? candidateResult.moveCount\n          : Number.MAX_SAFE_INTEGER,\n        elapsedMs: Number.isFinite(candidateResult?.elapsedMs)\n          ? candidateResult.elapsedMs\n          : Number.MAX_SAFE_INTEGER,\n        reason: String(candidateResult?.reason || ""),\n      };\n      colorNeutralCandidates.push(diagnostic);\n      if (!bestDiagnostic || compareRouxColorResults(diagnostic, bestDiagnostic) < 0) {\n        bestDiagnostic = diagnostic;\n        bestResult = candidateResult;\n      }\n    }\n    if (bestResult?.ok && bestDiagnostic?.ok) {\n      return {\n        ...bestResult,\n        selectedCrossColor: bestDiagnostic.color,\n        colorNeutralCandidates,\n        colorNeutralSelectionMetric: "coreMoveCount",\n      };\n    }\n    return {\n      ok: false,\n      reason: "ROUX_COLOR_NEUTRAL_NO_SOLUTION",\n      source: "INTERNAL_3X3_ROUX_V2",\n      solverVersion: "v2",\n      selectedCrossColor: bestDiagnostic?.color || null,\n      colorNeutralCandidates,\n    };\n  }\n  const colorKey = Object.prototype.hasOwnProperty.call(ROUX_FACE_ROTATION, rawCrossColor)\n    ? rawCrossColor\n    : "D";\n  const preRotation = ROUX_FACE_ROTATION[colorKey] ?? "";\n''',
    "Roux v2 six-color selection",
)
roux2 = replace_once(
    roux2,
    '''  const inverseRotation = preRotation ? ROTATION_INVERSE[preRotation] || "" : "";\n  const unsimplifiedMoves = [\n''',
    '''  const coreMoves = simplifyMoves(allMoves);\n  const inverseRotation = preRotation ? ROTATION_INVERSE[preRotation] || "" : "";\n  const unsimplifiedMoves = [\n''',
    "Roux v2 core move count",
)
roux2 = replace_once(
    roux2,
    '''    moveCount: finalMoves.length,\n    stages,\n    source: "INTERNAL_3X3_ROUX_V2",\n''',
    '''    moveCount: finalMoves.length,\n    coreMoveCount: coreMoves.length,\n    selectedCrossColor: colorKey,\n    stages,\n    source: "INTERNAL_3X3_ROUX_V2",\n''',
    "Roux v2 selected color metadata",
)
roux2_path.write_text(roux2)


# ---------------------------------------------------------------------------
# Runtime contract: all three methods must inspect six colors, return a valid
# selected color, and the corpus must demonstrate non-yellow choices.
# ---------------------------------------------------------------------------
Path("benchmark-color-neutral-contract.mjs").write_text(r'''import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "./solver/cfop3x3.js";
import { solve3x3RouxFromPattern } from "./solver/roux3x3.js";
import { prewarm3x3RouxV2, solve3x3RouxV2FromPattern } from "./solver/roux3x3v2.js";

const COLORS = ["D", "U", "F", "B", "R", "L"];
const scrambles = [
  "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
  "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  "U2 R2 D' L2 B2 D' R2 F2 U B2 L' D B' R' D2 U L F2 U",
];

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries({ includeF2L: false, includeSingleStage: true });
await prewarm3x3RouxV2();

function assertSixColors(result, label) {
  assert.ok(Array.isArray(result?.colorNeutralCandidates), `${label}: missing CN diagnostics`);
  assert.deepEqual(
    result.colorNeutralCandidates.map((entry) => entry.color),
    COLORS,
    `${label}: did not evaluate all six colors`,
  );
  assert.ok(COLORS.includes(result.selectedCrossColor), `${label}: invalid selected color`);
}

function assertSolved(pattern, result, label) {
  assert.equal(result?.ok, true, `${label}: ${result?.reason || "failed"}`);
  const after = result.solution ? pattern.applyAlg(result.solution) : pattern;
  assert.equal(after.isIdentical(solved), true, `${label}: returned solution is invalid`);
}

const selected = { cfop: [], zb: [], rouxV2: [] };
for (let index = 0; index < scrambles.length; index += 1) {
  const pattern = solved.applyAlg(scrambles[index]);

  const cfop = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: "CN",
    mode: "strict",
    solverVersion: "v2",
    scramble: scrambles[index],
    deadlineTs: Date.now() + 15000,
    enableStyleFallback: false,
    allowRelaxedSearch: false,
  });
  assertSolved(pattern, cfop, `CFOP #${index + 1}`);
  assertSixColors(cfop, `CFOP #${index + 1}`);
  selected.cfop.push(cfop.selectedCrossColor);

  const zb = await solve3x3StrictCfopFromPattern(pattern, {
    crossColor: "CN",
    mode: "zb",
    solverVersion: "v2",
    scramble: scrambles[index],
    deadlineTs: Date.now() + 20000,
    enableStyleFallback: false,
    allowRelaxedSearch: false,
  });
  if (zb?.ok) {
    assertSolved(pattern, zb, `ZB #${index + 1}`);
    assertSixColors(zb, `ZB #${index + 1}`);
    selected.zb.push(zb.selectedCrossColor);
  }

  const rouxV2 = await solve3x3RouxV2FromPattern(pattern, { crossColor: "CN" });
  assertSolved(pattern, rouxV2, `Roux v2 #${index + 1}`);
  assertSixColors(rouxV2, `Roux v2 #${index + 1}`);
  selected.rouxV2.push(rouxV2.selectedCrossColor);
}

assert.ok(selected.cfop.some((color) => color !== "D"), `CFOP remained yellow-only: ${selected.cfop}`);
assert.ok(selected.zb.length >= 1, "Pure ZB produced no valid contract result");
assert.ok(selected.zb.some((color) => color !== "D"), `Pure ZB remained yellow-only: ${selected.zb}`);
assert.ok(selected.rouxV2.some((color) => color !== "D"), `Roux v2 remained yellow-only: ${selected.rouxV2}`);

const v1Pattern = solved.applyAlg(scrambles[0]);
const rouxV1 = await solve3x3RouxFromPattern(v1Pattern, {
  crossColor: "CN",
  enableRecovery: false,
  deadlineTs: Date.now() + 45000,
});
assertSolved(v1Pattern, rouxV1, "Roux v1");
assertSixColors(rouxV1, "Roux v1");
const bestFb = [...rouxV1.colorNeutralCandidates].sort((a, b) => {
  if (a.ok !== b.ok) return a.ok ? -1 : 1;
  if (a.fbMoveCount !== b.fbMoveCount) return a.fbMoveCount - b.fbMoveCount;
  if (a.nodes !== b.nodes) return a.nodes - b.nodes;
  return COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
})[0];
assert.equal(rouxV1.selectedCrossColor, bestFb.ok ? bestFb.color : "D");

console.log(JSON.stringify({ selected, rouxV1: rouxV1.selectedCrossColor }));
''')

Path("tools/apply-color-neutral-fix.py").unlink()
