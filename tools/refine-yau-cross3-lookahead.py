from pathlib import Path
import re

p = Path('solver/edgePairing444.js')
s = p.read_text()

# Replace the single-best candidate helper with an alternatives helper plus the
# original single-best wrapper so Cross4/fallback callers remain compatible.
start = s.index('function humanYauCrossCandidate444(')
end = s.index('\nexport async function solveYauCross4Natural444', start)
new = r'''function humanYauCrossCandidateAlternatives444(
  initialState,
  solvedMask,
  targetMask,
  edgeType,
  model,
  protectedCenterFaces,
  deadlineTs,
  limit = 4,
) {
  const requiredSolvedMask = solvedMask | (1 << edgeType);
  const nextSolvedCount = bitCount(solvedMask) + 1;
  const macros = humanYauCrossMacros444(model);
  if (!macros.length) return [];
  const candidates = new Map();

  const evaluate = (state, rawMoves, setupLength, hasPost, macro) => {
    const nextSolvedMask = solvedEdgeTypeMask(state) & targetMask;
    if (!maskContains(nextSolvedMask, requiredSolvedMask)) return;
    if (bitCount(nextSolvedMask) !== nextSolvedCount) return;
    if (!protectedCenterFacesSolved444(state, model, protectedCenterFaces)) return;
    const moves = simplifyOuterSequence(rawMoves);
    const workingSlice = splitAlgorithm(macro.algorithm).find((token) => /^[UD]w/.test(token)) || "";
    const candidate = {
      state,
      moves,
      solvedMask: nextSolvedMask,
      macro: macro.algorithm,
      workingSlice,
      cost: humanYauCrossCandidateCost444(moves, setupLength, hasPost),
    };
    const key = compactStateKey(state, true);
    const previous = candidates.get(key);
    if (!previous || candidate.cost < previous.cost) candidates.set(key, candidate);
  };

  let inspected = 0;
  const postMoves = ["", ...OUTER_MOVES_444];
  const runSetups = (setups, allowPost) => {
    for (const setup of setups) {
      if ((inspected++ & 0x00ff) === 0 && deadlineReached(deadlineTs)) break;
      const setupState = applyMovePath(initialState, setup, model);
      for (const macro of macros) {
        const macroState = applyCompactAction(setupState, macro.action, true);
        if (allowPost) {
          for (const post of postMoves) {
            const finalState = post
              ? applyCompactAction(macroState, model.outerActions.get(post), true)
              : macroState;
            evaluate(
              finalState,
              [...setup, ...splitAlgorithm(macro.algorithm), ...(post ? [post] : [])],
              setup.length,
              Boolean(post),
              macro,
            );
          }
        } else {
          evaluate(
            macroState,
            [...setup, ...splitAlgorithm(macro.algorithm)],
            setup.length,
            false,
            macro,
          );
        }
      }
    }
  };

  runSetups(L2E_SETUP_PATHS.filter((path) => path.length <= 2), true);
  if (!candidates.size && !deadlineReached(deadlineTs)) {
    runSetups(L2E_SETUP_PATHS.filter((path) => path.length === 3), false);
  }

  return [...candidates.values()]
    .sort((a, b) => a.cost - b.cost || a.moves.length - b.moves.length)
    .slice(0, Math.max(1, limit));
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
  return humanYauCrossCandidateAlternatives444(
    initialState,
    solvedMask,
    targetMask,
    edgeType,
    model,
    protectedCenterFaces,
    deadlineTs,
    1,
  )[0] || null;
}
'''
s = s[:start] + new + s[end:]

pattern = re.compile(r'export async function solveYauCross3Natural444\(publicScramble, publicSetupSolution, targetTypeMask, options = \{\}\) \{.*?\n\}\n\nfunction buildSegment', re.S)
replacement = r'''export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(350, Math.min(5200, Number(options?.timeBudgetMs) || 3000));
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
    };
  }

  let beam = [{
    state: initialState,
    solvedMask: initialSolvedMask,
    moves: [],
    steps: [],
    cost: 0,
    lastWorkingFace: "",
  }];
  const targetSteps = 3 - initialSolvedCount;

  for (let depth = 0; depth < targetSteps && beam.length && !deadlineReached(localDeadlineTs); depth += 1) {
    const next = new Map();
    for (const node of beam) {
      for (let edgeType = 0; edgeType < 12; edgeType += 1) {
        const bit = 1 << edgeType;
        if (!(targetMask & bit) || (node.solvedMask & bit)) continue;
        const alternatives = humanYauCrossCandidateAlternatives444(
          node.state,
          node.solvedMask,
          targetMask,
          edgeType,
          model,
          protectedCenterFaces,
          localDeadlineTs,
          4,
        );
        for (const candidate of alternatives) {
          const workingFace = String(candidate.workingSlice || "")[0] || "";
          const sliceSwitchPenalty = node.lastWorkingFace && workingFace && node.lastWorkingFace !== workingFace
            ? 35
            : 0;
          const totalCost = node.cost + candidate.cost + sliceSwitchPenalty;
          const steps = [...node.steps, {
            edgeType,
            workingSlice: candidate.workingSlice,
            moveCount: candidate.moves.length,
            solvedCrossCount: bitCount(candidate.solvedMask),
            macro: candidate.macro,
          }];
          const entry = {
            state: candidate.state,
            solvedMask: candidate.solvedMask,
            moves: [...node.moves, ...candidate.moves],
            steps,
            cost: totalCost,
            lastWorkingFace: workingFace || node.lastWorkingFace,
          };
          const key = `${candidate.solvedMask}:${compactStateKey(candidate.state, true)}`;
          const previous = next.get(key);
          if (!previous || entry.cost < previous.cost) next.set(key, entry);
        }
        if (deadlineReached(localDeadlineTs)) break;
      }
      if (deadlineReached(localDeadlineTs)) break;
    }
    beam = [...next.values()]
      .sort((a, b) => a.cost - b.cost || a.moves.length - b.moves.length)
      .slice(0, 16);
  }

  const finals = beam
    .filter((node) => bitCount(node.solvedMask) === 3)
    .sort((a, b) => a.cost - b.cost || a.moves.length - b.moves.length);
  const best = finals[0];
  if (!best) {
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

  const simplified = simplifyOuterSequence(best.moves);
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
    humanStepCount: best.steps.length,
    steps: best.steps,
    elapsedMs: Date.now() - startedAt,
    method: "Yau Human Cross 3/4",
  };
}

function buildSegment'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Cross3 solver replacement count {n}')

p.write_text(s)
print('replaced greedy Cross3 with global human insertion lookahead')
