from pathlib import Path
import re

solver = Path('solver/solver444.js')
s = solver.read_text()
old = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
    },
  );
  let yauEdge323ProtectedCrossBank = true;
  let yauEdge323ProtectedBankFallbackReason = null;

  // Prefer a true Yau 4-cross bank, but do not fail the whole solve merely
  // because that bounded 3-2-3 search cannot find a plan from this exact
  // frame. Retry the same human 3-2-3 planner with a freely chosen bank; all
  // centers remain solved, all 12 dedges are verified at the end, and the
  // completed cross is restored immediately afterwards.
  if (!remainingEdges?.ok && !deadlineReached(deadlineTs)) {
    yauEdge323ProtectedBankFallbackReason =
      remainingEdges?.detail || remainingEdges?.reason || "444_323_NO_PLAN";
    let rescue = null;
    try {
      rescue = await edgeModule.solveEdgePairing323(
        publicScramble,
        yauSetupPublic,
        { deadlineTs },
      );
    } catch (error) {
      rescue = {
        ok: false,
        reason: "444_YAU_EDGE_323_RESCUE_FAILED",
        detail: String(error?.message || error),
      };
    }
    if (rescue?.ok) {
      remainingEdges = {
        ...rescue,
        meta: {
          ...(rescue.meta && typeof rescue.meta === "object" ? rescue.meta : {}),
          yauProtectedCrossBank: false,
          yauProtectedBankFallbackReason: yauEdge323ProtectedBankFallbackReason,
        },
      };
      yauEdge323ProtectedCrossBank = false;
    }
  }
'''
new = '''    {
      deadlineTs,
      requiredTypeMask: targetTypeMask,
      requiredSolvedTypeMask: targetTypeMask,
    },
  );
  const yauEdge323ProtectedCrossBank = true;
  const yauEdge323ProtectedBankFallbackReason = null;
'''
if old not in s:
    raise SystemExit('solver444 Yau fallback block not found')
s = s.replace(old, new, 1)
solver.write_text(s)

edge = Path('solver/edgePairing444.js')
e = edge.read_text()

# Allow Yau slice search to enforce atomic paired-cross preservation and use a larger local beam.
old = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const centersOkay = (state) => requireAllCenters
'''
new = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
  const beamWidth = Math.max(100, Number(options?.beamWidth) || SLICE_BEAM_WIDTH);
  const centersOkay = (state) => requireAllCenters
'''
if old not in e:
    raise SystemExit('searchSliceCycle options anchor not found')
e = e.replace(old, new, 1)

old = '''    let beam = [{
      state: applyCompactAction(initialState, openAction, true),
      path: [],
      lastFace: "",
      score: 0,
    }];
'''
new = '''    const openedState = applyCompactAction(initialState, openAction, true);
    if (requiredPairedEveryMoveMask && !maskContains(pairedEdgeTypeMask(openedState), requiredPairedEveryMoveMask)) {
      continue;
    }
    let beam = [{
      state: openedState,
      path: [],
      lastFace: "",
      score: 0,
    }];
'''
if old not in e:
    raise SystemExit('searchSliceCycle open anchor not found')
e = e.replace(old, new, 1)

old = '''          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
'''
new = '''          const nextState = applyCompactAction(node.state, model.outerActions.get(move), true);
          if (requiredPairedEveryMoveMask && !maskContains(pairedEdgeTypeMask(nextState), requiredPairedEveryMoveMask)) {
            continue;
          }
          const closedCandidate = applyCompactAction(nextState, closeAction, true);
'''
if old not in e:
    raise SystemExit('searchSliceCycle next-state anchor not found')
e = e.replace(old, new, 1)

e = e.replace('.slice(0, SLICE_BEAM_WIDTH);', '.slice(0, beamWidth);', 1)

# Atomic-path helper and L2E cross-pair preservation.
old = '''function applyMovePath(state, moves, model) {
  let current = state;
  for (const move of moves) current = applyCompactAction(current, model.outerActions.get(move), true);
  return current;
}

function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0) {
'''
new = '''function applyMovePath(state, moves, model) {
  let current = state;
  for (const move of moves) current = applyCompactAction(current, model.outerActions.get(move), true);
  return current;
}

function applyTokenPathPreservingPairedTypes444(state, moves, model, requiredPairedMask = 0) {
  let current = state;
  for (const move of moves) {
    current = applyCompactAction(current, model.actionFor(move), true);
    if (requiredPairedMask && !maskContains(pairedEdgeTypeMask(current), requiredPairedMask)) return null;
  }
  return current;
}

function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0, requiredPairedEveryMoveMask = 0) {
'''
if old not in e:
    raise SystemExit('L2E helper anchor not found')
e = e.replace(old, new, 1)

old = '''    const setup = L2E_SETUP_PATHS[setupIndex];
    const setupState = applyMovePath(initialState, setup, model);
    const undo = setup.slice().reverse().map(invertMoveToken);
    for (const l2e of model.l2eActions) {
      let candidate = applyCompactAction(setupState, l2e.action, true);
      candidate = applyMovePath(candidate, undo, model);
      if (
'''
new = '''    const setup = L2E_SETUP_PATHS[setupIndex];
    const setupState = applyTokenPathPreservingPairedTypes444(
      initialState, setup, model, requiredPairedEveryMoveMask,
    );
    if (!setupState) continue;
    const undo = setup.slice().reverse().map(invertMoveToken);
    for (const l2e of model.l2eActions) {
      let candidate = applyTokenPathPreservingPairedTypes444(
        setupState, splitAlgorithm(l2e.algorithm), model, requiredPairedEveryMoveMask,
      );
      if (!candidate) continue;
      candidate = applyTokenPathPreservingPairedTypes444(
        candidate, undo, model, requiredPairedEveryMoveMask,
      );
      if (!candidate) continue;
      if (
'''
if old not in e:
    raise SystemExit('L2E candidate block not found')
e = e.replace(old, new, 1)

# Restrict Yau to the slice family whose protected bank is exactly the solved cross face.
old = '''  const diagnostics = {
    frameCount: model.sliceFamilies.length,
'''
new = '''  const candidateFamilies = yauBank
    ? model.sliceFamilies.filter((family) => family.bankMask === requiredTypeMask)
    : model.sliceFamilies;
  if (yauBank && candidateFamilies.length !== 1) {
    return {
      ok: false,
      reason: "444_YAU_323_CROSS_BANK_FRAME_NOT_FOUND",
      detail: JSON.stringify({ requiredTypeMask, frameCount: candidateFamilies.length }),
      solution: "",
      segments: [],
      method: edgeMethod,
    };
  }

  const diagnostics = {
    frameCount: candidateFamilies.length,
'''
if old not in e:
    raise SystemExit('diagnostics frameCount anchor not found')
e = e.replace(old, new, 1)

e = e.replace(
'''  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
''',
'''  for (let frameIndex = 0; frameIndex < candidateFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = candidateFamilies[frameIndex];
''',
1)

# First 3: keep the cross paired after every atomic move and solved at cycle close.
old = '''        yauBank ? 7 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
      );
'''
new = '''        yauBank ? 8 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
        yauBank ? { requiredPairedEveryMoveMask: requiredTypeMask, beamWidth: 3600 } : {},
      );
'''
if old not in e:
    raise SystemExit('firstThree search call anchor not found')
e = e.replace(old, new, 1)

# Yau Next 2: use the same protected working slice instead of arbitrary seed macros.
pattern = re.compile(r'''      if \(yauBank\) \{\n        const nextTwoFirst = searchTargetEdgeTypes444\(.*?\n      \} else \{\n        const nextTwoFirst = searchSliceCycleAcrossFrames\(''', re.S)
replacement = '''      if (yauBank) {
        const nextTwoFirst = searchSliceCycle(
          firstThree.state,
          firstLockedMask,
          eighthTarget,
          sliceFamily,
          model,
          deadlineTs,
          8,
          requiredSolvedTypeMask,
          { requiredPairedEveryMoveMask: requiredTypeMask, beamWidth: 4200 },
        );
        if (!nextTwoFirst) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        const eighthLockedMask = chooseProtectedTypeMask(
          nextTwoFirst.mask,
          firstLockedMask,
          eighthTarget,
        );
        if (bitCount(eighthLockedMask) !== eighthTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }

        const nextTwoSecond = searchSliceCycle(
          nextTwoFirst.state,
          eighthLockedMask,
          secondTarget,
          sliceFamily,
          model,
          deadlineTs,
          8,
          requiredSolvedTypeMask,
          { requiredPairedEveryMoveMask: requiredTypeMask, beamWidth: 4200 },
        );
        if (!nextTwoSecond) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        secondLockedMask = chooseProtectedTypeMask(
          nextTwoSecond.mask,
          eighthLockedMask,
          secondTarget,
        );
        if (bitCount(secondLockedMask) !== secondTarget) {
          diagnostics.nextTwoFailures += 1;
          continue;
        }
        nextTwo = {
          state: nextTwoSecond.state,
          mask: nextTwoSecond.mask,
          moves: [...nextTwoFirst.moves, ...nextTwoSecond.moves],
          firstInsertionMoves: nextTwoFirst.moves,
          secondInsertionMoves: nextTwoSecond.moves,
          sliceFamily,
          frameRotation: sliceFamily.rotation,
          workingSlice: sliceFamily.openMoves[0][0],
          firstFrameRotation: sliceFamily.rotation,
          firstWorkingSlice: sliceFamily.openMoves[0][0],
        };
      } else {
        const nextTwoFirst = searchSliceCycleAcrossFrames('''
e2, n = pattern.subn(replacement, e, count=1)
if n != 1:
    raise SystemExit(f'Yau next-two block patch count={n}')
e = e2

# Yau 10-pair setup: stay on the same protected slice and preserve the cross.
pattern = re.compile(r'''        if \(yauBank\) \{\n          const multiCycle = searchTargetEdgeTypes444\(.*?\n          finalSetup = multiCycle\n            \? \{.*?\n              \}\n            : null;\n        \} else \{''', re.S)
replacement = '''        if (yauBank) {
          const multiCycle = searchSliceCycle(
            nextTwo.state,
            secondLockedMask,
            10,
            sliceFamily,
            model,
            deadlineTs,
            9,
            requiredSolvedTypeMask,
            { requiredPairedEveryMoveMask: requiredTypeMask, beamWidth: 5000 },
          );
          finalSetup = multiCycle
            ? {
                ...multiCycle,
                sliceFamily,
                frameRotation: sliceFamily.rotation,
                workingSlice: sliceFamily.openMoves[0][0],
              }
            : null;
        } else {'''
e2, n = pattern.subn(replacement, e, count=1)
if n != 1:
    raise SystemExit(f'Yau final-setup block patch count={n}')
e = e2

# L2E must not unpair the protected cross at any atomic move.
old = '''        : findL2E(beforeL2E.state, model, deadlineTs, requiredSolvedTypeMask);
'''
new = '''        : findL2E(
            beforeL2E.state,
            model,
            deadlineTs,
            requiredSolvedTypeMask,
            yauBank ? requiredTypeMask : 0,
          );
'''
if old not in e:
    raise SystemExit('findL2E call anchor not found')
e = e.replace(old, new, 1)

# Final edge-stage verification includes protected cross pairing + solved placement.
old = '''      if (
        bitCount(pairedSlotMask(verifiedState)) !== 12 ||
        !centersSolved(verifiedState, model.solvedCompact.centerPieces)
      ) {
'''
new = '''      if (
        bitCount(pairedSlotMask(verifiedState)) !== 12 ||
        !maskContains(pairedEdgeTypeMask(verifiedState), requiredTypeMask) ||
        (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(verifiedState), requiredSolvedTypeMask)) ||
        !centersSolved(verifiedState, model.solvedCompact.centerPieces)
      ) {
'''
if old not in e:
    raise SystemExit('final verification anchor not found')
e = e.replace(old, new, 1)

# Expose the invariant in metadata for UI/regression diagnostics.
old = '''          beforeL2E: beforeL2ELockedCount,
          diagnostics,
'''
new = '''          beforeL2E: beforeL2ELockedCount,
          protectedCrossTypeMask: requiredTypeMask,
          protectedCrossSolvedAtStageEnd: !requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(verifiedState), requiredSolvedTypeMask),
          protectedCrossPairedEveryMove: yauBank,
          diagnostics,
'''
if old not in e:
    raise SystemExit('meta anchor not found')
e = e.replace(old, new, 1)
edge.write_text(e)

# Strengthen Yau regression: no free-bank rescue, no Cross Restore, cross dedges stay paired atomically.
verify = Path('tools/verify-444-yau.mjs')
v = verify.read_text()
old = '''  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  pattern = edge.solution ? pattern.applyAlg(edge.solution) : pattern;
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
new = '''  assert.equal(edge.segments[0].name, "Yau Cross Bank 4/12");
  assert.equal(edge.segments[0].alreadyPaired, true);
  assert.equal(edge.segments.at(-1).pairEnd, 12);
  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau 3-2-3 must never fall back to a free bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  assert.equal(Number(result.meta.yauCrossRestoreMoveCount), 0, "Yau edge pairing must not need a Cross Restore step");
  assert.equal(result.meta.yauEdge323?.protectedCrossPairedEveryMove, true);
  for (const segment of edge.segments) {
    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);
    for (const token of tokens) {
      pattern = pattern.applyAlg(token);
      assert.equal(
        pairedTypeMask(pattern) & targetMask,
        targetMask,
        `Yau 3-2-3 unpaired a protected cross dedge after ${segment.name}: ${token}`,
      );
    }
    assert.equal(
      solvedTypeMask(pattern) & targetMask,
      targetMask,
      `Yau 3-2-3 did not restore the solved D-face cross after ${segment.name}`,
    );
  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
if old not in v:
    raise SystemExit('Yau verifier edge block not found')
v = v.replace(old, new, 1)
verify.write_text(v)

print('patched Yau 3-2-3 cross lock')
