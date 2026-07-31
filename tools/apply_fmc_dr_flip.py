from pathlib import Path

path = Path("solver/fmcSolver.js")
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match, found {count}: {old[:100]!r}")
    text = text.replace(old, new, 1)


replace_once(
    'function buildPatternFrontier(rootPattern, depthLimit, direction = "forward") {',
    'function buildPatternFrontier(\n  rootPattern,\n  depthLimit,\n  direction = "forward",\n  moveNames = FMC_INSERTION_MOVE_NAMES,\n) {',
)
replace_once(
    '''  const queue = [{ pattern: rootPattern, path: [], depth: 0, lastFace: "", lastFaceIdx: -1 }];
  let head = 0;

  while (head < queue.length) {''',
    '''  const effectiveMoveNames = Array.isArray(moveNames) && moveNames.length
    ? moveNames
    : FMC_INSERTION_MOVE_NAMES;
  const queue = [{ pattern: rootPattern, path: [], depth: 0, lastFace: "", lastFaceIdx: -1 }];
  let head = 0;

  while (head < queue.length) {''',
)
replace_once(
    '''    for (let i = 0; i < FMC_INSERTION_MOVE_NAMES.length; i += 1) {
      const move = FMC_INSERTION_MOVE_NAMES[i];
      const faceIdx = FMC_INSERTION_MOVE_FACE_IDX[i];''',
    '''    for (let i = 0; i < effectiveMoveNames.length; i += 1) {
      const move = effectiveMoveNames[i];
      const faceIdx = FRON_FACE_TO_IDX[move[0]] ?? -1;''',
)
replace_once(
    'function findShorterEquivalentSegment(startPattern, targetPattern, maxDepth, currentLength, cache = null) {',
    '''function findShorterEquivalentSegment(
  startPattern,
  targetPattern,
  maxDepth,
  currentLength,
  cache = null,
  moveNames = null,
) {''',
)
replace_once(
    '''  const cacheKey = `${startKey}|${targetKey}|${Math.floor(maxDepth)}|${Math.floor(currentLength)}`;
  const effectiveCache = cache || moduleInsertionReplacementCache;''',
    '''  const effectiveMoveNames = Array.isArray(moveNames) && moveNames.length
    ? moveNames
    : FMC_INSERTION_MOVE_NAMES;
  const moveSetKey = effectiveMoveNames.join(",");
  const cacheKey = `${startKey}|${targetKey}|${Math.floor(maxDepth)}|${Math.floor(currentLength)}|${moveSetKey}`;
  const effectiveCache = cache || moduleInsertionReplacementCache;''',
)
replace_once(
    '''  const forwardMap = buildPatternFrontier(startPattern, forwardDepth, "forward");
  const backwardMap = buildPatternFrontier(targetPattern, backwardDepth, "backward");''',
    '''  const forwardMap = buildPatternFrontier(startPattern, forwardDepth, "forward", effectiveMoveNames);
  const backwardMap = buildPatternFrontier(targetPattern, backwardDepth, "backward", effectiveMoveNames);''',
)

anchor = '''function buildPatternStates(scramblePattern, moves) {'''
dr_flip_helpers = r'''
const FMC_DR_FLIP_MOVE_NAMES = Object.freeze({
  UD: Object.freeze(["U", "U'", "U2", "D", "D'", "D2", "R2", "L2", "F2", "B2"]),
  FB: Object.freeze(["F", "F'", "F2", "B", "B'", "B2", "U2", "D2", "R2", "L2"]),
  RL: Object.freeze(["R", "R'", "R2", "L", "L'", "L2", "U2", "D2", "F2", "B2"]),
});

function getDrFlipBoundary(candidate) {
  if (!candidate || !Array.isArray(candidate.moves) || candidate.moves.length < 4) return null;
  if (Array.isArray(candidate.premoveMoves) && candidate.premoveMoves.length) return null;
  const sourceText = `${candidate.source || ""} ${candidate.baseSource || ""}`;
  if (/MULTI_NISS/.test(sourceText)) return null;
  const eoMoves = Array.isArray(candidate.eoMoves) ? candidate.eoMoves : [];
  const drMoves = Array.isArray(candidate.drMoves) ? candidate.drMoves : [];
  const finishMoves = Array.isArray(candidate.finishMoves) ? candidate.finishMoves : [];
  if (!drMoves.length || !finishMoves.length) return null;
  const isNiss = /NISS/.test(sourceText);
  const boundary = isNiss ? finishMoves.length : eoMoves.length + drMoves.length;
  if (boundary <= 0 || boundary >= candidate.moves.length) return null;
  return { boundary, isNiss };
}

function buildDrFlipCandidates(scramblePattern, candidate, options = {}) {
  const boundaryInfo = getDrFlipBoundary(candidate);
  if (!scramblePattern || !boundaryInfo) {
    return { candidates: [], windowsTested: 0 };
  }
  const maxSide = Number.isFinite(options.maxSide) ? Math.max(1, Math.min(5, Math.floor(options.maxSide))) : 4;
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(2, Math.min(8, Math.floor(options.maxDepth))) : 6;
  const resultLimit = Number.isFinite(options.resultLimit)
    ? Math.max(1, Math.min(8, Math.floor(options.resultLimit)))
    : 4;
  const moves = candidate.moves.slice();
  const states = buildPatternStates(scramblePattern, moves);
  const axisName = candidate.axisName in FMC_DR_FLIP_MOVE_NAMES ? candidate.axisName : "UD";
  const allowedMoves = FMC_DR_FLIP_MOVE_NAMES[axisName];
  const windows = [];
  for (let left = 1; left <= Math.min(maxSide, boundaryInfo.boundary); left += 1) {
    for (let right = 1; right <= Math.min(maxSide, moves.length - boundaryInfo.boundary); right += 1) {
      const start = boundaryInfo.boundary - left;
      const end = boundaryInfo.boundary + right;
      const length = end - start;
      if (length < 3 || length > maxDepth + 2) continue;
      windows.push({ start, end, length, balance: Math.abs(left - right) });
    }
  }
  windows.sort((a, b) => b.length - a.length || a.balance - b.balance || a.start - b.start);

  const rewritten = [];
  let windowsTested = 0;
  for (const window of windows) {
    const searchDepth = Math.min(maxDepth, window.length - 1);
    if (searchDepth < 2) continue;
    windowsTested += 1;
    const replacement = findShorterEquivalentSegment(
      states[window.start],
      states[window.end],
      searchDepth,
      window.length,
      null,
      allowedMoves,
    );
    if (!Array.isArray(replacement) || replacement.length >= window.length) continue;
    const fullMoves = simplifyMoves([
      ...moves.slice(0, window.start),
      ...replacement,
      ...moves.slice(window.end),
    ]);
    if (!fullMoves.length || fullMoves.length >= candidate.moveCount) continue;
    const originalWindow = moves.slice(window.start, window.end);
    const drFlip = {
      axisName,
      boundary: boundaryInfo.boundary,
      position: window.start,
      originalMoves: originalWindow,
      replacementMoves: replacement,
      originalLength: originalWindow.length,
      replacementLength: replacement.length,
      saving: candidate.moveCount - fullMoves.length,
    };
    const transformed = createCandidate(
      `FMC_DR_FLIP_${candidate.source || "WASM"}`,
      {
        tag: `DR_FLIP_${candidate.strategy || "wasm"}`,
        axisName: candidate.axisName,
        eoLength: candidate.eoLength,
        drLength: candidate.drLength,
        p2Length: candidate.p2Length,
        eoMoves: candidate.eoMoves,
        drMoves: candidate.drMoves,
        finishMoves: candidate.finishMoves,
        premoveMoves: candidate.premoveMoves,
        skeletonMoves: candidate.skeletonMoves,
        insertionBaseMoves: candidate.insertionBaseMoves,
        skeletonKind: candidate.skeletonKind,
        insertionMoves: candidate.insertionMoves,
        insertionPosition: candidate.insertionPosition,
        insertions: candidate.insertions,
        rawInsertionMoveCount: candidate.rawInsertionMoveCount,
        cancellationCount: candidate.cancellationCount,
        baseSource: candidate.source || candidate.baseSource || "",
        drFlip,
      },
      fullMoves,
    );
    if (transformed) pushRankedUniqueCandidate(rewritten, transformed, resultLimit);
  }
  return { candidates: rewritten, windowsTested };
}

'''
replace_once(anchor, dr_flip_helpers + anchor)

replace_once(
    '''    baseSource: metadata.baseSource || "",
    moves: normalized,''',
    '''    baseSource: metadata.baseSource || "",
    drFlip: metadata.drFlip && typeof metadata.drFlip === "object" ? metadata.drFlip : null,
    moves: normalized,''',
)
replace_once(
    '''  pushSummary("DR", candidate.drMoves, candidate.drLength, [candidate.rzpUsed ? "RZP" : "", sideNote].filter(Boolean).join(", "));
  if (isHtr) pushSummary("HTR", [], 0, sideNote);''',
    '''  pushSummary("DR", candidate.drMoves, candidate.drLength, [candidate.rzpUsed ? "RZP" : "", sideNote].filter(Boolean).join(", "));
  if (candidate.drFlip) {
    const originalMoves = Array.isArray(candidate.drFlip.originalMoves) ? candidate.drFlip.originalMoves : [];
    const replacementMoves = Array.isArray(candidate.drFlip.replacementMoves) ? candidate.drFlip.replacementMoves : [];
    pushSummary(
      "DR flip",
      replacementMoves,
      replacementMoves.length,
      `${joinMoves(originalMoves)} → ${joinMoves(replacementMoves)} (-${Math.max(0, originalMoves.length - replacementMoves.length)})`,
    );
  }
  if (isHtr) pushSummary("HTR", [], 0, sideNote);''',
)
replace_once(
    '''        enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      }),''',
    '''        enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
        enableDrFlip: options.enableDrFlip === true,
      }),''',
)
replace_once(
    '''          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
        }),''',
    '''          enableSliceInsertion: searchLevel >= 2,
          enableMultiInsertion: searchLevel >= 3,
          enableDrFlip: searchLevel >= 3,
        }),''',
)
replace_once(
    '''          rawExplorationLimit: _rawExplorationLimit,
          reservedCompression: _reservedCompression,
          ...wasmQualityOptions''',
    '''          rawExplorationLimit: _rawExplorationLimit,
          reservedCompression: _reservedCompression,
          enableDrFlip: _enableDrFlip,
          ...wasmQualityOptions''',
)
replace_once(
    '''          multiInsertion: stageOptions.enableMultiInsertion === true,
          multiInsertionTransitionCount:''',
    '''          multiInsertion: stageOptions.enableMultiInsertion === true,
          drFlip: qualityStage.options.enableDrFlip === true,
          drFlipWindowCount: 0,
          drFlipCandidateCount: 0,
          drFlipElapsedMs: 0,
          multiInsertionTransitionCount:''',
)
replace_once(
    '''      const wasmStages = buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp);
      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {''',
    '''      const wasmStages = buildFmcWasmQualityStages(qualityMode, options, maxPremoveSets, forceRzp);
      let drFlipScramblePattern = null;
      if (qualityMode === "extreme" && wasmStages.some((stage) => stage.options.enableDrFlip === true)) {
        const solvedPattern = await getSolvedPattern();
        drFlipScramblePattern = solvedPattern.applyAlg(scramble);
      }
      for (let stageIndex = 0; stageIndex < wasmStages.length; stageIndex += 1) {''',
)
replace_once(
    '''        if (wasmResult?.ok && Array.isArray(wasmResult.candidates)) {
          for (const wc of wasmResult.candidates) {''',
    '''        const stageCreatedCandidates = [];
        if (wasmResult?.ok && Array.isArray(wasmResult.candidates)) {
          for (const wc of wasmResult.candidates) {''',
)
replace_once(
    '''            if (candidate) {
              trackCandidate(candidate);''',
    '''            if (candidate) {
              stageCreatedCandidates.push(candidate);
              trackCandidate(candidate);''',
)
replace_once(
    '''        notify({ type: "fallback_done", stageName: `FMC ${qualityStage.name}` });''',
    '''        if (qualityStage.options.enableDrFlip === true && drFlipScramblePattern) {
          const drFlipStartedAt = Date.now();
          let drFlipWindowCount = 0;
          let drFlipCandidateCount = 0;
          const drFlipInputs = stageCreatedCandidates
            .slice()
            .sort(compareFmcCandidatePriority)
            .slice(0, 6);
          for (const inputCandidate of drFlipInputs) {
            if (remainingMs(deadlineTs) <= 250) break;
            const flipResult = buildDrFlipCandidates(drFlipScramblePattern, inputCandidate, {
              maxSide: 4,
              maxDepth: 6,
              resultLimit: 4,
            });
            drFlipWindowCount += flipResult.windowsTested;
            for (const flipCandidate of flipResult.candidates) {
              trackCandidate(flipCandidate);
              drFlipCandidateCount += 1;
              if (qualityMode === "extreme") {
                const stageBucket = extremeStageCandidateBuckets.get(qualityStage.name) || [];
                pushRankedUniqueCandidate(stageBucket, flipCandidate, 12);
                extremeStageCandidateBuckets.set(qualityStage.name, stageBucket);
              }
            }
          }
          const stageDiagnostic = diagnostics.wasmStages[diagnostics.wasmStages.length - 1];
          if (stageDiagnostic) {
            stageDiagnostic.drFlipWindowCount = drFlipWindowCount;
            stageDiagnostic.drFlipCandidateCount = drFlipCandidateCount;
            stageDiagnostic.drFlipElapsedMs = Date.now() - drFlipStartedAt;
          }
        }

        notify({ type: "fallback_done", stageName: `FMC ${qualityStage.name}` });''',
)

path.write_text(text)
