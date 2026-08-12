from pathlib import Path
import re

p = Path('solver/edgePairing444.js')
s = p.read_text()
pattern = re.compile(r'export async function solveYauCross4Natural444\(publicScramble, publicSetupSolution, targetTypeMask, options = \{\}\) \{.*?\n\}\n\nexport async function solveYauCross3Natural444', re.S)
replacement = r'''export async function solveYauCross4Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(250, Math.min(2600, Number(options?.timeBudgetMs) || 1700));
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

  if (bitCount(targetMask) !== 4 || bitCount(requiredMask) !== 3 || !maskContains(targetMask, requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_MASK_INVALID" };
  }
  if (!centersSolved(initialState, model.solvedCompact.centerPieces)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_CENTERS_NOT_READY" };
  }
  if (!maskContains(pairedEdgeTypeMask(initialState), requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_THREE_CROSS_NOT_PAIRED" };
  }

  // The completed cross itself is the protected 3-2-3 bank in the canonical
  // Yau frame.  Finish Cross 4/4 with one human free-slice cycle and require
  // the cycle boundary to be the fully solved cross.  Existing three spokes
  // may move inside the cycle; there is no separate generic alignment phase.
  const sliceFamily = model.sliceFamilies.find((family) => family.bankMask === targetMask);
  if (!sliceFamily) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_SLICE_FRAME_MISSING" };
  }

  let cycle = searchSliceCycle(
    initialState,
    requiredMask,
    4,
    sliceFamily,
    model,
    localDeadlineTs,
    7,
    targetMask,
    {
      targetTypeMask: targetMask,
      exactTargetCount: true,
      requireAllCenters: true,
      requiredPairedEveryMoveMask: 0,
    },
  );
  if (!cycle && !deadlineReached(localDeadlineTs)) {
    cycle = searchSliceCycle(
      initialState,
      requiredMask,
      4,
      sliceFamily,
      model,
      localDeadlineTs,
      9,
      targetMask,
      {
        targetTypeMask: targetMask,
        exactTargetCount: true,
        requireAllCenters: true,
        requiredPairedEveryMoveMask: 0,
      },
    );
  }

  if (!cycle) {
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS4_TIMEOUT"
        : "444_YAU_HUMAN_CROSS4_NOT_FOUND",
      elapsedMs: Date.now() - startedAt,
    };
  }

  const moves = simplifyOuterSequence(cycle.moves);
  const solution = moves.join(" ");
  let verified = pattern;
  if (solution) verified = verified.applyAlg(solution);
  const verifiedState = compactStateFromPattern(verified);
  const verifiedSolved = solvedEdgeTypeMask(verifiedState) & targetMask;
  if (
    !centersSolved(verifiedState, model.solvedCompact.centerPieces) ||
    !maskContains(verifiedSolved, targetMask)
  ) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_VERIFY_FAILED" };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: moves.length,
    pairedTargetMask: pairedEdgeTypeMask(verifiedState) & targetMask,
    lockedTypeMask: targetMask,
    solvedTargetMask: verifiedSolved,
    targetCount: 4,
    macroCount: 1,
    alignmentMoveCount: 0,
    searchRescueUsed: false,
    searchMaxMacros: 1,
    alignmentRescueUsed: false,
    method: "Yau Human Cross 4/4",
    humanStepCount: 1,
    workingSlice: sliceFamily.openMoves[0][0],
    elapsedMs: Date.now() - startedAt,
  };
}

export async function solveYauCross3Natural444'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Cross4 v3 replacement count {n}')
p.write_text(s)
print('rewrote Cross4 as one solved-boundary free-slice cycle')
