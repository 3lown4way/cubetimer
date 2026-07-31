from pathlib import Path
import re


def replace_exact(text, old, new, label, count=1):
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{label}: expected {count}, found {actual}")
    return text.replace(old, new)


rust_path = Path("solver-wasm/src/fmc_search.rs")
rust = rust_path.read_text()

rust = replace_exact(
    rust,
    """struct AxisSkeletonPrefix {\n    moves: Vec<u8>,\n    eo_len: u8,\n    dr_len: u8,\n    p2_len: u8,\n}\n""",
    """struct AxisSkeletonPrefix {\n    moves: Vec<u8>,\n    eo_len: u8,\n    dr_len: u8,\n    p2_len: u8,\n    eo_moves: Vec<u8>,\n    dr_moves: Vec<u8>,\n    finish_moves: Vec<u8>,\n}\n""",
    "AxisSkeletonPrefix fields",
)

rust = replace_exact(
    rust,
    """                    eo_len: eo_moves.len() as u8,\n                    dr_len: dr_moves.len() as u8,\n                    p2_len: p2_len as u8,\n""",
    """                    eo_len: eo_moves.len() as u8,\n                    dr_len: dr_moves.len() as u8,\n                    p2_len: p2_len as u8,\n                    eo_moves: eo_moves.to_vec(),\n                    dr_moves: dr_moves.to_vec(),\n                    finish_moves: p2_moves[..p2_len].to_vec(),\n""",
    "AxisSkeletonPrefix population",
)

rust = replace_exact(
    rust,
    """    pub p2_len: u8,\n    pub axis: u8,\n    pub source_tag: u8,\n""",
    """    pub p2_len: u8,\n    pub eo_moves: Vec<u8>,\n    pub dr_moves: Vec<u8>,\n    pub finish_moves: Vec<u8>,\n    pub axis: u8,\n    pub source_tag: u8,\n""",
    "FmcSkeletonCandidate segment fields",
)

rust = replace_exact(
    rust,
    """    prefix: &AxisSkeletonPrefix,\n    axis: u8,\n""",
    """    prefix: &AxisSkeletonPrefix,\n    eo_moves: Vec<u8>,\n    dr_moves: Vec<u8>,\n    finish_moves: Vec<u8>,\n    axis: u8,\n""",
    "build_skeleton_candidate signature",
)

rust = replace_exact(
    rust,
    """        p2_len: prefix.p2_len,\n        axis,\n""",
    """        p2_len: prefix.p2_len,\n        eo_moves,\n        dr_moves,\n        finish_moves,\n        axis,\n""",
    "build_skeleton_candidate metadata",
)

call_pattern = re.compile(r"(&prefix,\n)(?P<indent>\s+)(axis,\n)")

def expand_call(match):
    indent = match.group("indent")
    return (
        match.group(1)
        + indent + "cvt(&prefix.eo_moves),\n"
        + indent + "cvt(&prefix.dr_moves),\n"
        + indent + "cvt(&prefix.finish_moves),\n"
        + indent + match.group(3)
    )

rust, call_count = call_pattern.subn(expand_call, rust)
if call_count != 4:
    raise SystemExit(f"build_skeleton_candidate calls: expected 4, found {call_count}")

# Preserve phase segments in synthetic skeletons derived from a full candidate.
pattern = re.compile(r"(p2_len: candidate\.p2_len,\n)(?P<indent>\s+)(axis: candidate\.axis,)")

def candidate_segments(match):
    indent = match.group("indent")
    return (
        match.group(1)
        + indent + "eo_moves: candidate.eo_moves.clone(),\n"
        + indent + "dr_moves: candidate.dr_moves.clone(),\n"
        + indent + "finish_moves: candidate.finish_moves.clone(),\n"
        + indent + match.group(3)
    )

rust, candidate_segment_count = pattern.subn(candidate_segments, rust)
if candidate_segment_count < 3:
    raise SystemExit(f"candidate skeleton metadata: expected >=3, found {candidate_segment_count}")

pattern = re.compile(r"(p2_len: skeleton\.p2_len,\n)(?P<indent>\s+)(axis: skeleton\.axis,)")

def skeleton_segments(match):
    indent = match.group("indent")
    return (
        match.group(1)
        + indent + "eo_moves: skeleton.eo_moves.clone(),\n"
        + indent + "dr_moves: skeleton.dr_moves.clone(),\n"
        + indent + "finish_moves: skeleton.finish_moves.clone(),\n"
        + indent + match.group(3)
    )

rust, residual_count = pattern.subn(skeleton_segments, rust)
if residual_count < 1:
    raise SystemExit("residual skeleton metadata not patched")

# Retain the pre-insertion skeleton on completed candidates.
rust = replace_exact(
    rust,
    """    /// Whether this candidate used RZP for DR (vs direct solve)\n    pub rzp_used: bool,\n    /// Exact algorithm inserted into a 3-cycle skeleton, when applicable.\n""",
    """    /// Whether this candidate used RZP for DR (vs direct solve)\n    pub rzp_used: bool,\n    /// Skeleton before insertion and cancellation, when applicable.\n    pub skeleton_moves: Vec<u8>,\n    /// Exact algorithm inserted into a 3-cycle skeleton, when applicable.\n""",
    "FmcCandidate skeleton field",
)

constructor_pattern = re.compile(r"(?P<prefix>\s+rzp_used: [^,\n]+,\n)(?P<indent>\s+)insertion_moves:")

def add_empty_skeleton(match):
    return match.group("prefix") + match.group("indent") + "skeleton_moves: vec![],\n" + match.group("indent") + "insertion_moves:"

rust, constructor_count = constructor_pattern.subn(add_empty_skeleton, rust)
if constructor_count < 8:
    raise SystemExit(f"FmcCandidate constructors: expected >=8, found {constructor_count}")

rust = rust.replace(
    "rzp_used: skeleton.rzp_used,\n        skeleton_moves: vec![],",
    "rzp_used: skeleton.rzp_used,\n        skeleton_moves: skeleton.moves.clone(),",
)
if rust.count("skeleton_moves: skeleton.moves.clone(),") != 2:
    raise SystemExit("completed insertion skeleton copy count mismatch")

segment_old = """        eo_moves: vec![],\n        dr_moves: vec![],\n        finish_moves,\n"""
segment_new = """        eo_moves: skeleton.eo_moves.clone(),\n        dr_moves: skeleton.dr_moves.clone(),\n        finish_moves: skeleton.finish_moves.clone(),\n"""
if rust.count(segment_old) != 2:
    raise SystemExit(f"insertion segment reset count mismatch: {rust.count(segment_old)}")
rust = rust.replace(segment_old, segment_new)

# The flattened insertion steps were previously mislabelled as the phase-2 finish.
rust, removed_finish_blocks = re.subn(
    r"\n    let finish_moves = insertion_steps\n        \.iter\(\)\n        \.flat_map\(\|step\| step\.moves\.iter\(\)\.copied\(\)\)\n        \.collect\(\);\n",
    "\n",
    rust,
)
if removed_finish_blocks != 2:
    raise SystemExit(f"unused insertion finish blocks: expected 2, found {removed_finish_blocks}")

json_anchor = """    let finish_moves_str: Vec<&str> = candidate\n        .finish_moves\n        .iter()\n        .map(|&m| tables.move_data.move_names[m as usize].as_str())\n        .collect();\n\n    let mut value = serde_json::json!({\n"""
json_replacement = """    let finish_moves_str: Vec<&str> = candidate\n        .finish_moves\n        .iter()\n        .map(|&m| tables.move_data.move_names[m as usize].as_str())\n        .collect();\n    let skeleton_solution = if candidate.skeleton_moves.is_empty() {\n        String::new()\n    } else {\n        solution_string_from_path(&candidate.skeleton_moves, &tables.move_data)\n    };\n    let raw_insertion_move_count = candidate.skeleton_moves.len()\n        + candidate\n            .insertion_steps\n            .iter()\n            .map(|step| step.moves.len())\n            .sum::<usize>();\n    let cancellation_count = raw_insertion_move_count.saturating_sub(candidate.moves.len());\n\n    let mut value = serde_json::json!({\n"""
rust = replace_exact(rust, json_anchor, json_replacement, "candidate JSON precompute")

insert_anchor = """        let object = value.as_object_mut().unwrap();\n        object.insert(\"baseSource\".into(), serde_json::json!(base_source));\n"""
insert_replacement = """        let object = value.as_object_mut().unwrap();\n        object.insert(\"baseSource\".into(), serde_json::json!(base_source));\n        object.insert(\"skeletonSolution\".into(), serde_json::json!(skeleton_solution));\n        object.insert(\n            \"skeletonMoveCount\".into(),\n            serde_json::json!(candidate.skeleton_moves.len()),\n        );\n        object.insert(\n            \"rawInsertionMoveCount\".into(),\n            serde_json::json!(raw_insertion_move_count),\n        );\n        object.insert(\"cancellationCount\".into(), serde_json::json!(cancellation_count));\n"""
rust = replace_exact(rust, insert_anchor, insert_replacement, "candidate insertion JSON")

# Include phase segments on skeleton diagnostics as well.
skeleton_json_anchor = """    let estimated_insertion_cost = skeleton.kind.estimated_insertion_cost();\n\n    serde_json::json!({\n"""
skeleton_json_replacement = """    let estimated_insertion_cost = skeleton.kind.estimated_insertion_cost();\n    let eo_moves: Vec<&str> = skeleton\n        .eo_moves\n        .iter()\n        .map(|&m| tables.move_data.move_names[m as usize].as_str())\n        .collect();\n    let dr_moves: Vec<&str> = skeleton\n        .dr_moves\n        .iter()\n        .map(|&m| tables.move_data.move_names[m as usize].as_str())\n        .collect();\n    let finish_moves: Vec<&str> = skeleton\n        .finish_moves\n        .iter()\n        .map(|&m| tables.move_data.move_names[m as usize].as_str())\n        .collect();\n\n    serde_json::json!({\n"""
rust = replace_exact(rust, skeleton_json_anchor, skeleton_json_replacement, "skeleton JSON segment precompute")
rust = replace_exact(
    rust,
    """        \"p2PrefixLength\": skeleton.p2_len,\n        \"axisName\": AXIS_NAMES[skeleton.axis as usize],\n""",
    """        \"p2PrefixLength\": skeleton.p2_len,\n        \"eoMoves\": eo_moves,\n        \"drMoves\": dr_moves,\n        \"finishMoves\": finish_moves,\n        \"axisName\": AXIS_NAMES[skeleton.axis as usize],\n""",
    "skeleton JSON segment fields",
)

rust_path.write_text(rust)

js_path = Path("solver/fmcSolver.js")
js = js_path.read_text()

js = replace_exact(
    js,
    """    skeletonMoves: Array.isArray(metadata.skeletonMoves) ? metadata.skeletonMoves : null,\n    insertionBaseMoves: Array.isArray(metadata.insertionBaseMoves) ? metadata.insertionBaseMoves : null,\n    moves: normalized,\n""",
    """    skeletonMoves: Array.isArray(metadata.skeletonMoves) ? metadata.skeletonMoves : null,\n    insertionBaseMoves: Array.isArray(metadata.insertionBaseMoves) ? metadata.insertionBaseMoves : null,\n    skeletonKind: metadata.skeletonKind || null,\n    insertionMoves: Array.isArray(metadata.insertionMoves) ? metadata.insertionMoves : null,\n    insertionPosition: Number.isFinite(metadata.insertionPosition) ? metadata.insertionPosition : null,\n    insertions: Array.isArray(metadata.insertions) ? metadata.insertions : [],\n    rawInsertionMoveCount: Number.isFinite(metadata.rawInsertionMoveCount) ? metadata.rawInsertionMoveCount : null,\n    cancellationCount: Number.isFinite(metadata.cancellationCount) ? metadata.cancellationCount : null,\n    baseSource: metadata.baseSource || \"\",\n    moves: normalized,\n""",
    "createCandidate insertion metadata",
)

# Preserve all Rust insertion metadata and identify NISS even when wrapped by insertion source names.
js = replace_exact(
    js,
    """            const wcIsNiss =\n              /^FMC_(PREMOVE_)?NISS(_|$)/.test(wc.source || \"\") ||\n              /FMC_MULTI_NISS_INVERSE/.test(wc.source || \"\");\n""",
    """            const wcIsNiss = /NISS/.test(wc.source || \"\");\n""",
    "WASM NISS detection",
)

js = replace_exact(
    js,
    """                finishMoves: maybeInvert(wc.finishMoves),\n                premoveMoves: wc.premoves ? wc.premoves.split(/\\s+/).filter(Boolean) : null,\n""",
    """                finishMoves: maybeInvert(wc.finishMoves),\n                premoveMoves: wc.premoves ? wc.premoves.split(/\\s+/).filter(Boolean) : null,\n                skeletonKind: wc.skeletonKind || null,\n                skeletonMoves: wc.skeletonSolution ? wc.skeletonSolution.split(/\\s+/).filter(Boolean) : null,\n                insertionMoves: Array.isArray(wc.insertionMoves) ? wc.insertionMoves : null,\n                insertionPosition: wc.insertionPosition,\n                insertions: Array.isArray(wc.insertions) ? wc.insertions : [],\n                rawInsertionMoveCount: wc.rawInsertionMoveCount,\n                cancellationCount: wc.cancellationCount,\n                baseSource: wc.baseSource || \"\",\n""",
    "WASM insertion metadata forwarding",
)

parts_start = js.index("function buildFmcParts(candidate) {")
parts_end = js.index("\n\nconst FMC_QUALITY_PRESETS", parts_start)
if parts_start < 0 or parts_end < 0:
    raise SystemExit("buildFmcParts boundaries not found")
new_parts = r'''function buildFmcParts(candidate) {
  if (!candidate) return [];
  const parts = [];
  const sourceText = `${candidate.source || ""} ${candidate.baseSource || ""} ${candidate.strategy || ""}`;
  const isInsertion = /^FMC_INSERTION(?:_|$)/.test(candidate.source || "") || candidate.source === "FMC_INSERTION";
  const isNiss = /NISS/.test(sourceText);
  const isHtr = /HTR/.test(sourceText);
  const axisNote = candidate.axisName ? `${candidate.axisName}축` : "";
  const sideNote = isNiss ? "inverse side" : "normal side";
  const hasPremove = Array.isArray(candidate.premoveMoves) && candidate.premoveMoves.length > 0;

  const pushSummary = (name, moves, moveCount, notes = "") => {
    const normalizedMoves = Array.isArray(moves) ? moves : [];
    const count = Number.isFinite(moveCount) ? moveCount : normalizedMoves.length;
    if (!normalizedMoves.length && !(Number.isFinite(count) && count > 0) && !notes) return;
    parts.push({
      name,
      solution: joinMoves(normalizedMoves),
      moveCount: Number.isFinite(count) ? count : 0,
      notes,
      isSummary: true,
    });
  };

  if (hasPremove) {
    pushSummary(isNiss ? "Postmove" : "Premove", candidate.premoveMoves, candidate.premoveMoves.length, isNiss ? "NISS" : "");
  }

  pushSummary(
    isNiss ? "NISS 탐색" : "정방향 탐색",
    [],
    0,
    [sideNote, axisNote].filter(Boolean).join(", "),
  );
  pushSummary("EO", candidate.eoMoves, candidate.eoLength, [axisNote, sideNote].filter(Boolean).join(", "));
  pushSummary("DR", candidate.drMoves, candidate.drLength, [candidate.rzpUsed ? "RZP" : "", sideNote].filter(Boolean).join(", "));
  if (isHtr) pushSummary("HTR", [], 0, sideNote);
  pushSummary("P2 / Skeleton 진행", candidate.finishMoves, candidate.p2Length, sideNote);

  if (isInsertion) {
    const skeletonKindLabel = {
      corner3: "3-corner cycle",
      edge3: "3-edge cycle",
      corner2edge2: "2C2E",
      slice: "slice leave",
      corner4: "4-corner leave",
      edge4: "4-edge leave",
      corner3edge3: "3C3E leave",
    }[candidate.skeletonKind] || candidate.skeletonKind || "insertion leave";
    const skeletonMoves = Array.isArray(candidate.skeletonMoves) ? candidate.skeletonMoves : [];
    pushSummary("Skeleton", skeletonMoves, skeletonMoves.length || null, skeletonKindLabel);
    pushSummary("Leave", [], 0, skeletonKindLabel);

    const insertions = Array.isArray(candidate.insertions) && candidate.insertions.length
      ? candidate.insertions
      : Array.isArray(candidate.insertionMoves) && candidate.insertionMoves.length
        ? [{ kind: candidate.skeletonKind, moves: candidate.insertionMoves, position: candidate.insertionPosition }]
        : [];
    insertions.forEach((entry, index) => {
      const moves = Array.isArray(entry?.moves) ? entry.moves : [];
      const positionNote = Number.isFinite(entry?.position) ? `위치 ${entry.position}` : "";
      const kindNote = entry?.kind || candidate.skeletonKind || "";
      pushSummary(`Insertion ${index + 1}`, moves, moves.length, [kindNote, positionNote].filter(Boolean).join(", "));
    });

    const rawCount = Number.isFinite(candidate.rawInsertionMoveCount)
      ? candidate.rawInsertionMoveCount
      : skeletonMoves.length + insertions.reduce((sum, entry) => sum + (Array.isArray(entry?.moves) ? entry.moves.length : 0), 0);
    const cancellation = Number.isFinite(candidate.cancellationCount)
      ? candidate.cancellationCount
      : Math.max(0, rawCount - candidate.moveCount);
    pushSummary("Cancellation", [], 0, `${rawCount} → ${candidate.moveCount} (-${cancellation})`);
  }

  parts.push({
    name: "Final",
    solution: candidate.solution,
    moveCount: candidate.moveCount,
    notes: [isNiss ? "NISS" : "", axisNote, candidate.source || ""].filter(Boolean).join(", "),
  });
  return parts;
}'''
js = js[:parts_start] + new_parts + js[parts_end:]

# Build the breakdown before the target gate so a target miss still returns the best human path.
js = replace_exact(
    js,
    """  const best = rankedCandidates[0];\n  if (qualityMode === \"extreme\" && best.moveCount > targetMoveCount) {\n""",
    """  const best = rankedCandidates[0];\n  const parts = buildFmcParts(best);\n  const fmcStages = parts.length > 0 ? parts : [{ name: \"FMC Best\", solution: best.solution }];\n  if (qualityMode === \"extreme\" && best.moveCount > targetMoveCount) {\n""",
    "pre-gate FMC breakdown",
)
js = replace_exact(
    js,
    """      bestHumanSource: best.source,\n      attempts,\n""",
    """      bestHumanSource: best.source,\n      bestHumanStages: fmcStages,\n      bestHumanParts: parts,\n      stages: fmcStages,\n      parts,\n      attempts,\n""",
    "target miss breakdown return",
)

old_duplicate = """  // Build FMC part breakdown for the best candidate\n  const parts = buildFmcParts(best);\n\n  // Use parts directly as stages — preserves isSummary, moveCount, notes for all rows\n  // (Skeleton, Insertion summary rows are included; renderSolverStages handles isSummary correctly)\n  const fmcStages = parts.length > 0 ? parts : [\n    { name: \"FMC Direct\", solution: direct?.solution || \"-\" },\n    { name: \"FMC NISS\", solution: inverse?.solution ? invertAlg(inverse.solution) : \"-\" },\n    { name: \"FMC Best\", solution: best.solution },\n  ];\n\n"""
if old_duplicate not in js:
    raise SystemExit("duplicate FMC breakdown block not found")
js = js.replace(old_duplicate, "", 1)
js_path.write_text(js)

main_path = Path("main.js")
main = main_path.read_text()
main = replace_exact(
    main,
    """    // Skip summary stages that have no moves (e.g., \"Insertion: no insertion\")\n    if (isSummary && stageMoves.length === 0) continue;\n""",
    """    // Method summaries may intentionally contain notes without executable moves.\n""",
    "render empty method summaries",
)

old_failure = """    } else {\n      lastSolution = \"\";\n      lastSolutionDisplay = \"\";\n      clearSolverVisualResult();\n      const rawReason = result?.reason || \"\";\n      const reason = rawReason === \"MINMOVE_UNAVAILABLE\"\n        ? \"minmove HTM bundle 또는 WASM 모듈을 찾지 못했습니다.\"\n        : rawReason === \"MINMOVE_TIMEOUT\"\n          ? \"minmove exact 탐색이 시간 제한 안에 끝나지 않았습니다.\"\n          : rawReason.startsWith(\"ROUX_\") || rawReason.includes(\"SB_FAILED\") || rawReason.includes(\"CMLL_FAILED\") || rawReason.includes(\"LSE_FAILED\") || rawReason.includes(\"FB_FAILED\") || rawReason.includes(\"FINAL_NOT_SOLVED\")\n            ? \"Roux 해법으로 풀 수 없는 스크램블입니다. 다른 스크램블을 시도해주세요.\"\n            : rawReason || \"해를 찾지 못했습니다.\";\n      if (solverStatus) solverStatus.textContent = reason;\n      if (solverSolution) solverSolution.textContent = \"-\";\n      if (solverMoveCount) solverMoveCount.textContent = \"0 수\";\n      if (solverCopyBtn) solverCopyBtn.disabled = true;\n      const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;\n      f2lMethodSelect.value = VALID_F2L_METHODS.has(f2lMethod) ? f2lMethod : DEFAULT_F2L_METHOD;\n      filterF2lMethodOptions();\n    }\n"""
new_failure = """    } else {\n      const rawReason = result?.reason || \"\";\n      const hasFmcBest =\n        rawReason === \"FMC_HUMAN_TARGET_NOT_REACHED\" &&\n        typeof result?.bestHumanSolution === \"string\" &&\n        result.bestHumanSolution.trim();\n      if (hasFmcBest) {\n        const bestSolution = normalizeDisplayText(result.bestHumanSolution.trim());\n        const bestStages = Array.isArray(result.bestHumanStages) ? result.bestHumanStages : result.stages;\n        const stageLines = Array.isArray(bestStages)\n          ? bestStages.map((stage) => {\n              const sol = normalizeDisplayText(stage?.solution || \"\");\n              const notes = typeof stage?.notes === \"string\" && stage.notes ? ` [${stage.notes}]` : \"\";\n              const mc = Number.isFinite(stage?.moveCount) && stage.moveCount > 0 ? ` (${stage.moveCount}수)` : \"\";\n              return stage?.isSummary\n                ? `${stage.name}${mc}${notes}${sol ? \": \" + sol : \"\"}`\n                : `${stage.name}${mc}${notes}: ${sol || \"-\"}`;\n            })\n          : [];\n        lastSolution = bestSolution;\n        lastSolutionDisplay = stageLines.join(\"\\n\") || bestSolution;\n        if (solverStatus) {\n          solverStatus.textContent = `FMC Extreme 목표 미달 — 현재 최선 ${result.bestHumanMoveCount}수 (목표 ${result.qualityTarget}수)`;\n        }\n        if (solverSolution) solverSolution.textContent = lastSolutionDisplay;\n        if (solverMoveCount) solverMoveCount.textContent = `${result.bestHumanMoveCount} 수`;\n        if (solverCopyBtn) solverCopyBtn.disabled = false;\n        showSolverVisualResult(currentScramble, bestSolution, bestStages);\n      } else {\n        lastSolution = \"\";\n        lastSolutionDisplay = \"\";\n        clearSolverVisualResult();\n        const reason = rawReason === \"MINMOVE_UNAVAILABLE\"\n          ? \"minmove HTM bundle 또는 WASM 모듈을 찾지 못했습니다.\"\n          : rawReason === \"MINMOVE_TIMEOUT\"\n            ? \"minmove exact 탐색이 시간 제한 안에 끝나지 않았습니다.\"\n            : rawReason.startsWith(\"ROUX_\") || rawReason.includes(\"SB_FAILED\") || rawReason.includes(\"CMLL_FAILED\") || rawReason.includes(\"LSE_FAILED\") || rawReason.includes(\"FB_FAILED\") || rawReason.includes(\"FINAL_NOT_SOLVED\")\n              ? \"Roux 해법으로 풀 수 없는 스크램블입니다. 다른 스크램블을 시도해주세요.\"\n              : rawReason || \"해를 찾지 못했습니다.\";\n        if (solverStatus) solverStatus.textContent = reason;\n        if (solverSolution) solverSolution.textContent = \"-\";\n        if (solverMoveCount) solverMoveCount.textContent = \"0 수\";\n        if (solverCopyBtn) solverCopyBtn.disabled = true;\n        const f2lMethod = appState.settings.f2lMethod || DEFAULT_F2L_METHOD;\n        f2lMethodSelect.value = VALID_F2L_METHODS.has(f2lMethod) ? f2lMethod : DEFAULT_F2L_METHOD;\n        filterF2lMethodOptions();\n      }\n    }\n"""
main = replace_exact(main, old_failure, new_failure, "FMC target-miss UI")
main_path.write_text(main)

print("Applied human FMC breakdown output")
