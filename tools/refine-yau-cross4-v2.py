from pathlib import Path
import re

p = Path('solver/edgePairing444.js')
s = p.read_text()
pattern = re.compile(r'export async function solveYauCross4Natural444\(publicScramble, publicSetupSolution, targetTypeMask, options = \{\}\) \{.*?\n\}\n\nexport async function solveYauCross3Natural444', re.S)
replacement = r'''export async function solveYauCross4Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(250, Math.min(2400, Number(options?.timeBudgetMs) || 1500));
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
  if (!maskContains(solvedEdgeTypeMask(initialState), requiredMask)) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_THREE_CROSS_NOT_READY" };
  }

  const missingMask = targetMask & ~requiredMask;
  if (bitCount(missingMask) !== 1) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS4_MISSING_EDGE_INVALID" };
  }
  let missingType = -1;
  for (let edgeType = 0; edgeType < 12; edgeType += 1) {
    if (missingMask & (1 << edgeType)) {
      missingType = edgeType;
      break;
    }
  }

  // Reuse the same structured Yau pairing candidate that builds Cross 3/4:
  // short outer setup -> one U/D working-slice macro -> optional AUF/post.
  // Unlike Remaining Centers, Cross 4/4 is allowed to move the existing three
  // spokes temporarily. The hard requirement is that all centers and all four
  // solved cross dedges are restored at the segment boundary.
  const candidate = humanYauCrossCandidate444(
    initialState,
    requiredMask,
    targetMask,
    missingType,
    model,
    ["U", "R", "F", "D", "L", "B"],
    localDeadlineTs,
  );
  if (!candidate) {
    return {
      ok: false,
      reason: deadlineReached(localDeadlineTs)
        ? "444_YAU_HUMAN_CROSS4_TIMEOUT"
        : "444_YAU_HUMAN_CROSS4_NOT_FOUND",
      elapsedMs: Date.now() - startedAt,
    };
  }

  const solution = candidate.moves.join(" ");
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
    moveCount: candidate.moves.length,
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
    workingSlice: candidate.workingSlice,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function solveYauCross3Natural444'''
s, n = pattern.subn(replacement, s, count=1)
if n != 1:
    raise SystemExit(f'Cross4 replacement count {n}')
p.write_text(s)

# Show whether the human Cross4 path actually won in the temporary diagnostic.
d = Path('tools/diag-yau-ergonomics.mjs')
t = d.read_text()
old = '''    yauCrossRestoreMoveCount: result.meta?.yauCrossRestoreMoveCount,
    yauLastEightOnly: result.meta?.yauLastEightOnly,
    edgeSearchMs: result.meta?.edgeSearchMs,
'''
new = '''    yauCrossRestoreMoveCount: result.meta?.yauCrossRestoreMoveCount,
    yauLastEightOnly: result.meta?.yauLastEightOnly,
    yauHumanCross4Applied: result.meta?.yauHumanCross4Applied,
    yauCross4Method: result.meta?.yauCross4Method,
    yauNaturalCross4FallbackReason: result.meta?.yauNaturalCross4FallbackReason,
    edgeSearchMs: result.meta?.edgeSearchMs,
'''
if old not in t:
    raise SystemExit('diagnostic meta anchor missing')
d.write_text(t.replace(old, new, 1))
print('reused Cross3 human pairing candidate for Cross4')
