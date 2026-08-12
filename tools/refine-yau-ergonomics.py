from pathlib import Path

edge_path = Path('solver/edgePairing444.js')
edge = edge_path.read_text()

old_cost = '''function humanYauCrossCandidateCost444(moves, setupLength, hasPost) {
  let cost = moves.length * 100 + setupLength * 10 + (hasPost ? 7 : 0);
  for (const move of moves) {
    const face = String(move || "")[0];
    if (face === "B") cost += 20;
    if (String(move || "").endsWith("2")) cost += 2;
  }
  return cost;
}
'''
new_cost = '''function humanYauCrossCandidateCost444(moves, setupLength, hasPost) {
  // Human execution cost, not just HTM. Back turns are the strongest smell in
  // a visible Yau solve; left turns are legal but mildly less ergonomic than
  // equivalent R/F triggers. Keep move count dominant so we never choose a
  // much longer line merely to avoid one L move.
  let cost = moves.length * 100 + setupLength * 10 + (hasPost ? 7 : 0);
  for (const move of moves) {
    const token = String(move || "");
    const face = token[0];
    if (face === "B") cost += 24;
    else if (face === "L") cost += 8;
    if (/^Bw/.test(token)) cost += 12;
    else if (/^Lw/.test(token)) cost += 4;
    if (token.endsWith("2")) cost += 2;
  }
  return cost;
}
'''
if old_cost not in edge:
    raise SystemExit('human Yau cost anchor missing')
edge = edge.replace(old_cost, new_cost, 1)

anchor = '''export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
'''
if anchor not in edge:
    raise SystemExit('Cross3 export anchor missing')

cross4_fn = r'''export async function solveYauCross4Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(250, Math.min(2200, Number(options?.timeBudgetMs) || 1400));
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
  const requiredMask = Number(options?.requiredTypeMask) >>> 0;

  if (bitCount(targetMask) !== 4 || bitCount(requiredMask) !== 3) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_MASK_INVALID" };
  }
  if (!centersSolved(initialState, model.solvedCompact.centerPieces)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_CENTERS_NOT_READY" };
  }
  if (!maskContains(solvedEdgeTypeMask(initialState), requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_THREE_CROSS_NOT_READY" };
  }

  const macros = humanYauCrossMacros444(model);
  if (!macros.length) return { ok: false, reason: "444_YAU_HUMAN_CROSS4_MACRO_BANK_EMPTY" };

  const postMoves = ["", "U", "U'", "U2", "D", "D'", "D2", ...OUTER_MOVES_444];
  const setupTiers = [
    L2E_SETUP_PATHS.filter((path) => path.length <= 2),
    L2E_SETUP_PATHS.filter((path) => path.length === 3),
  ];
  let best = null;
  let inspected = 0;

  for (let tier = 0; tier < setupTiers.length && !best; tier += 1) {
    for (const setup of setupTiers[tier]) {
      if ((inspected++ & 0x00ff) === 0 && deadlineReached(localDeadlineTs)) break;
      for (const macro of macros) {
        for (const post of postMoves) {
          const rawMoves = [
            ...setup,
            ...splitAlgorithm(macro.algorithm),
            ...(post ? [post] : []),
          ];
          // The already-built three dedges may move around the D cross while
          // inserting #4, but must never split. This mirrors a real Yau insert.
          const finalState = applyTokenPathPreservingPairedTypes444(
            initialState,
            rawMoves,
            model,
            requiredMask,
          );
          if (!finalState) continue;
          if (!centersSolved(finalState, model.solvedCompact.centerPieces)) continue;
          const solvedMask = solvedEdgeTypeMask(finalState) & targetMask;
          if (!maskContains(solvedMask, targetMask)) continue;
          const moves = simplifyOuterSequence(rawMoves);
          const cost = humanYauCrossCandidateCost444(moves, setup.length, Boolean(post));
          if (!best || cost < best.cost) {
            best = { state: finalState, moves, macro: macro.algorithm, cost };
          }
        }
      }
      if (deadlineReached(localDeadlineTs)) break;
    }
  }

  if (!best) {
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS4_TIMEOUT"
        : "444_YAU_HUMAN_CROSS4_NOT_FOUND",
      elapsedMs: Date.now() - startedAt,
    };
  }

  const solution = best.moves.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  if (
    !centersSolved(verifiedState, model.solvedCompact.centerPieces) ||
    !maskContains(solvedEdgeTypeMask(verifiedState), targetMask)
  ) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_VERIFY_FAILED" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: best.moves.length,
    pairedTargetMask: pairedEdgeTypeMask(verifiedState) & targetMask,
    lockedTypeMask: targetMask,
    solvedTargetMask: solvedEdgeTypeMask(verifiedState) & targetMask,
    targetCount: 4,
    macroCount: 1,
    alignmentMoveCount: 0,
    searchRescueUsed: false,
    searchMaxMacros: 1,
    alignmentRescueUsed: false,
    method: "Yau Human Cross 4/4",
    elapsedMs: Date.now() - startedAt,
  };
}

'''
edge = edge.replace(anchor, cross4_fn + anchor, 1)
edge_path.write_text(edge)

solver_path = Path('solver/solver444.js')
solver = solver_path.read_text()
old_cross4 = '''  const cross4 = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    beforeCross4,
    targetTypeMask,
    {
      targetCount: 4,
      requiredTypeMask: cross3.lockedTypeMask,
      alignSolved: true,
      deadlineTs,
      maxMacros: 6,
      enableRescue: options?.__yauFastFrameProbe !== true,
      projectTargetState: options?.__yauFastFrameProbe === true,
    },
  );
  if (!cross4?.ok) {
'''
new_cross4 = '''  let cross4 = await edgeModule.solveYauCross4Natural444(
    publicScramble,
    beforeCross4,
    targetTypeMask,
    {
      requiredTypeMask: cross3.lockedTypeMask,
      deadlineTs,
      timeBudgetMs: options?.__yauFastFrameProbe === true ? 500 : 1500,
    },
  );
  const naturalCross4Applied = cross4?.ok === true;
  const naturalCross4FallbackReason = naturalCross4Applied
    ? null
    : String(cross4?.reason || "444_YAU_HUMAN_CROSS4_NOT_FOUND");
  if (!cross4?.ok) {
    cross4 = await edgeModule.solveTargetEdgeTypes444(
      publicScramble,
      beforeCross4,
      targetTypeMask,
      {
        targetCount: 4,
        requiredTypeMask: cross3.lockedTypeMask,
        alignSolved: true,
        deadlineTs,
        maxMacros: 6,
        enableRescue: options?.__yauFastFrameProbe !== true,
        projectTargetState: options?.__yauFastFrameProbe === true,
      },
    );
  }
  if (!cross4?.ok) {
'''
if old_cross4 not in solver:
    raise SystemExit('Cross4 call anchor missing')
solver = solver.replace(old_cross4, new_cross4, 1)

meta_anchor = '''      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCross4SearchRescueUsed: cross4.searchRescueUsed === true,
'''
meta_replacement = '''      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCross4Method: String(cross4.method || "Yau Cross Edges"),
      yauHumanCross4Applied: naturalCross4Applied,
      yauNaturalCross4FallbackReason: naturalCross4FallbackReason,
      yauCross4SearchRescueUsed: cross4.searchRescueUsed === true,
'''
if meta_anchor not in solver:
    raise SystemExit('Cross4 meta anchor missing')
solver = solver.replace(meta_anchor, meta_replacement, 1)

score_anchor = '''      const score = human.rotationCount * 100000 + tokenCount;
'''
score_replacement = '''      const ergonomicPenalty = human.segments.reduce((sum, segment) => {
        for (const token of splitAlgorithm(segment?.solution)) {
          if (/^[xyz](?:2|')?$/.test(token)) continue;
          if (/^B/.test(token)) sum += 24;
          else if (/^L/.test(token)) sum += 7;
          if (/^Bw/.test(token)) sum += 12;
          else if (/^Lw/.test(token)) sum += 4;
        }
        return sum;
      }, 0);
      // Rotations remain expensive, but one extra yaw is allowed to win when
      // it removes a genuinely ugly block of B/L turns.
      const score = human.rotationCount * 10000 + ergonomicPenalty * 100 + tokenCount;
'''
if score_anchor not in solver:
    raise SystemExit('humanizer score anchor missing')
solver = solver.replace(score_anchor, score_replacement, 1)
solver_path.write_text(solver)

print('refined Yau Cross 4 and human orientation scoring')
