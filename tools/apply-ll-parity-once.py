from pathlib import Path

cfop = Path("solver/cfop3x3.js")
s = cfop.read_text()
old = '  const solveMode = normalizeSolveMode(options.mode);\n  const solverVersion = normalizeSolverVersion(options.solverVersion);'
new = '  const solveMode = normalizeSolveMode(options.mode);\n  const stopAfterStage = String(options.stopAfterStage || "").trim().toUpperCase();\n  const solverVersion = normalizeSolverVersion(options.solverVersion);'
assert old in s
s = s.replace(old, new, 1)

anchor = '    const finalPattern = fullSolution ? pattern.applyAlg(fullSolution) : pattern;\n'
insert = '''    if (childResult.partialStageComplete === true) {
      return withPerformance({
        ...childResult,
        selectedCrossColor: crossColorRaw,
        solution: fullSolution,
        moveCount: countMetricMoves(fullMoves),
        stages,
        solutionDisplay: formatStageDisplay(stages, fullSolution),
      });
    }

'''
assert anchor in s
s = s.replace(anchor, insert + anchor, 1)

old = '''    if (moveText) {
      currentPattern = currentPattern.applyAlg(moveText);
    }
  }

  if (!isStrictSolvedPattern(currentPattern, currentPattern.patternData, ctx)) {'''
new = '''    if (moveText) {
      currentPattern = currentPattern.applyAlg(moveText);
    }
    if (stopAfterStage && String(stage.name || "").toUpperCase() === stopAfterStage) {
      const partialMoves = simplifyMoves(allMoves);
      const partialSolution = joinMoves(partialMoves);
      return withPerformance({
        ok: true,
        partialStageComplete: true,
        stoppedAfterStage: stage.name,
        solution: partialSolution,
        solutionDisplay: formatStageDisplay(solvedStages, partialSolution),
        moveCount: countMetricMoves(partialMoves),
        nodes: totalNodes,
        bound: totalBound,
        selectedCrossColor: crossColorRaw === "CN" ? "D" : crossColorRaw,
        source: "INTERNAL_3X3_CFOP_PARTIAL",
        stages: solvedStages,
        stageDiagnostics,
      });
    }
  }

  if (!isStrictSolvedPattern(currentPattern, currentPattern.patternData, ctx)) {'''
assert old in s
s = s.replace(old, new, 1)
cfop.write_text(s)

solver = Path("solver/solver444.js")
s = solver.read_text()
start = s.index('  const parityStage = Array.isArray(result.stages)')
end = s.index('  const rotationlessPublicStages = structuredClone(publicStages);', start)
replacement = r'''  const reductionParityStage = Array.isArray(result.stages)
    ? result.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;

  if (
    result.status !== "partial" ||
    result.reason !== "444_REDUCTION_INCOMPLETE" ||
    result.meta?.virtual333Ready !== true ||
    !result.meta?.virtual333 ||
    !centerStage ||
    !edgeStage
  ) {
    emitProgress(onProgress, {
      type: result.ok ? "444_stage_done" : "444_stage_fail",
      eventId: "444",
      stage: "REDUCTION",
      reason: result.reason,
      status: result.status,
    });
    return result;
  }

  emitProgress(onProgress, {
    type: "444_stage_start",
    eventId: "444",
    stage: "THREE_BY_THREE",
    stageName: "3x3 CFOP · LL parity",
  });

  let ll;
  try {
    const { solveLlDeferred444 } = await import("./llParity444.js");
    ll = await solveLlDeferred444({
      scramble: publicScramble,
      centerSolution: translate444MoveConvention(centerStage.solution || ""),
      edgeSolution: translate444MoveConvention(edgeStage.solution || ""),
      crossColor,
      deadlineTs,
      onProgress(progress) {
        emitProgress(onProgress, {
          type: "444_stage_update",
          eventId: "444",
          stage: "THREE_BY_THREE",
          phase: "ll",
          stageName: "3x3 CFOP · LL parity",
          cfopStageName: String(progress?.stageName || "LL"),
        });
      },
    });
  } catch (error) {
    ll = { ok: false, reason: "444_LL_PARITY_BRIDGE_FAILED", detail: String(error?.message || error) };
  }

  if (!ll?.ok) {
    const timedOut = deadlineReached(deadlineTs);
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "THREE_BY_THREE",
      reason: ll?.reason || "444_LL_PARITY_FAILED",
    });
    return {
      ...result,
      status: timedOut ? "timeout" : "partial",
      reason: timedOut ? "444_DEADLINE_REACHED" : "444_LL_PARITY_FAILED",
      detail: ll?.reason || ll?.detail || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        llParityReason: ll?.reason || null,
        parityHandledAt: "LL",
      },
    };
  }

  const publicLlSegments = (Array.isArray(ll.segments) ? ll.segments : []).map((stage, index) => ({
    ...stage,
    id: stage?.id || `cfop${index + 1}`,
    name: normalizeCfopStageName(stage?.name),
    solution: String(stage?.solution || "").trim(),
    moveCount: splitAlgorithm(stage?.solution).length,
    verified: true,
  }));
  const internalLlSegments = publicLlSegments.map((stage) => ({
    ...stage,
    solution: translate444MoveConvention(stage.solution),
  }));
  const internalThreeByThreeSolution = internalLlSegments
    .map((stage) => stage.solution)
    .filter(Boolean)
    .join(" ");
  const internalThreeByThreeStage = {
    id: "threeByThree",
    name: "3x3 CFOP",
    solution: internalThreeByThreeSolution,
    moveCount: splitAlgorithm(internalThreeByThreeSolution).length,
    verified: false,
    method: "CFOP · LL Parity",
    segments: internalLlSegments,
  };
  const internalCompleteStages = [centerStage, edgeStage, internalThreeByThreeStage];
  const internalCompleteSolution = internalCompleteStages
    .map((stage) => String(stage.solution || "").trim())
    .filter(Boolean)
    .join(" ");

  let verification;
  try {
    verification = JSON.parse(String(api.verify({
      scramble: internalScramble,
      solution: internalCompleteSolution,
    }) || ""));
  } catch (error) {
    verification = { ok: false, solved: false, reason: String(error?.message || error) };
  }

  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "VERIFY",
      reason: verification?.reason || "444_FINAL_VERIFICATION_FAILED",
    });
    return {
      ...result,
      status: "error",
      reason: "444_FINAL_VERIFICATION_FAILED",
      detail: verification?.reason || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        cfopMoveCount: Number(ll.cfopMoveCount) || 0,
        threeByThreeMoveCount: internalThreeByThreeStage.moveCount,
        parityMoveCount: Number(ll.parityMoveCount) || 0,
        parityHandledAt: "LL",
        fullVerificationSolved: false,
      },
    };
  }

  internalThreeByThreeStage.verified = true;
  const publicStages = internalCompleteStages.map((stage) => ({
    ...stage,
    solution: translate444MoveConvention(stage.solution),
    segments: Array.isArray(stage.segments)
      ? stage.segments.map((segment) => ({
          ...segment,
          solution: translate444MoveConvention(segment.solution),
        }))
      : stage.segments,
  }));
  try {
    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
    if (publicEdgeStage && publicEdgeStage.method !== "3-2-3") {
      publicEdgeStage.segments = await buildEdgePairingSegments(
        publicScramble,
        publicCenterStage?.solution || "",
        publicEdgeStage.solution || "",
      );
    }
  } catch (error) {
    console.warn("[444] edge pairing segmentation failed", error);
  }

'''
s = s[:start] + replacement + s[end:]
old = '''      cfopMoveCount: internalThreeByThreeStage.moveCount,
      cfopNodes: Number(cfop.nodes) || 0,
      cfopStageCount: internalCfopSegments.length,
      cfopMethod: "CFOP",
      crossColor,'''
new = '''      cfopMoveCount: Number(ll.cfopMoveCount) || 0,
      threeByThreeMoveCount: internalThreeByThreeStage.moveCount,
      parityMoveCount: Number(ll.parityMoveCount) || 0,
      reductionParityMoveCount: Number(reductionParityStage?.moveCount) || 0,
      cfopNodes: Number(ll.nodes) || 0,
      cfopStageCount: internalLlSegments.filter((stage) => stage?.parity !== true).length,
      llStageCount: internalLlSegments.length,
      cfopMethod: "CFOP",
      parityHandledAt: "LL",
      ollParityDetected: ll.ollParityDetected === true,
      pllParityDetected: ll.pllParityDetected === true,
      reductionOllParityDetected: result.meta?.ollParityDetected === true,
      reductionPllParityDetected: result.meta?.pllParityDetected === true,
      crossColor,'''
assert old in s
s = s.replace(old, new, 1)
solver.write_text(s)

p = Path("tools/verify-444-worker-boundary.mjs")
s = p.read_text()
s = s.replace("assert.equal(valid.stages.length, 4);", "assert.equal(valid.stages.length, 3);")
old = '''const expectedStages = [
  ["centers", "Centers"],
  ["edges", "Edge Pairing · 3-2-3"],
  ["parity", "Parity Normalization"],
  ["threeByThree", "3x3 CFOP"],
];'''
new = '''const expectedStages = [
  ["centers", "Centers"],
  ["edges", "Edge Pairing · 3-2-3"],
  ["threeByThree", "3x3 CFOP"],
];'''
assert old in s
s = s.replace(old, new, 1)
s = s.replace(
    "assert.equal(valid.stages[2].moveCount, valid.meta.parityMoveCount);\nassert.equal(valid.stages[3].moveCount, valid.meta.cfopMoveCount);",
    "assert.equal(valid.stages[2].moveCount, valid.meta.threeByThreeMoveCount);\nassert.ok(valid.meta.cfopMoveCount <= valid.meta.threeByThreeMoveCount);",
)
s = s.replace("const cfopSegments = valid.stages[3].segments;", "const cfopSegments = valid.stages[2].segments;")
old = '''assert.deepEqual(
  cfopSegments.map((stage) => stage.name),
  ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
);'''
new = '''assert.deepEqual(
  cfopSegments.map((stage) => stage.name),
  ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL Parity", "PLL"],
);
assert.ok(cfopSegments.findIndex((stage) => stage.name === "PLL Parity") > cfopSegments.findIndex((stage) => stage.name === "OLL"));'''
assert old in s
s = s.replace(old, new, 1)
s = s.replace("  valid.stages[3].solution,", "  valid.stages[2].solution,")
s = s.replace(
    "assert.equal(valid.meta.cfopStageCount, 7);",
    'assert.equal(valid.meta.cfopStageCount, 7);\nassert.equal(valid.meta.llStageCount, 8);\nassert.equal(valid.meta.parityHandledAt, "LL");\nassert.equal(valid.meta.ollParityDetected, false);\nassert.equal(valid.meta.pllParityDetected, true);',
)
s = s.replace(
    'for (const stage of ["CENTERS", "EDGES", "PARITY", "VIRTUAL_333", "THREE_BY_THREE", "VERIFY"]) {',
    'for (const stage of ["CENTERS", "EDGES", "THREE_BY_THREE", "VERIFY"]) {',
)
s = s.replace(
    'assert.match(solver444Source, /solve3x3StrictCfopFromPattern/);\nassert.match(solver444Source, /enableHumanViewpoint: true/);',
    'assert.match(solver444Source, /llParity444\\.js/);\nassert.match(solver444Source, /parityHandledAt: "LL"/);',
)
p.write_text(s)

p = Path("tools/verify-444-public-notation.mjs")
s = p.read_text()
s = s.replace("  assert.equal(result.stages.length, 4);", "  assert.equal(result.stages.length, 3);")
old = '''  assert.deepEqual(
    cfopStage.segments.map((stage) => stage.name),
    ["Cross", "F2L 1", "F2L 2", "F2L 3", "F2L 4", "OLL", "PLL"],
  );'''
new = '''  const llNames = cfopStage.segments.map((stage) => stage.name);
  assert.equal(llNames[0], "Cross");
  assert.ok(llNames.some((name) => /^F2L(?:\\s|$)/.test(name)));
  assert.ok(llNames.includes("OLL"));
  assert.ok(llNames.includes("PLL"));
  if (result.meta.ollParityDetected) {
    assert.ok(llNames.indexOf("OLL Parity") >= 0);
    assert.ok(llNames.indexOf("OLL Parity") < llNames.indexOf("OLL"));
  }
  if (result.meta.pllParityDetected) {
    assert.ok(llNames.indexOf("PLL Parity") > llNames.indexOf("OLL"));
    assert.ok(llNames.indexOf("PLL Parity") < llNames.indexOf("PLL"));
  }
  assert.equal(result.meta.parityHandledAt, "LL");'''
assert old in s
s = s.replace(old, new, 1)
s = s.replace(
    "/^(?:[URFDLB](?:2|')?|[xyz](?:2|')?)$/",
    "/^(?:[URFDLB](?:w)?(?:2|')?|[xyz](?:2|')?)$/",
)
p.write_text(s)

p = Path(".github/workflows/444-worker-boundary.yml")
s = p.read_text()
s = s.replace('      - "solver/solver444.js"\n', '      - "solver/solver444.js"\n      - "solver/llParity444.js"\n', 2)
s = s.replace('      - "tools/verify-444-public-notation.mjs"\n', '      - "tools/verify-444-public-notation.mjs"\n      - "tools/verify-444-ll-parity.mjs"\n', 2)
s = s.replace('          node --check solver/solver444.js\n', '          node --check solver/solver444.js\n          node --check solver/llParity444.js\n', 1)
s = s.replace('          node --check tools/verify-444-public-notation.mjs\n', '          node --check tools/verify-444-public-notation.mjs\n          node --check tools/verify-444-ll-parity.mjs\n', 1)
anchor = '      - name: Verify public WCA notation and Centers stage\n        run: node tools/verify-444-public-notation.mjs\n\n'
assert anchor in s
s = s.replace(anchor, anchor + '      - name: Verify LL-time OLL and PLL parity\n        run: node tools/verify-444-ll-parity.mjs\n\n', 1)
p.write_text(s)
