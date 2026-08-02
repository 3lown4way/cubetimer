import fs from "node:fs";

const file = new URL("../solver/cfop3x3.js", import.meta.url);
let source = fs.readFileSync(file, "utf8");

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source block is not unique`);
  }
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  "pure ZB F2L profile",
  `const PURE_ZB_CFOP_PROFILE = {
  crossMaxDepth: 8,
  f2lMaxDepth: 40,
  f2lFormulaMaxSteps: 9,
  f2lFormulaBeamWidth: 4,
  f2lFormulaExpansionLimit: 6,
  f2lFormulaMaxAttempts: 65000,
  f2lFormulaBeamBudgetMs: 16,
  f2lSearchMaxDepth: 9,
  f2lNodeLimit: 140000,
  ollMaxDepth: 22,
  pllMaxDepth: 22,
};`,
  `const PURE_ZB_CFOP_PROFILE = {
  crossMaxDepth: 8,
  f2lMaxDepth: 40,
  // Pure ZB needs enough beam depth to reach three solved pairs and rank the
  // resulting ZBLS case. The previous 16 ms cap normally expired at depth 2.
  f2lFormulaMaxSteps: 12,
  f2lFormulaBeamWidth: 8,
  f2lFormulaExpansionLimit: 14,
  f2lFormulaMaxAttempts: 260000,
  f2lFormulaBeamBudgetMs: 96,
  f2lSearchMaxDepth: 11,
  f2lNodeLimit: 260000,
  ollMaxDepth: 22,
  pllMaxDepth: 22,
};`,
);

replaceOnce(
  "ZB compact bypass",
  `  const preferCompactF2L =
    solverVersion === "v2" &&
    (solveMode === "strict" || solveMode === "zb") &&
    !useSvWvStages &&
    !mixedCfopStages &&
    !hasStyleOptIn &&
    !f2lTransitionProfile &&
    !f2lDownstreamProfile;`,
  `  const preferCompactF2L =
    solverVersion === "v2" &&
    solveMode === "strict" &&
    !useSvWvStages &&
    !mixedCfopStages &&
    !hasStyleOptIn &&
    !f2lTransitionProfile &&
    !f2lDownstreamProfile;`,
);

replaceOnce(
  "exact F2L pair progress",
  `    const result = {
      score,
      cornerSolved,
      middleEdgeSolved,
      pairProgress: Math.min(cornerSolved, middleEdgeSolved),
      solvedSum: cornerSolved + middleEdgeSolved,
      _precomputed: precomputed,
    };`,
  `    // A solved corner and a solved edge from different slots are not a solved
    // F2L pair. Use the exact slot pairing for beam progress and ZBLS gating.
    const pairProgress = getF2LPairProgress(data, ctx);
    const result = {
      score,
      cornerSolved,
      middleEdgeSolved,
      pairProgress,
      solvedSum: cornerSolved + middleEdgeSolved,
      _precomputed: precomputed,
    };`,
);

replaceOnce(
  "F2L pair anchor index",
  `          if (entry.cornerCount && entry.edgeCount) {
            const key = encodeF2LAnchorKey(
              entry.anchorCornerPos,
              entry.anchorCornerPiece,
              entry.anchorCornerOri,
              entry.anchorEdgePos,
              entry.anchorEdgePiece,
              entry.anchorEdgeOri,
            );
            const bucket = anchorIndex[key];
            if (bucket) {
              bucket.push(entryIndex);
            } else {
              anchorIndex[key] = [entryIndex];
            }
          } else {
            fallbackIndices.push(entryIndex);
          }`,
  `          // Index the case by the actual corner+edge belonging to each F2L
          // slot. The old index used the first changed corner and first changed
          // edge, which are frequently unrelated pieces. That caused an index
          // miss followed by a full scan of all 8,672 formula candidates.
          let indexedByPair = false;
          const pairDefs = Array.isArray(ctx.f2lPairDefs) ? ctx.f2lPairDefs : EMPTY_MOVES;
          for (let pairIndex = 0; pairIndex < pairDefs.length; pairIndex++) {
            const pairDef = pairDefs[pairIndex];
            let pairCornerPos = -1;
            let pairEdgePos = -1;
            for (let pos = 0; pos < caseData.CORNERS.pieces.length; pos++) {
              if (caseData.CORNERS.pieces[pos] === pairDef.cornerPieceId) {
                pairCornerPos = pos;
                break;
              }
            }
            for (let pos = 0; pos < caseData.EDGES.pieces.length; pos++) {
              if (caseData.EDGES.pieces[pos] === pairDef.edgePieceId) {
                pairEdgePos = pos;
                break;
              }
            }
            if (pairCornerPos < 0 || pairEdgePos < 0) continue;
            const key = encodeF2LAnchorKey(
              pairCornerPos,
              pairDef.cornerPieceId,
              caseData.CORNERS.orientation[pairCornerPos],
              pairEdgePos,
              pairDef.edgePieceId,
              caseData.EDGES.orientation[pairEdgePos],
            );
            const bucket = anchorIndex[key];
            if (bucket) bucket.push(entryIndex);
            else anchorIndex[key] = [entryIndex];
            indexedByPair = true;
          }
          if (!indexedByPair) fallbackIndices.push(entryIndex);`,
);

replaceOnce(
  "ZBLS case-library rescan option",
  `      formulaAttemptLimit: normalizeDepth(options.zblsFormulaAttemptLimit, useZbStages ? 40000 : 0),
      maxDepth: normalizeDepth(`,
  `      formulaAttemptLimit: normalizeDepth(options.zblsFormulaAttemptLimit, useZbStages ? 40000 : 0),
      // A static/dynamic key miss must not end a pure ZB solve when the actual
      // ZBLS algorithm is present. Rescan only the ZBLS formula family.
      allowCaseLibraryRescan: useZbStages,
      maxDepth: normalizeDepth(`,
);

replaceOnce(
  "ZBLL case-library rescan option",
  `      formulaAttemptLimit: normalizeDepth(options.zbllFormulaAttemptLimit, useZbLL ? 50000 : 0),
      maxDepth: normalizeDepth(options.pllMaxDepth, profile.pllMaxDepth),`,
  `      formulaAttemptLimit: normalizeDepth(options.zbllFormulaAttemptLimit, useZbLL ? 50000 : 0),
      // Preserve pure ZB semantics: on an index miss, exhaust the ZBLL/PLL
      // formula family directly rather than using generic search or OLL+PLL.
      allowCaseLibraryRescan: useZbLL,
      maxDepth: normalizeDepth(options.pllMaxDepth, profile.pllMaxDepth),`,
);

replaceOnce(
  "single-stage comprehensive-index assumption",
  `    // Library is comprehensive — state not in map means no formula applies
    return null;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {`,
  `    // Most case libraries are comprehensive. Pure ZB is stricter: an index
    // miss may be a key-generation omission, so rescan only the declared ZB
    // formula family before reporting NOT_FOUND.
    if (stage.allowCaseLibraryRescan !== true) return null;
    if (performanceCollector) performanceCollector.caseLibraryRescanUsed = true;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {`,
);

replaceOnce(
  "fixed-color ZB XCross probe insertion point",
  `  const stages = getStageDefinitions(options, ctx, modeProfile, solveMode);
  for (let i = 0; i < stages.length; i++) {`,
  `  // For a fixed cross colour, Pure ZB previously skipped XCross entirely
  // unless a player-style profile supplied a historical XCross rate. Probe an
  // XCross first, but downgrade to a normal cross when no practical XCross is
  // available. This is an opportunistic ZB choice, not a method fallback.
  if (
    solveMode === "zb" &&
    options.crossTargetPairsOverride === undefined &&
    options.__zbXCrossProbeApplied !== true
  ) {
    const probeStartedAt = Date.now();
    const overallDeadline = Number.isFinite(options.deadlineTs) && options.deadlineTs > 0
      ? options.deadlineTs
      : 0;
    const probeDeadline = Math.min(
      Date.now() + 140,
      ...(overallDeadline > 0 ? [overallDeadline] : []),
    );
    const probeOptions = {
      ...options,
      crossTargetPairsOverride: 1,
      crossMaxDepth: Math.min(normalizeDepth(options.crossMaxDepth, 9), 9),
      deadlineTs: probeDeadline,
      __zbXCrossProbeApplied: true,
    };
    const probeStage = getStageDefinitions(probeOptions, ctx, modeProfile, solveMode)[0];
    const probeResult = solveStage(pattern, probeStage, ctx);
    const selectedTargetPairs = probeResult?.ok ? 1 : 0;
    const childResult = await solve3x3StrictCfopFromPattern(pattern, {
      ...options,
      crossTargetPairsOverride: selectedTargetPairs,
      __zbXCrossProbeApplied: true,
      __cfopPerformanceSession: performanceSession,
    });
    if (childResult && typeof childResult === "object") {
      return withPerformance({
        ...childResult,
        zbXCrossProbe: {
          attempted: true,
          ok: probeResult?.ok === true,
          reason: probeResult?.ok ? "OK" : probeResult?.reason || "XCROSS_NOT_FOUND",
          nodes: Number(probeResult?.nodes || 0),
          bound: Number.isFinite(probeResult?.bound) ? probeResult.bound : null,
          elapsedMs: Math.max(1, Date.now() - probeStartedAt),
          selectedTargetPairs,
        },
      });
    }
    return withPerformance(childResult);
  }

  const stages = getStageDefinitions(options, ctx, modeProfile, solveMode);
  for (let i = 0; i < stages.length; i++) {`,
);

replaceOnce(
  "single-stage diagnostic rescan field",
  `    libraryRebuiltDuringStage: libraryTelemetry.singleStageLibraryBuilds > 0,
  };`,
  `    libraryRebuiltDuringStage: libraryTelemetry.singleStageLibraryBuilds > 0,
    caseLibraryRescanUsed: collector?.caseLibraryRescanUsed === true,
  };`,
);

fs.writeFileSync(file, source);
console.log("Applied Pure ZB pipeline reliability fixes to solver/cfop3x3.js");
