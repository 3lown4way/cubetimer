from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new and new in text:
        return text
    if old not in text:
        if not new:
            return text
        raise RuntimeError(f"{label} marker not found")
    return text.replace(old, new, 1)


worker_path = Path("solver/solverWorker.js")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    "const TWOPHASE_333_MAX_FRONTIERS = 12;",
    "const TWOPHASE_333_MAX_FRONTIERS = 2;",
    "two-phase frontier",
)
worker = replace_once(
    worker,
    "    await prewarm3x3StrictCfopLibraries();\n",
    "    await prewarm3x3StrictCfopLibraries({ includeF2L: false, includeSingleStage: true });\n",
    "default CFOP prewarm",
)
worker = replace_once(
    worker,
    "  void prewarmInternal3x3StrictCfop();\n",
    "",
    "background CFOP warmup",
)
worker_path.write_text(worker)

cfop_path = Path("solver/cfop3x3.js")
cfop = cfop_path.read_text()

style_marker = "  const enableStyleFallback = hasStyleOptIn && options.enableStyleFallback !== false;\n"
style_insert = style_marker + '''  const preferCompactF2L =
    solveMode === "strict" &&
    !useSvWvStages &&
    !mixedCfopStages &&
    !hasStyleOptIn &&
    !f2lTransitionProfile &&
    !f2lDownstreamProfile;
'''
cfop = replace_once(cfop, style_marker, style_insert, "compact F2L condition")

stage_marker = '''      mixedCfopStages,
      enableStyleFallback,
      deadlineTs,
      f2lStyleProfile,
'''
stage_replacement = '''      mixedCfopStages,
      enableStyleFallback,
      preferCompactF2L,
      deadlineTs,
      f2lStyleProfile,
'''
cfop = replace_once(cfop, stage_marker, stage_replacement, "F2L stage flag")

solve_marker = '''  ) {
    const beamResult = solveWithFormulaDbF2L(startPattern, stage, ctx);
'''
compact_block = '''  ) {
    if (stage.preferCompactF2L === true) {
      const compactResult = solveF2LCompactIDA(startPattern, stage, ctx);
      if (stage.performanceCollector) {
        stage.performanceCollector.compactPathUsed = true;
        stage.performanceCollector.compactFallbackUsed = false;
        stage.performanceCollector.finalMethod = compactResult?.ok
          ? "compact_ida"
          : "compact_ida_failed";
        if (Number.isFinite(compactResult?.nodes)) {
          stage.performanceCollector.finalNodes = compactResult.nodes;
        }
        if (Number.isFinite(compactResult?.bound)) {
          stage.performanceCollector.finalBound = compactResult.bound;
        }
      }
      if (!compactResult) return compactResult;
      return {
        ...compactResult,
        method: compactResult.ok ? "compact_ida" : "compact_ida_failed",
        f2lDiagnostics: stage.performanceCollector || null,
      };
    }
    const beamResult = solveWithFormulaDbF2L(startPattern, stage, ctx);
'''
cfop = replace_once(cfop, solve_marker, compact_block, "compact F2L dispatch")

library_marker = '''      const f2lLibraryAwaitStartedAt = Date.now();
      stages[i].f2lCaseLibrary = await getF2LCaseLibrary(ctx);
      performanceSession.f2lLibraryAwaitMs += Math.max(0, Date.now() - f2lLibraryAwaitStartedAt);
'''
library_replacement = '''      if (stages[i].preferCompactF2L !== true) {
        const f2lLibraryAwaitStartedAt = Date.now();
        stages[i].f2lCaseLibrary = await getF2LCaseLibrary(ctx);
        performanceSession.f2lLibraryAwaitMs += Math.max(0, Date.now() - f2lLibraryAwaitStartedAt);
      }
'''
cfop = replace_once(cfop, library_marker, library_replacement, "lazy F2L library")
cfop = replace_once(
    cfop,
    "    _warmOllPllLibraries(ctx);\n",
    "",
    "automatic LL library warmup",
)

if "const formulaDescriptors = libraryFormulas.map" not in cfop:
    function_start = cfop.index("function getSingleStageFormulaCaseLibrary(")
    loop_start = cfop.index("  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {", function_start)
    loop_end = cfop.index("\n\n  for (const caseCandidates of caseMap.values())", loop_start)
    optimized_loop = '''  const formulaDescriptors = libraryFormulas.map((alg) => {
    const { leadingRot, rest: strippedAlg } = extractLeadingYRot(alg);
    const normalizedAlg = normalizeFormulaMatchText(alg);
    return {
      alg,
      leadingRot,
      strippedAlg,
      normalizedAlg,
      fallbackFormulaKey: libraryFormulaKeyLookup?.get(normalizedAlg) ?? null,
    };
  });
  const postAufInverseList = postAufList.map((postAuf) => invertAlg(postAuf));
  const caseDedupeIndex = new Map();

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {
    const rot = FORMULA_ROTATIONS[r];
    for (let a = 0; a < preAufList.length; a++) {
      const preAuf = preAufList[a];
      for (let i = 0; i < formulaDescriptors.length; i++) {
        const descriptor = formulaDescriptors[i];
        const combinedRot = composeYRot(rot, descriptor.leadingRot);
        const baseCandidate = joinMoves([
          combinedRot,
          preAuf,
          descriptor.strippedAlg,
          invertRotation(combinedRot),
        ]);
        const baseInverse = invertAlg(baseCandidate);
        const baseMoves = splitMoves(baseCandidate);
        if (!baseMoves.length || !baseInverse) continue;
        const netRot = computeNetCubeRotationMoves(baseCandidate);

        for (let p = 0; p < postAufList.length; p++) {
          const postAuf = postAufList[p];
          const candidate = postAuf ? joinMoves([baseCandidate, postAuf]) : baseCandidate;
          const candidateMoves = postAuf ? baseMoves.concat(postAuf) : baseMoves;
          if (candidateMoves.length > stage.maxDepth) continue;
          const inverse = postAuf
            ? joinMoves([postAufInverseList[p], baseInverse])
            : baseInverse;
          const casePattern = tryApplyAlg(solved, inverse);
          if (!casePattern) continue;
          const normalizedCasePattern = netRot
            ? (tryApplyAlg(casePattern, netRot) ?? casePattern)
            : casePattern;
          const normalizedCandidate = normalizeFormulaMatchText(candidate);
          const formulaKey = libraryFormulaKeyLookup?.get(normalizedCandidate)
            ?? descriptor.fallbackFormulaKey;
          const caseKey = getKeyFn(normalizedCasePattern.patternData);
          let caseCandidates = caseMap.get(caseKey);
          let dedupeIndex = caseDedupeIndex.get(caseKey);
          if (!caseCandidates) {
            caseCandidates = [];
            caseMap.set(caseKey, caseCandidates);
          }
          if (!dedupeIndex) {
            dedupeIndex = new Map();
            caseDedupeIndex.set(caseKey, dedupeIndex);
          }
          const dedupeKey = `${String(formulaKey || "")}::${normalizedCandidate}`;
          const existingIndex = dedupeIndex.get(dedupeKey);
          const nextEntry = {
            text: candidate,
            normalizedText: normalizedCandidate,
            moves: candidateMoves,
            formulaKey,
          };
          if (existingIndex !== undefined) {
            if (compareSingleStageCaseCandidateDefault(nextEntry, caseCandidates[existingIndex]) < 0) {
              caseCandidates[existingIndex] = nextEntry;
            }
          } else {
            dedupeIndex.set(dedupeKey, caseCandidates.length);
            caseCandidates.push(nextEntry);
          }
        }
      }
    }
  }'''
    cfop = cfop[:loop_start] + optimized_loop + cfop[loop_end:]

cfop_path.write_text(cfop)

benchmark_path = Path("benchmark-hotpaths.mjs")
benchmark = benchmark_path.read_text()
benchmark = replace_once(
    benchmark,
    "      maxPhase1Solutions: 12,",
    "      maxPhase1Solutions: 2,",
    "hotpath benchmark frontier",
)
benchmark_path.write_text(benchmark)

print("hotpath optimization patch applied")
