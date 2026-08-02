from pathlib import Path

path = Path("solver/cfop3x3.js")
text = path.read_text()
old = '''    // Library is comprehensive — state not in map means no formula applies
    return null;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {'''
new = '''    // A generated key miss must not terminate Pure ZB. Re-check the same direct
    // ZBLL formula set by replaying its y/AUF variants against the actual state.
    // This remains the selected ZBLL stage; it is not OLL+PLL, generic search,
    // Two-Phase, an alternate F2L route, or any cross-method fallback.
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {'''
if old not in text:
    raise SystemExit("ZBLL library key-miss return anchor not found")
text = text.replace(old, new, 1)

anchor = '''  if (performanceCollector) {
    performanceCollector.attempts = attempts;
    performanceCollector.lookupElapsedMs = Math.max(1, Date.now() - lookupStartedAt);
  }
  return null;
}

// Fast F2L IDA* using precomputed integer move tables'''
closure = '''  // Complete the direct ZBLL library by one formula-composition layer. Each
  // first move sequence is itself a ZBLL/PLL formula that preserves F2L and LL
  // edge orientation; the second sequence is an indexed direct ZBLL candidate.
  // The combined sequence is verified on the actual state and reported openly
  // as ZBLL_DIRECT_CLOSURE. No search solver or alternate method is invoked.
  if (formulaNamespace === "LL:ZBLL_PLL" && library?.caseMap?.size) {
    const firstLayer = [];
    const firstSeen = new Set();
    for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {
      const rot = FORMULA_ROTATIONS[r];
      for (let a = 0; a < preAufList.length; a++) {
        const preAuf = preAufList[a];
        for (let i = 0; i < formulas.length; i++) {
          const { leadingRot, rest: strippedAlg } = extractLeadingYRot(formulas[i]);
          const combinedRot = composeYRot(rot, leadingRot);
          const text = joinMoves([
            combinedRot,
            preAuf,
            strippedAlg,
            invertRotation(combinedRot),
          ]);
          const normalized = normalizeFormulaMatchText(text);
          if (!normalized || firstSeen.has(normalized)) continue;
          firstSeen.add(normalized);
          const moves = splitMoves(text);
          if (!moves.length) continue;
          firstLayer.push({ text, moves, metric: countMetricMoves(moves) });
        }
      }
    }
    firstLayer.sort((a, b) =>
      a.metric - b.metric || a.moves.length - b.moves.length || a.text.localeCompare(b.text),
    );

    const allowedFormulaKeySet = formulaKeys.length ? new Set(formulaKeys) : null;
    let bestClosure = null;
    let closureAttempts = 0;
    const closureMetricLimit = Math.max(36, stage.maxDepth);
    for (const first of firstLayer) {
      if (stageDeadlineTs > 0 && (closureAttempts & 63) === 0 && Date.now() >= stageDeadlineTs) break;
      if (bestClosure && first.metric >= bestClosure.depth) break;
      const intermediate = tryApplyMoves(startPattern, first.moves);
      closureAttempts += 1;
      if (!intermediate) continue;
      if (!isF2LSolved(intermediate.patternData, ctx)) continue;
      if (!isTopEdgeOrientationSolvedForLL(intermediate.patternData, ctx)) continue;
      const intermediateKey = stage.zbllKey(intermediate.patternData);
      const secondRaw = library.caseMap.get(intermediateKey);
      if (!Array.isArray(secondRaw) || secondRaw.length === 0) continue;
      const secondCandidates = allowedFormulaKeySet
        ? secondRaw.filter((candidate) =>
            !candidate?.formulaKey || allowedFormulaKeySet.has(candidate.formulaKey),
          )
        : secondRaw;
      for (const second of secondCandidates) {
        if (!Array.isArray(second?.moves)) continue;
        const combinedMoves = simplifyMoves(first.moves.concat(second.moves));
        const metric = countMetricMoves(combinedMoves);
        if (metric > closureMetricLimit) continue;
        if (bestClosure && metric >= bestClosure.depth) continue;
        const finalPattern = tryApplyMoves(startPattern, combinedMoves);
        closureAttempts += 1;
        if (!finalPattern || !acceptsFormulaResult(finalPattern, second.formulaKey || "ZBLL")) continue;
        bestClosure = {
          ok: true,
          moves: combinedMoves,
          depth: metric,
          nodes: closureAttempts,
          bound: metric,
          formulaKey: "ZBLL",
          method: "ZBLL_DIRECT_CLOSURE",
        };
      }
    }
    if (performanceCollector) {
      performanceCollector.directClosureAttempts = closureAttempts;
      performanceCollector.directClosureRecovered = Boolean(bestClosure);
    }
    if (bestClosure) return bestClosure;
  }

  if (performanceCollector) {
    performanceCollector.attempts = attempts;
    performanceCollector.lookupElapsedMs = Math.max(1, Date.now() - lookupStartedAt);
  }
  return null;
}

// Fast F2L IDA* using precomputed integer move tables'''
if anchor not in text:
    raise SystemExit("single-stage direct closure insertion anchor not found")
text = text.replace(anchor, closure, 1)
path.write_text(text)
Path("tools/apply-zbll-direct-key-miss-fix.py").unlink()
