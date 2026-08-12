from pathlib import Path
import re

edge_path = Path('solver/edgePairing444.js')
s = edge_path.read_text()
pattern = re.compile(r'export async function solveYauCross3Natural444\(publicScramble, publicSetupSolution, targetTypeMask, options = \{\}\) \{.*?\n\}\n\nfunction buildSegment', re.S)
replacement = r'''export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(350, Math.min(5600, Number(options?.timeBudgetMs) || 4200));
  const startedAt = Date.now();
  const localDeadlineTs = globalDeadlineTs > 0
    ? Math.min(globalDeadlineTs, startedAt + budgetMs)
    : startedAt + budgetMs;
  const model = await getPlannerModel();
  let pattern = model.solved;
  if (publicScramble) pattern = pattern.applyAlg(String(publicScramble));
  if (publicSetupSolution) pattern = pattern.applyAlg(String(publicSetupSolution));
  const initialState = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces)
    ? options.protectedCenterFaces
    : ["D", "U"];
  if (!protectedCenterFacesSolved444(initialState, model, protectedCenterFaces)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_CENTERS_NOT_READY" };
  }
  if (!humanYauCrossMacros444(model).length) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_MACRO_BANK_EMPTY" };
  }

  const initialSolvedMask = solvedEdgeTypeMask(initialState) & targetMask;
  const initialSolvedCount = bitCount(initialSolvedMask);
  if (initialSolvedCount > 3) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_OVERSHOOT_START" };
  }
  if (initialSolvedCount === 3) {
    return {
      ok: true,
      reason: null,
      solution: "",
      moveCount: 0,
      lockedTypeMask: initialSolvedMask,
      pairedTargetMask: pairedEdgeTypeMask(initialState) & targetMask,
      solvedTargetMask: initialSolvedMask,
      humanStepCount: 0,
      steps: [],
      elapsedMs: Date.now() - startedAt,
      method: "Yau Human Cross 3/4",
      firstEdgeLookaheadUsed: false,
    };
  }

  // Do not commit to the locally cheapest first spoke immediately.  Gather one
  // best human insertion for each possible first cross edge, then greedily
  // finish the remaining two from each of the best few starts.  This is a
  // bounded one-step lookahead: unlike the rejected full beam it cannot branch
  // exponentially, but it avoids the common 8 + 8 + 8 awkward greedy chain.
  const firstOptions = [];
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    const bit = 1 << edgeType;
    if (!(targetMask & bit) || (initialSolvedMask & bit)) continue;
    const candidate = humanYauCrossCandidate444(
      initialState,
      initialSolvedMask,
      targetMask,
      edgeType,
      model,
      protectedCenterFaces,
      localDeadlineTs,
    );
    if (candidate) firstOptions.push({ ...candidate, edgeType });
    if (deadlineReached(localDeadlineTs)) break;
  }
  firstOptions.sort((a, b) => a.cost - b.cost || a.moves.length - b.moves.length);
  if (!firstOptions.length) {
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS3_TIMEOUT"
        : "444_YAU_HUMAN_CROSS3_EDGE_NOT_FOUND",
      moveCount: 0,
      solvedCrossCount: initialSolvedCount,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const fastProbe = budgetMs < 1600;
  const branchCount = fastProbe ? 1 : Math.min(3, firstOptions.length);
  let bestComplete = null;

  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    if (deadlineReached(localDeadlineTs)) break;
    const first = firstOptions[branchIndex];
    const now = Date.now();
    const branchCapMs = branchIndex === 0 ? 2400 : 850;
    const branchDeadlineTs = Math.min(localDeadlineTs, now + branchCapMs);
    let state = first.state;
    let solvedMask = first.solvedMask;
    let solvedCount = bitCount(solvedMask);
    const moves = [...first.moves];
    const steps = [{
      edgeType: first.edgeType,
      workingSlice: first.workingSlice,
      moveCount: first.moves.length,
      solvedCrossCount: solvedCount,
      macro: first.macro,
    }];
    let totalCost = first.cost;
    let lastWorkingFace = String(first.workingSlice || "")[0] || "";

    while (solvedCount < 3 && !deadlineReached(branchDeadlineTs)) {
      let bestNext = null;
      for (let edgeType = 0; edgeType < 12; edgeType += 1) {
        const bit = 1 << edgeType;
        if (!(targetMask & bit) || (solvedMask & bit)) continue;
        const candidate = humanYauCrossCandidate444(
          state,
          solvedMask,
          targetMask,
          edgeType,
          model,
          protectedCenterFaces,
          branchDeadlineTs,
        );
        if (!candidate) continue;
        const workingFace = String(candidate.workingSlice || "")[0] || "";
        const switchPenalty = lastWorkingFace && workingFace && lastWorkingFace !== workingFace ? 28 : 0;
        const continuationCost = candidate.cost + switchPenalty;
        if (!bestNext || continuationCost < bestNext.continuationCost) {
          bestNext = { ...candidate, edgeType, workingFace, continuationCost };
        }
      }
      if (!bestNext) break;
      state = bestNext.state;
      solvedMask = bestNext.solvedMask;
      solvedCount = bitCount(solvedMask);
      moves.push(...bestNext.moves);
      totalCost += bestNext.continuationCost;
      lastWorkingFace = bestNext.workingFace || lastWorkingFace;
      steps.push({
        edgeType: bestNext.edgeType,
        workingSlice: bestNext.workingSlice,
        moveCount: bestNext.moves.length,
        solvedCrossCount: solvedCount,
        macro: bestNext.macro,
      });
    }

    if (solvedCount !== 3) continue;
    const result = {
      state,
      solvedMask,
      moves,
      steps,
      totalCost,
      branchIndex,
    };
    if (
      !bestComplete ||
      result.totalCost < bestComplete.totalCost ||
      (result.totalCost === bestComplete.totalCost && result.moves.length < bestComplete.moves.length)
    ) {
      bestComplete = result;
    }
  }

  if (!bestComplete) {
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS3_TIMEOUT"
        : "444_YAU_HUMAN_CROSS3_EDGE_NOT_FOUND",
      moveCount: 0,
      solvedCrossCount: initialSolvedCount,
      elapsedMs: Date.now() - startedAt,
    };
  }

  // Each committed edge insertion was individually simplified by the candidate
  // builder. Preserve those boundaries so presentation can regrip between them.
  const solutionMoves = [...bestComplete.moves];
  const solution = solutionMoves.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedSolvedMask = solvedEdgeTypeMask(verifiedState) & targetMask;
  const verifiedPairedMask = pairedEdgeTypeMask(verifiedState) & targetMask;
  if (
    bitCount(verifiedSolvedMask) !== 3 ||
    !maskContains(verifiedPairedMask, verifiedSolvedMask) ||
    !protectedCenterFacesSolved444(verifiedState, model, protectedCenterFaces)
  ) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_VERIFY_FAILED" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: solutionMoves.length,
    lockedTypeMask: verifiedSolvedMask,
    pairedTargetMask: verifiedPairedMask,
    solvedTargetMask: verifiedSolvedMask,
    humanStepCount: bestComplete.steps.length,
    steps: bestComplete.steps,
    elapsedMs: Date.now() - startedAt,
    method: "Yau Human Cross 3/4",
    firstEdgeLookaheadUsed: branchCount > 1,
    firstEdgeCandidateCount: firstOptions.length,
    selectedFirstCandidateRank: bestComplete.branchIndex + 1,
  };
}

function buildSegment'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Cross3 first-lookahead replacement count {n}')
edge_path.write_text(s)

solver_path = Path('solver/solver444.js')
solver = solver_path.read_text()
old_budget = '''        timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 2400,
'''
new_budget = '''        timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 4200,
'''
if old_budget not in solver:
    raise SystemExit('Cross3 time budget anchor missing')
solver = solver.replace(old_budget, new_budget, 1)

meta_anchor = '''      yauCross3Method: String(cross3.method || "Yau Cross Edges"),
      yauNaturalCross3Applied: naturalCross3Applied,
'''
meta_new = '''      yauCross3Method: String(cross3.method || "Yau Cross Edges"),
      yauCross3FirstEdgeLookaheadUsed: cross3.firstEdgeLookaheadUsed === true,
      yauCross3FirstEdgeCandidateCount: Number(cross3.firstEdgeCandidateCount) || 0,
      yauCross3SelectedFirstCandidateRank: Number(cross3.selectedFirstCandidateRank) || 1,
      yauNaturalCross3Applied: naturalCross3Applied,
'''
if meta_anchor not in solver:
    raise SystemExit('Cross3 meta anchor missing')
solver = solver.replace(meta_anchor, meta_new, 1)
solver_path.write_text(solver)
print('added bounded first-edge lookahead for Yau Cross3')
