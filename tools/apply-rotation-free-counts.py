from pathlib import Path
import subprocess


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing target: {label}")
    return text.replace(old, new, 1)


# CFOP / Pure ZB: keep inspection rotations in the displayed algorithm, but
# exclude x/y/z tokens from HTM counts and stage depths.
cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()
cfop = replace_once(
    cfop,
    'const CROSS_COLOR_SEQUENCE = ["D", "U", "F", "B", "R", "L"];\n',
    '''const CROSS_COLOR_SEQUENCE = ["D", "U", "F", "B", "R", "L"];\nconst CUBE_ROTATION_RE = /^[xyz](?:2'?|')?$/i;\n\nfunction countMetricMoves(moves) {\n  const tokens = Array.isArray(moves) ? moves : splitMoves(moves);\n  let count = 0;\n  for (const token of tokens) {\n    if (!CUBE_ROTATION_RE.test(String(token || "").trim())) count += 1;\n  }\n  return count;\n}\n''',
    "CFOP metric helper",
)
cfop = cfop.replace("stages[0].moveCount = firstMoves.length;", "stages[0].moveCount = countMetricMoves(firstMoves);")
cfop = cfop.replace("stages[0].depth = firstMoves.length;", "stages[0].depth = countMetricMoves(firstMoves);")
cfop = cfop.replace("stages[lastIndex].moveCount = lastMoves.length;", "stages[lastIndex].moveCount = countMetricMoves(lastMoves);")
cfop = cfop.replace("stages[lastIndex].depth = lastMoves.length;", "stages[lastIndex].depth = countMetricMoves(lastMoves);")
if "moveCount: fullMoves.length," not in cfop:
    raise SystemExit("CFOP full move count target missing")
cfop = cfop.replace("moveCount: fullMoves.length,", "moveCount: countMetricMoves(fullMoves),")
cfop_path.write_text(cfop)

# Roux v1: _solveRouxFromPattern already reports the core Roux HTM count.
roux1_path = Path("solver/roux3x3.js")
roux1 = roux1_path.read_text()
roux1 = replace_once(
    roux1,
    "      moveCount: combined.length,\n      selectedCrossColor: colorKey,",
    "      moveCount: result.moveCount,\n      selectedCrossColor: colorKey,",
    "Roux v1 rotation-free total",
)
roux1_path.write_text(roux1)

# Roux v2: coreMoves excludes inspection setup/cleanup rotations by construction.
roux2_path = Path("solver/roux3x3v2.js")
roux2 = roux2_path.read_text()
roux2 = replace_once(
    roux2,
    "    moveCount: finalMoves.length,\n    coreMoveCount: coreMoves.length,",
    "    moveCount: coreMoves.length,\n    coreMoveCount: coreMoves.length,",
    "Roux v2 rotation-free total",
)
roux2_path.write_text(roux2)

Path("benchmark-rotation-count-contract.mjs").write_text(r'''import assert from "node:assert/strict";
import { cube3x3x3 } from "./vendor/cubing/puzzles/index.js";
import {
  prewarm3x3StrictCfopLibraries,
  solve3x3StrictCfopFromPattern,
} from "./solver/cfop3x3.js";
import { solve3x3RouxFromPattern } from "./solver/roux3x3.js";
import { prewarm3x3RouxV2, solve3x3RouxV2FromPattern } from "./solver/roux3x3v2.js";

const ROTATION_RE = /^[xyz](?:2'?|')?$/i;
const scrambles = {
  cfop: "F2 D2 B2 F2 L2 D2 B2 U R2 U' L2 B U' F2 U' R' B2 D2 R' D",
  zb: "B2 D2 L2 U' B2 D2 F2 U' F2 L2 U' R B' D2 B' R' B2 D2 R2 F",
  roux: "D2 B2 R2 U' R2 U B2 D2 L2 F2 U2 F' D' B L' U B' L' U' R'",
};

function tokens(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}
function metricCount(sequence) {
  return tokens(sequence).filter((token) => !ROTATION_RE.test(token)).length;
}
function assertRotationCount(pattern, result, label, verifyStageSum = false) {
  assert.equal(result?.ok, true, `${label}: ${result?.reason || "failed"}`);
  assert.notEqual(result.selectedCrossColor, "D", `${label}: test did not select a rotated orientation`);
  const allTokens = tokens(result.solution);
  assert.ok(allTokens.some((token) => ROTATION_RE.test(token)), `${label}: missing x/y/z inspection rotation`);
  assert.equal(result.moveCount, metricCount(result.solution), `${label}: x/y/z affected moveCount`);
  assert.ok(result.moveCount < allTokens.length, `${label}: rotation was not excluded`);
  const after = result.solution ? pattern.applyAlg(result.solution) : pattern;
  assert.equal(after.isIdentical(solved), true, `${label}: invalid solution`);
  if (verifyStageSum) {
    const stageSum = (result.stages || []).reduce((sum, stage) => sum + Number(stage.moveCount || 0), 0);
    assert.equal(stageSum, result.moveCount, `${label}: stage counts include rotations`);
  }
}

const kpuzzle = await cube3x3x3.kpuzzle();
const solved = kpuzzle.defaultPattern();
await prewarm3x3StrictCfopLibraries({ includeF2L: false, includeSingleStage: true });
await prewarm3x3RouxV2();

const cfopPattern = solved.applyAlg(scrambles.cfop);
const cfop = await solve3x3StrictCfopFromPattern(cfopPattern, {
  crossColor: "CN",
  mode: "strict",
  solverVersion: "v2",
  scramble: scrambles.cfop,
  deadlineTs: Date.now() + 15000,
  enableStyleFallback: false,
  allowRelaxedSearch: false,
});
assertRotationCount(cfopPattern, cfop, "CFOP", true);

const zbPattern = solved.applyAlg(scrambles.zb);
const zb = await solve3x3StrictCfopFromPattern(zbPattern, {
  crossColor: "CN",
  mode: "zb",
  solverVersion: "v2",
  scramble: scrambles.zb,
  deadlineTs: Date.now() + 20000,
  enableStyleFallback: false,
  allowRelaxedSearch: false,
});
assertRotationCount(zbPattern, zb, "Pure ZB", true);

const rouxPattern = solved.applyAlg(scrambles.roux);
const rouxV1 = await solve3x3RouxFromPattern(rouxPattern, {
  crossColor: "CN",
  enableRecovery: false,
  deadlineTs: Date.now() + 45000,
});
assertRotationCount(rouxPattern, rouxV1, "Roux v1", true);

const rouxV2 = await solve3x3RouxV2FromPattern(rouxPattern, { crossColor: "CN" });
assertRotationCount(rouxPattern, rouxV2, "Roux v2", true);
assert.equal(rouxV2.moveCount, rouxV2.coreMoveCount);

console.log(JSON.stringify({
  cfop: { color: cfop.selectedCrossColor, moveCount: cfop.moveCount, tokens: tokens(cfop.solution).length },
  zb: { color: zb.selectedCrossColor, moveCount: zb.moveCount, tokens: tokens(zb.solution).length },
  rouxV1: { color: rouxV1.selectedCrossColor, moveCount: rouxV1.moveCount, tokens: tokens(rouxV1.solution).length },
  rouxV2: { color: rouxV2.selectedCrossColor, moveCount: rouxV2.moveCount, tokens: tokens(rouxV2.solution).length },
}));
''')

# Restore the permanent full workflow from main and add this contract to it.
workflow_path = Path(".github/workflows/cfop-speedup-benchmark.yml")
workflow = subprocess.check_output(
    ["git", "show", "origin/main:.github/workflows/cfop-speedup-benchmark.yml"],
    text=True,
)
workflow = replace_once(
    workflow,
    "          node --check benchmark-color-neutral-contract.mjs\n",
    "          node --check benchmark-color-neutral-contract.mjs\n          node --check benchmark-rotation-count-contract.mjs\n",
    "workflow syntax hook",
)
workflow = replace_once(
    workflow,
    "      - name: Compare solver v1 and v2\n",
    "      - name: Verify cube rotations are count-free\n        run: node benchmark-rotation-count-contract.mjs\n\n      - name: Compare solver v1 and v2\n",
    "workflow runtime hook",
)
workflow_path.write_text(workflow)

Path("tools/apply-rotation-free-counts.py").unlink()
