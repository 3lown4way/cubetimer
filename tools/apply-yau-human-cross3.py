from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Replace the generic 'three paired target edges' Yau planner with a true
# first-3-cross-edge planner: each selected cross dedge must be paired AND in
# its solved cross slot before moving to the next one.  In the canonical D
# frame, Uw/Dw are exactly the two working-slice families that appear as Rw/Lw
# once the cross center is held on the left for the human presentation.
# ---------------------------------------------------------------------------
p = Path("solver/edgePairing444.js")
s = p.read_text()
pattern = re.compile(
    r"export async function solveYauCross3Natural444\(publicScramble, publicSetupSolution, targetTypeMask, options = \{\}\) \{.*?\n\}\n\nfunction buildSegment",
    re.S,
)
replacement = r'''function humanYauCrossWorkingFamilies444(model) {
  // solve444 canonicalizes Yau to a D-cross physical frame.  When that D
  // center is presented on the left, physical U/D wide turns become the two
  // human L/R working slices.  Do not let the planner jump to F/B or x-axis
  // working slices just because a generic search finds them shorter.
  return model.sliceFamilies.filter((family) => {
    const face = String(family?.openMoves?.[0] || "")[0];
    return face === "U" || face === "D";
  });
}

function humanYauCrossCycleCost444(found) {
  const moves = Array.isArray(found?.moves) ? found.moves : [];
  let cost = moves.length * 100;
  for (const move of moves) {
    const face = String(move || "")[0];
    if (face === "B") cost += 24;
    if (String(move || "").endsWith("2")) cost += 3;
  }
  return cost;
}

export async function solveYauCross3Natural444(publicScramble, publicSetupSolution, targetTypeMask, options = {}) {
  const globalDeadlineTs = Number(options?.deadlineTs) || 0;
  const budgetMs = Math.max(250, Math.min(3200, Number(options?.timeBudgetMs) || 1800));
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

  const workingFamilies = humanYauCrossWorkingFamilies444(model);
  if (workingFamilies.length !== 2) {
    return {
      ok: false,
      reason: "444_YAU_HUMAN_CROSS3_WORKING_SLICE_FRAME_FAILED",
      detail: JSON.stringify(workingFamilies.map((family) => family?.openMoves || [])),
    };
  }

  let solvedMask = solvedEdgeTypeMask(state) & targetMask;
  let solvedCount = bitCount(solvedMask);
  if (solvedCount > 3) {
    return { ok: false, reason: "444_YAU_HUMAN_CROSS3_OVERSHOOT_START" };
  }

  const moves = [];
  const steps = [];
  while (solvedCount < 3 && !deadlineReached(localDeadlineTs)) {
    const nextSolvedCount = solvedCount + 1;
    let best = null;

    // Human Yau does not make three arbitrary paired white dedges and sort
    // them later.  Pick one unsolved cross edge, pair it, and insert it into
    // its correct cross slot before choosing the next edge.
    for (let edgeType = 0; edgeType < 12; edgeType += 1) {
      const bit = 1 << edgeType;
      if (!(targetMask & bit) || (solvedMask & bit)) continue;
      const requiredSolvedMask = solvedMask | bit;

      for (let familyIndex = 0; familyIndex < workingFamilies.length; familyIndex += 1) {
        if (deadlineReached(localDeadlineTs)) break;
        const family = workingFamilies[familyIndex];
        const found = searchSliceCycle(
          state,
          solvedMask,
          nextSolvedCount,
          family,
          model,
          localDeadlineTs,
          6,
          requiredSolvedMask,
          {
            targetTypeMask: targetMask,
            exactTargetCount: false,
            protectedCenterFaces,
            requireAllCenters: false,
          },
        );
        if (!found) continue;

        const foundSolvedMask = solvedEdgeTypeMask(found.state) & targetMask;
        if (!maskContains(foundSolvedMask, requiredSolvedMask)) continue;
        // Exactly one new cross edge is committed per human step.  An
        // accidental fourth cross edge would remove the working keyhole for
        // the next-centers step, so reject that overshoot here.
        if (bitCount(foundSolvedMask) !== nextSolvedCount) continue;

        const candidate = {
          ...found,
          edgeType,
          familyIndex,
          solvedMask: foundSolvedMask,
          cost: humanYauCrossCycleCost444(found),
        };
        if (!best || candidate.cost < best.cost) best = candidate;
      }
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
      workingSlice: best.moves[0],
      moveCount: best.moves.length,
      solvedCrossCount: solvedCount,
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
    raise SystemExit(f"cross3 function replacement count={count}")
p.write_text(ns)


# ---------------------------------------------------------------------------
# Yau must no longer silently fall back to the generic center-preserving edge
# macro search. If the human first-3-cross path fails in one canonical y-spin,
# let the outer frame retry try another spin instead of returning fake Yau.
# ---------------------------------------------------------------------------
p = Path("solver/solver444.js")
s = p.read_text()
old = '''  if (!cross3) {
    cross3 = await edgeModule.solveTargetEdgeTypes444(
      publicScramble, firstTwoCenters, targetTypeMask,
      {
        targetCount: 3, deadlineTs, maxMacros: 8, postSequence: remainingCenters,
        enableRescue: options?.__yauFastFrameProbe !== true,
        projectTargetState: options?.__yauFastFrameProbe === true,
      },
    );
  }
  if (!cross3?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS3_FAILED", cross3?.reason || cross3?.detail, deadlineTs);
  }
'''
new = '''  if (!cross3?.ok) {
    return yauFailure444(
      reduction,
      "444_YAU_HUMAN_CROSS3_FAILED",
      naturalCross3FallbackReason || cross3?.reason || cross3?.detail || "HUMAN_CROSS3_REQUIRED",
      deadlineTs,
    );
  }
'''
s = replace_once(s, old, new, "remove generic Yau cross3 fallback")
s = replace_once(
    s,
    '''        timeBudgetMs: options?.__yauFastFrameProbe === true ? 650 : 1400,''',
    '''        timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 2400,''',
    "human cross3 budget",
)
s = replace_once(
    s,
    '''      yauNaturalCross3Applied: naturalCross3Applied,
      yauNaturalCross3FallbackReason: naturalCross3FallbackReason,''',
    '''      yauNaturalCross3Applied: naturalCross3Applied,
      yauHumanCross3Applied: naturalCross3Applied && cross3.method === "Yau Human Cross 3/4",
      yauNaturalCross3FallbackReason: naturalCross3FallbackReason,''',
    "human cross3 meta",
)
p.write_text(s)


# ---------------------------------------------------------------------------
# Strengthen the regression: after First 3 Cross Edges, three cross dedges must
# already be in their correct slots, not merely paired somewhere.  In the
# humanized cross-left presentation, all wide working turns must be Lw/Rw.
# ---------------------------------------------------------------------------
p = Path("tools/verify-444-yau.mjs")
s = p.read_text()
s = replace_once(
    s,
    '''    assert.equal(result.meta.yauCross3Method, "Yau Natural Slice Cross 3/4");
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 14);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);''',
    '''    assert.equal(result.meta.yauCross3Method, "Yau Human Cross 3/4");
    assert.equal(result.meta.yauHumanCross3Applied, true);
    assert.ok(Number(result.meta.yauCross3MoveCount) <= 24);
    assert.ok(Number(result.meta.yauProtectedCenterSearchMs) >= 0);''',
    "human Yau method assertion",
)
s = replace_once(
    s,
    '''  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;
  assert.ok(bitCount(pairedTypeMask(pattern) & targetMask) >= 3, "Yau Cross 3/4 did not pair three cross dedges");
  const cross3Mask = pairedTypeMask(pattern) & targetMask;''',
    '''  const cross3Tokens = String(setup.segments[2].solution || "").trim().split(/\\s+/).filter(Boolean);
  const cross3WideTokens = cross3Tokens.filter((token) => /^[URFDLB]w(?:2|')?$/.test(token));
  assert.ok(cross3WideTokens.length >= 2, "human Yau Cross 3/4 did not use a working slice");
  assert.ok(
    cross3WideTokens.every((token) => /^[LR]w(?:2|')?$/.test(token)),
    `human Yau Cross 3/4 used a non-L/R working slice: ${cross3WideTokens.join(" ")}`,
  );
  pattern = setup.segments[2].solution ? pattern.applyAlg(setup.segments[2].solution) : pattern;
  assert.equal(
    bitCount(solvedTypeMask(pattern) & targetMask),
    3,
    "Yau Cross 3/4 must place three paired dedges directly into their correct cross slots",
  );
  const cross3Mask = solvedTypeMask(pattern) & targetMask;''',
    "cross3 solved-position contract",
)
p.write_text(s)

print("human Yau first-3-cross patch applied")
