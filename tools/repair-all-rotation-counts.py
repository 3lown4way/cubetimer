from pathlib import Path


def replace_all_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing target: {label}")
    return text.replace(old, new)


cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()
for old, new, label in [
    ("moveCount: segmentMoves.length,", "moveCount: countMetricMoves(segmentMoves),", "CFOP pair moveCount"),
    ("depth: segmentMoves.length,", "depth: countMetricMoves(segmentMoves),", "CFOP pair depth"),
    ("moveCount: outputMoves.length,", "moveCount: countMetricMoves(outputMoves),", "CFOP stage moveCount"),
    ("depth: outputMoves.length,", "depth: countMetricMoves(outputMoves),", "CFOP stage depth"),
]:
    cfop = replace_all_required(cfop, old, new, label)
cfop_path.write_text(cfop)

roux1_path = Path("solver/roux3x3.js")
roux1 = roux1_path.read_text()
anchor1 = '''const ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\n'''
helper1 = '''const ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\nconst CUBE_ROTATION_RE = /^[xyz](?:2'?|')?$/i;\n\nfunction countMetricMoves(moves) {\n  return (Array.isArray(moves) ? moves : String(moves || "").trim().split(/\\s+/).filter(Boolean))\n    .filter((token) => !CUBE_ROTATION_RE.test(String(token || "").trim()))\n    .length;\n}\n'''
if anchor1 not in roux1:
    raise SystemExit("Roux v1 helper anchor missing")
roux1 = roux1.replace(anchor1, helper1, 1)
roux1 = replace_all_required(roux1, "moveCount: finalMoves.length,", "moveCount: countMetricMoves(finalMoves),", "Roux v1 core total")
roux1_path.write_text(roux1)

roux2_path = Path("solver/roux3x3v2.js")
roux2 = roux2_path.read_text()
anchor2 = '''const ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\n'''
helper2 = '''const ROUX_COLOR_SEQUENCE = Object.freeze(["D", "U", "F", "B", "R", "L"]);\nconst CUBE_ROTATION_RE = /^[xyz](?:2'?|')?$/i;\n\nfunction countMetricMoves(moves) {\n  return (Array.isArray(moves) ? moves : String(moves || "").trim().split(/\\s+/).filter(Boolean))\n    .filter((token) => !CUBE_ROTATION_RE.test(String(token || "").trim()))\n    .length;\n}\n'''
if anchor2 not in roux2:
    raise SystemExit("Roux v2 helper anchor missing")
roux2 = roux2.replace(anchor2, helper2, 1)
roux2 = replace_all_required(roux2, "moveCount: moves.length,", "moveCount: countMetricMoves(moves),", "Roux v2 stage count")
roux2 = roux2.replace(
    "  const coreMoves = simplifyMoves(allMoves);\n",
    "  const coreMoves = simplifyMoves(allMoves);\n  const coreMoveCount = countMetricMoves(coreMoves);\n",
    1,
)
roux2 = replace_all_required(roux2, "moveCount: coreMoves.length,", "moveCount: coreMoveCount,", "Roux v2 total")
roux2 = replace_all_required(roux2, "coreMoveCount: coreMoves.length,", "coreMoveCount,", "Roux v2 core count")
roux2_path.write_text(roux2)

Path("tools/repair-all-rotation-counts.py").unlink()
