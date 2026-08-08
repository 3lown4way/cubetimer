from pathlib import Path
import re

p = Path("solver/edgePairing444.js")
s = p.read_text()
pattern = re.compile(
    r"function humanYauCrossWorkingFamilies444\(model\) \{.*?\n\}\n\nfunction buildSegment",
    re.S,
)
replacement = r'''function humanYauCrossMacros444(model) {
  return model.seedActions.filter((entry) => {
    const tokens = splitAlgorithm(entry.algorithm);
    const wide = tokens.filter((token) => /^[URFDLB]w(?:2|')?$/.test(token));
    if (wide.length !== 2) return false;
    if (!/^[UD]w/.test(wide[0]) || !/^[UD]w/.test(wide[1])) return false;
    if (wide[0][0] !== wide[1][0]) return false;
    return invertMoveToken(wide[0]) === wide[1];
  });
}

function humanYauCrossCandidateCost444(moves, setupLength, hasPost) {
  let cost = moves.length * 100 + setupLength * 10 + (hasPost ? 7 : 0);
  for (const move of moves) {
    const face = String(move || "")[0];
    if (face === "B") cost += 20;
    if (String(move || "").endsWith("2")) cost += 2;
  }
  return cost;
}

function humanYauCrossCandidate444(
  initialState,
  solvedMask,
  targetMask,
  edgeType,
  model,
  protectedCenterFaces,
  deadlineTs,
) {
  const requiredSolvedMask = solvedMask | (1 << edgeType);
  const nextSolvedCount = bitCount(solvedMask) + 1;
  const macros = humanYauCrossMacros444(model);
  if (!macros.length) return null;

  const evaluate = (state, rawMoves, setupLength, hasPost, macro) => {
    const nextSolvedMask = solvedEdgeTypeMask(state) & targetMask;
    if (!maskContains(nextSolvedMask, requiredSolvedMask)) return null;
    if (bitCount(nextSolvedMask) !== nextSolvedCount) return null;
    if (!protectedCenterFacesSolved444(state, model, protectedCenterFaces)) return null;
    const moves = simplifyOuterSequence(rawMoves);
    return {
      state,
      moves,
      solvedMask: nextSolvedMask,
      macro: macro.algorithm,
      workingSlice: splitAlgorithm(macro.algorithm).find((token) => /^[UD]w/.test(token)) || "",
      cost: humanYauCrossCandidateCost444(moves, setupLength, hasPost),
    };
  };

  let best = null;
  let inspected = 0;
  const postMoves = ["", ...OUTER_MOVES_444];
  const shortSetups = L2E_SETUP_PATHS.filter((path) => path.length <= 2);
  for (const setup of shortSetups) {
    if ((inspected++ & 0x00ff) === 0 && deadlineReached(deadlineTs)) return best;
    const setupState = applyMovePath(initialState, setup, model);
    for (const macro of macros) {
      const macroState = applyCompactAction(setupState, macro.action, true);
      for (const post of postMoves) {
        const finalState = post
          ? applyCompactAction(macroState, model.outerActions.get(post), true)
          : macroState;
        const candidate = evaluate(
          finalState,
          [...setup, ...splitAlgorithm(macro.algorithm), ...(post ? [post] : [])],
          setup.length,
          Boolean(post),
          macro,
        );
        if (candidate && (!best || candidate.cost < best.cost)) best = candidate;
      }
    }
  }
  if (best || deadlineReached(deadlineTs)) return best;

  // A human may need one extra AUF/setup turn before joining the wings.  Keep
  // this rescue structured: at most three outer setup moves, then one verified
  // U/D working-slice pairing/insertion macro.  No arbitrary six-axis beam.
  const deepSetups = L2E_SETUP_PATHS.filter((path) => path.length === 3);
  for (const setup of deepSetups) {
    if ((inspected++ & 0x00ff) === 0 && deadlineReached(deadlineTs)) return best;
    const setupState = applyMovePath(initialState, setup, model);
    for (const macro of macros) {
      const finalState = applyCompactAction(setupState, macro.action, true);
      const candidate = evaluate(
        finalState,
        [...setup, ...splitAlgorithm(macro.algorithm)],
        setup.length,
        false,
        macro,
      );
      if (candidate && (!best || candidate.cost < best.cost)) best = candidate;
    }
  }
  return best;
}

export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(350, Math.min(4200, Number(options?.timeBudgetMs) || 2400));
  const startedAt = Date.now();
  const localDeadlineTs = globalDeadlineTs > 0
    ? Math.min(globalDeadlineTs, startedAt + budgetMs)
    : startedAt + budgetMs;
  const model = await getPlannerModel();
  let pattern = model.solved;
  if (publicScramble) pattern = pattern.applyAlg(String(publicScramble));
  if (publicSetupSolution) pattern = pattern.applyAlg(String(publicSetupSolution));
  let state = compactStateFromPattern(pattern);
  const targetMask = Number(targetTypeMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces)
    ? options.protectedCenterFaces
    : ["D", "U"];
  if (!protectedCenterFacesSolved444(state, model, protectedCenterFaces)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_CENTERS_NOT_READY" };
  }
  if (!humanYauCrossMacros444(model).length) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_MACRO_BANK_EMPTY" };
  }

  let solvedMask = solvedEdgeTypeMask(state) & targetMask;
  let solvedCount = bitCount(solvedMask);
  if (solvedCount > 3) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_OVERSHOOT_START" };
  }

  const moves = [];
  const steps = [];
  while (solvedCount < 3 && !deadlineReached(localDeadlineTs)) {
    let best = null;
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
        localDeadlineTs,
      );
      if (candidate && (!best || candidate.cost < best.cost)) {
        best = { ...candidate, edgeType };
      }
      if (deadlineReached(localDeadlineTs)) break;
    }

    if (!best) {
      return {
        ok: false,
        reason: deadlineReached(localDeadlineTs)
          ? "444_YAU_HUMAN_CROSS3_TIMEOUT"
          : "444_YAU_HUMAN_CROSS3_EDGE_NOT_FOUND",
        moveCount: moves.length,
        solvedCrossCount: solvedCount,
        elapsedMs: Date.now() - startedAt,
      };
    }

    state = best.state;
    solvedMask = best.solvedMask;
    solvedCount = bitCount(solvedMask);
    moves.push(...best.moves);
    steps.push({
      edgeType: best.edgeType,
      workingSlice: best.workingSlice,
      moveCount: best.moves.length,
      solvedCrossCount: solvedCount,
      macro: best.macro,
    });
  }

  const simplified = simplifyOuterSequence(moves);
  const solution = simplified.join(" ");
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
    moveCount: simplified.length,
    lockedTypeMask: verifiedSolvedMask,
    pairedTargetMask: verifiedPairedMask,
    solvedTargetMask: verifiedSolvedMask,
    humanStepCount: steps.length,
    steps,
    elapsedMs: Date.now() - startedAt,
    method: "Yau Human Cross 3/4",
  };
}

function buildSegment'''
ns, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise SystemExit(f"refine human cross3 replacement count={count}")
p.write_text(ns)
print("refined human Yau Cross 3 planner")
