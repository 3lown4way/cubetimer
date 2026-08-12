from pathlib import Path

# --- edgePairing444.js: add atomic cross protection to slice cycles and a new Yau-only last-eight solver.
p = Path('solver/edgePairing444.js')
s = p.read_text()

old = '''  const targetTypeMask = (Number(options?.targetTypeMask) >>> 0) || 0x0fff;
  const exactTargetCount = options?.exactTargetCount === true;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
'''
new = '''  const targetTypeMask = (Number(options?.targetTypeMask) >>> 0) || 0x0fff;
  const exactTargetCount = options?.exactTargetCount === true;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
'''
if old not in s:
    raise SystemExit('searchSliceCycle options anchor missing')
s = s.replace(old, new, 1)

old = '''    let beam = [{
      state: applyCompactAction(initialState, openAction, true),
      path: [],
      lastFace: "",
      score: 0,
    }];
'''
new = '''    const openedState = applyCompactAction(initialState, openAction, true);
    if (
      requiredPairedEveryMoveMask &&
      !maskContains(pairedEdgeTypeMask(openedState), requiredPairedEveryMoveMask)
    ) continue;
    let beam = [{
      state: openedState,
      path: [],
      lastFace: "",
      score: 0,
    }];
'''
if old not in s:
    raise SystemExit('searchSliceCycle opened state anchor missing')
s = s.replace(old, new, 1)

old = '''          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
'''
new = '''          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          if (
            requiredPairedEveryMoveMask &&
            !maskContains(pairedEdgeTypeMask(nextState), requiredPairedEveryMoveMask)
          ) continue;
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
'''
if old not in s:
    raise SystemExit('searchSliceCycle next state anchor missing')
s = s.replace(old, new, 1)

anchor = '''export async function solveEdgePairing323(publicScramble, publicCenterSolution, options = {}) {
'''
if anchor not in s:
    raise SystemExit('solveEdgePairing323 anchor missing')

fresh = r'''function yauRemainingPairedMask444(state, crossMask) {
  return pairedEdgeTypeMask(state) & (0x0fff ^ crossMask);
}

function yauBoundaryOkay444(state, model, crossMask, minimumRemaining = 0) {
  return centersSolved(state, model.solvedCompact.centerPieces) &&
    maskContains(pairedEdgeTypeMask(state), crossMask) &&
    maskContains(solvedEdgeTypeMask(state), crossMask) &&
    bitCount(yauRemainingPairedMask444(state, crossMask)) >= minimumRemaining;
}

function yauLockedMask444(state, crossMask) {
  return crossMask | yauRemainingPairedMask444(state, crossMask);
}

function searchYauLastEightCycle444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
  exactTargetCount = true,
) {
  return searchSliceCycle(
    initialState,
    yauLockedMask444(initialState, crossMask),
    targetRemainingCount,
    sliceFamily,
    model,
    deadlineTs,
    maxOuterMoves,
    crossMask,
    {
      targetTypeMask: 0x0fff ^ crossMask,
      exactTargetCount,
      requireAllCenters: true,
      requiredPairedEveryMoveMask: crossMask,
    },
  );
}

function advanceYauRemainingCount444(
  initialState,
  targetRemainingCount,
  sliceFamily,
  model,
  deadlineTs,
  crossMask,
  maxOuterMoves = 7,
) {
  const currentCount = bitCount(yauRemainingPairedMask444(initialState, crossMask));
  if (currentCount >= targetRemainingCount) {
    return { state: initialState, mask: pairedEdgeTypeMask(initialState), moves: [] };
  }

  // Prefer one clean slice-open / outer-setup / slice-close cycle.  If an
  // exact count is impossible, allowing an overshoot is still recognisably
  // Yau and is better than dropping into a generic commutator beam.
  let result = searchYauLastEightCycle444(
    initialState,
    targetRemainingCount,
    sliceFamily,
    model,
    deadlineTs,
    crossMask,
    maxOuterMoves,
    true,
  );
  if (!result && !deadlineReached(deadlineTs)) {
    result = searchYauLastEightCycle444(
      initialState,
      targetRemainingCount,
      sliceFamily,
      model,
      deadlineTs,
      crossMask,
      maxOuterMoves,
      false,
    );
  }
  return result;
}

export async function solveYauLastEight323444(publicScramble, publicYauSetup, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossMask = Number(options?.crossTypeMask ?? options?.requiredTypeMask) >>> 0;
  const startedAt = Date.now();
  const model = await getPlannerModel();
  if (bitCount(crossMask) !== 4) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_MASK_INVALID", solution: "", segments: [] };
  }
  if (deadlineReached(deadlineTs)) {
    return { ok: false, reason: "444_YAU_LAST8_DEADLINE_REACHED", solution: "", segments: [] };
  }

  let pattern = model.solved;
  const scramble = String(publicScramble || "").trim();
  const setup = String(publicYauSetup || "").trim();
  if (scramble) pattern = pattern.applyAlg(scramble);
  if (setup) pattern = pattern.applyAlg(setup);
  let state = compactStateFromPattern(pattern);

  if (!centersSolved(state, model.solvedCompact.centerPieces)) {
    return { ok: false, reason: "444_YAU_LAST8_CENTERS_NOT_SOLVED", solution: "", segments: [] };
  }
  if (!maskContains(pairedEdgeTypeMask(state), crossMask)) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_NOT_PAIRED", solution: "", segments: [] };
  }
  if (!maskContains(solvedEdgeTypeMask(state), crossMask)) {
    return { ok: false, reason: "444_YAU_LAST8_CROSS_NOT_SOLVED", solution: "", segments: [] };
  }

  // In the canonical solver frame the four solved cross slots are exactly the
  // protected bank of one 3-2-3 slice family.  Human presentation later rotates
  // this frame so the same cross is visually on D.
  const sliceFamily = model.sliceFamilies.find((family) => family.bankMask === crossMask);
  if (!sliceFamily) {
    return { ok: false, reason: "444_YAU_LAST8_WORKING_SLICE_MISSING", solution: "", segments: [] };
  }

  const initialRemainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  const segmentMoves = [];

  // 3: pair the first three of the remaining eight with one true slice cycle.
  let first3 = advanceYauRemainingCount444(
    state, Math.max(3, initialRemainingCount), sliceFamily, model, deadlineTs, crossMask, 7,
  );
  if (!first3) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_FAILED", solution: "", segments: [] };
  }
  state = first3.state;
  if (!yauBoundaryOkay444(state, model, crossMask, 3)) {
    return { ok: false, reason: "444_YAU_LAST8_FIRST3_BOUNDARY_FAILED", solution: "", segments: [] };
  }
  segmentMoves.push({ id: "yau323First3", name: "3-2-3 · First 3", moves: first3.moves, pairStart: 5, pairEnd: 7 });

  // 2: prefer pairing the next two in one cycle. If that exact cycle is not
  // available, two short Yau cycles are allowed; we never invoke seed macros.
  let next2Moves = [];
  let remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  if (remainingCount < 5) {
    let next2 = advanceYauRemainingCount444(state, 5, sliceFamily, model, deadlineTs, crossMask, 7);
    if (!next2 && remainingCount < 4 && !deadlineReached(deadlineTs)) {
      const firstOfTwo = advanceYauRemainingCount444(state, 4, sliceFamily, model, deadlineTs, crossMask, 6);
      if (firstOfTwo) {
        const secondOfTwo = advanceYauRemainingCount444(firstOfTwo.state, 5, sliceFamily, model, deadlineTs, crossMask, 6);
        if (secondOfTwo) {
          next2 = {
            state: secondOfTwo.state,
            mask: secondOfTwo.mask,
            moves: [...firstOfTwo.moves, ...secondOfTwo.moves],
          };
        }
      }
    }
    if (!next2) {
      return { ok: false, reason: "444_YAU_LAST8_NEXT2_FAILED", solution: "", segments: [] };
    }
    state = next2.state;
    next2Moves = next2.moves;
  }
  if (!yauBoundaryOkay444(state, model, crossMask, 5)) {
    return { ok: false, reason: "444_YAU_LAST8_NEXT2_BOUNDARY_FAILED", solution: "", segments: [] };
  }
  segmentMoves.push({ id: "yau323Next2", name: "3-2-3 · Next 2", moves: next2Moves, pairStart: 8, pairEnd: 9 });

  // 3: try to close the final three in one Yau slice cycle.  If that is not
  // available, pair one more edge with a cycle and use only the standard L2E
  // algorithm for the actual final two edges.
  let last3Moves = [];
  remainingCount = bitCount(yauRemainingPairedMask444(state, crossMask));
  if (remainingCount < 8) {
    const directLast3 = advanceYauRemainingCount444(state, 8, sliceFamily, model, deadlineTs, crossMask, 9);
    if (directLast3) {
      state = directLast3.state;
      last3Moves = directLast3.moves;
    } else {
      if (remainingCount < 6 && !deadlineReached(deadlineTs)) {
        const makeTen = advanceYauRemainingCount444(state, 6, sliceFamily, model, deadlineTs, crossMask, 7);
        if (!makeTen) {
          return { ok: false, reason: "444_YAU_LAST8_LAST3_CYCLE_FAILED", solution: "", segments: [] };
        }
        state = makeTen.state;
        last3Moves.push(...makeTen.moves);
      }
      if (bitCount(yauRemainingPairedMask444(state, crossMask)) < 8) {
        const l2e = findL2E(state, model, deadlineTs, crossMask, null, crossMask);
        if (!l2e) {
          return { ok: false, reason: "444_YAU_LAST8_L2E_FAILED", solution: "", segments: [] };
        }
        state = l2e.state;
        last3Moves.push(...l2e.moves);
      }
    }
  }
  if (!yauBoundaryOkay444(state, model, crossMask, 8)) {
    return { ok: false, reason: "444_YAU_LAST8_LAST3_BOUNDARY_FAILED", solution: "", segments: [] };
  }
  segmentMoves.push({ id: "yau323Last3", name: "3-2-3 · Last 3", moves: last3Moves, pairStart: 10, pairEnd: 12 });

  const segments = segmentMoves.map((entry) => buildSegment(
    entry.id, entry.name, entry.moves, entry.pairStart, entry.pairEnd,
  ));
  const solution = segments.map((segment) => segment.solution).filter(Boolean).join(" ");

  // Independent final replay: cross wings must never split, each segment must
  // end with the cross fully solved again, and no Cross Restore phase exists.
  let replayState = compactStateFromPattern(pattern);
  for (const segment of segments) {
    for (const move of splitAlgorithm(segment.solution)) {
      replayState = applyCompactAction(replayState, model.actionFor(move), true);
      if (!maskContains(pairedEdgeTypeMask(replayState), crossMask)) {
        return { ok: false, reason: "444_YAU_LAST8_CROSS_SPLIT", detail: `${segment.name}:${move}`, solution: "", segments: [] };
      }
    }
    if (!yauBoundaryOkay444(replayState, model, crossMask)) {
      return { ok: false, reason: "444_YAU_LAST8_CROSS_BOUNDARY_BROKEN", detail: segment.name, solution: "", segments: [] };
    }
  }
  if (bitCount(pairedEdgeTypeMask(replayState)) !== 12) {
    return { ok: false, reason: "444_YAU_LAST8_FINAL_PAIR_VERIFY_FAILED", solution: "", segments: [] };
  }

  return {
    ok: true,
    reason: null,
    solution,
    moveCount: splitAlgorithm(solution).length,
    segments,
    method: "Yau 3-2-3 · Last 8",
    meta: {
      lastEightOnly: true,
      crossRestoreRequired: false,
      protectedCrossPairedEveryMove: true,
      crossSolvedAtSegmentBoundaries: true,
      initialRemainingPairedCount: initialRemainingCount,
      workingSlice: sliceFamily.openMoves[0][0],
      diagnostics: { elapsedMs: Math.max(0, Date.now() - startedAt) },
    },
  };
}

'''
s = s.replace(anchor, fresh + anchor, 1)
p.write_text(s)

# --- solver444.js: use the new Yau-only last-eight solver and remove Cross Restore.
p = Path('solver/solver444.js')
s = p.read_text()
start = s.index('  let remainingEdges = await edgeModule.solveEdgePairing323(\n', s.index('async function preferYauReduction444'))
end_marker = '  const internalYauSetup = translate444MoveConvention(yauSetupPublic);\n'
end = s.index(end_marker, start)
new_block = '''  const remainingEdges = await edgeModule.solveYauLastEight323444(\n    publicScramble,\n    yauSetupPublic,\n    {\n      deadlineTs,\n      crossTypeMask: targetTypeMask,\n    },\n  );\n  const yauEdge323ProtectedCrossBank = true;\n  const yauEdge323ProtectedBankFallbackReason = null;\n\n  if (!remainingEdges?.ok) {\n    const detail = JSON.stringify({\n      reason: remainingEdges?.reason || remainingEdges?.detail || null,\n      diagnostics: remainingEdges?.meta || null,\n      targetTypeMask,\n    });\n    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", detail, deadlineTs);\n  }\n\n  const yauRemainingEdgePublic = String(remainingEdges.solution || "").trim();\n\n'''
s = s[:start] + new_block + s[end:]
# Remove the old Cross Restore segment insertion if it remains.
old = '''  if (crossRestore.solution) {\n    internalEdgeSegments.push({\n      id: "yauCrossRestore",\n      name: "Yau · Cross Restore",\n      solution: translate444MoveConvention(crossRestore.solution),\n      moveCount: splitAlgorithm(crossRestore.solution).length,\n      pairStart: 12,\n      pairEnd: 12,\n      alreadyPaired: true,\n      verified: true,\n    });\n  }\n'''
if old in s:
    s = s.replace(old, '', 1)
s = s.replace('      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,', '      yauCrossRestoreMoveCount: 0,')
s = s.replace('      yauEdge323ProtectedCrossBank,\n      yauEdge323ProtectedBankFallbackReason,', '      yauEdge323ProtectedCrossBank,\n      yauEdge323ProtectedBankFallbackReason,\n      yauLastEightOnly: remainingEdges.meta?.lastEightOnly === true,\n      yauCrossSolvedAtEdgeSegmentBoundaries: remainingEdges.meta?.crossSolvedAtSegmentBoundaries === true,')
p.write_text(s)

# --- verifier: assert true Yau last-eight semantics and visible D-cross at each 3-2-3 boundary.
p = Path('tools/verify-444-yau.mjs')
v = p.read_text()
old = '''  assert.ok(Array.isArray(edge.segments) && edge.segments.length >= 3);\n  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");\n  assert.equal(edge.segments[0].alreadyPaired, true);\n  assert.equal(edge.segments.at(-1).pairEnd, 12);\n  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau must keep the original four-cross bank");\n  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);\n  for (const segment of edge.segments) {\n    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);\n    for (const token of tokens) {\n      pattern = pattern.applyAlg(token);\n      assert.equal(\n        pairedTypeMask(pattern) & targetMask,\n        targetMask,\n        `Yau cross dedge split during ${segment.name} at ${token}`,\n      );\n    }\n  }\n  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");\n  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");\n'''
new = '''  assert.deepEqual(edge.segments.map((segment) => segment.name), [\n    "3-2-3 · First 3",\n    "3-2-3 · Next 2",\n    "3-2-3 · Last 3",\n  ]);\n  assert.equal(edge.segments.at(-1).pairEnd, 12);\n  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true);\n  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);\n  assert.equal(result.meta.yauLastEightOnly, true, "Yau edge pairing must target only the last eight edges");\n  assert.equal(result.meta.yauCrossSolvedAtEdgeSegmentBoundaries, true);\n  assert.equal(Number(result.meta.yauCrossRestoreMoveCount), 0, "true Yau must not need Cross Restore");\n  assert.ok(!edge.segments.some((segment) => /Cross Restore/i.test(segment.name)), "Cross Restore must not exist in Yau");\n  for (const segment of edge.segments) {\n    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);\n    for (const token of tokens) {\n      pattern = pattern.applyAlg(token);\n      assert.equal(\n        pairedTypeMask(pattern) & targetMask,\n        targetMask,\n        `Yau cross dedge split during ${segment.name} at ${token}`,\n      );\n    }\n    assert.equal(centerFaceForColor(pattern, crossColor), "D", `${segment.name} must finish with the cross on D`);\n    assert.equal(\n      pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,\n      targetMask,\n      `${segment.name} did not restore the complete D-face cross`,\n    );\n  }\n  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");\n'''
if old not in v:
    raise SystemExit('verifier Yau edge block missing')
v = v.replace(old, new, 1)
v = v.replace('console.log("4x4 Yau order, protected cross, cross-frame retry, 3-2-3 edges, LL parity, and final verification passed");', 'console.log("4x4 true Yau last-eight 3-2-3, D-cross boundaries, LL parity, and final verification passed");')
p.write_text(v)

print('rewrote Yau edge stage as a dedicated last-eight 3-2-3 pipeline')
