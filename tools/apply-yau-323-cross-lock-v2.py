from pathlib import Path
import re

# ---- solver444.js: never drop the protected Yau cross bank ----
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
    raise SystemExit('solver444 fallback block not found')
s = s.replace(old, new, 1)
solver.write_text(s)

# ---- edgePairing444.js ----
edge = Path('solver/edgePairing444.js')
e = edge.read_text()

# Slice-cycle: allow a Yau caller to reject any atomic move that unpairs the cross.
old = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const centersOkay = (state) => requireAllCenters
'''
new = '''  const protectedCenterFaces = Array.isArray(options?.protectedCenterFaces) ? options.protectedCenterFaces : [];
  const requireAllCenters = options?.requireAllCenters !== false;
  const requiredPairedEveryMoveMask = Number(options?.requiredPairedEveryMoveMask) >>> 0;
  const centersOkay = (state) => requireAllCenters
'''
if old not in e:
    raise SystemExit('slice options anchor not found')
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
    raise SystemExit('slice open anchor not found')
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
    raise SystemExit('slice next anchor not found')
e = e.replace(old, new, 1)

# Generic token replay helper for the fast verified seed-macro search and L2E.
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
    raise SystemExit('applyMovePath/L2E anchor not found')
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
    raise SystemExit('L2E body anchor not found')
e = e.replace(old, new, 1)

# Fast seed-macro search: optional cross-solved-at-macro-end and paired-at-every-token contracts.
old = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
) {
'''
new = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
  requiredSolvedTypeMask = 0,
  requiredPairedEveryMoveMask = 0,
) {
'''
if old not in e:
    raise SystemExit('searchTarget signature anchor not found')
e = e.replace(old, new, 1)

old = '''      centersPreserved,
      score: (centersPreserved ? 500000 : 0)
'''
new = '''      centersPreserved,
      requiredSolved: !requiredSolvedTypeMask || maskContains(solvedEdgeTypeMask(node.state), requiredSolvedTypeMask),
      score: (centersPreserved ? 500000 : 0)
'''
if old not in e:
    raise SystemExit('searchTarget evaluate anchor not found')
e = e.replace(old, new, 1)

old = '''        node.centersPreserved &&
        maskContains(node.pairedMask, requiredTypeMask) &&
'''
new = '''        node.centersPreserved &&
        node.requiredSolved &&
        maskContains(node.pairedMask, requiredTypeMask) &&
'''
if old not in e:
    raise SystemExit('searchTarget goal anchor not found')
e = e.replace(old, new, 1)

old = '''      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);
        const pairedMask = pairedEdgeTypeMask(nextState);
'''
new = '''      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const seedAction = model.seedActions[actionIndex];
        const nextState = requiredPairedEveryMoveMask
          ? applyTokenPathPreservingPairedTypes444(
              node.state,
              splitAlgorithm(seedAction.algorithm),
              model,
              requiredPairedEveryMoveMask,
            )
          : applyCompactAction(node.state, seedAction.action, true);
        if (!nextState) continue;
        if (requiredSolvedTypeMask && !maskContains(solvedEdgeTypeMask(nextState), requiredSolvedTypeMask)) continue;
        const pairedMask = pairedEdgeTypeMask(nextState);
'''
if old not in e:
    raise SystemExit('searchTarget expansion anchor not found')
e = e.replace(old, new, 1)

# Yau uses exactly the bank on the solved cross face, whose working wide slice is the opposite face.
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
    raise SystemExit('candidateFamilies anchor not found')
e = e.replace(old, new, 1)

old = '''  for (let frameIndex = 0; frameIndex < model.sliceFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = model.sliceFamilies[frameIndex];
'''
new = '''  for (let frameIndex = 0; frameIndex < candidateFamilies.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const sliceFamily = candidateFamilies[frameIndex];
'''
if old not in e:
    raise SystemExit('frame loop anchor not found')
e = e.replace(old, new, 1)

# First 3 uses the safe opposite-face slice and rejects atomic cross unpairing.
old = '''        yauBank ? 7 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
      );
'''
new = '''        yauBank ? 7 : SLICE_MAX_OUTER_MOVES,
        requiredSolvedTypeMask,
        yauBank ? { requiredPairedEveryMoveMask: requiredTypeMask } : {},
      );
'''
if old not in e:
    raise SystemExit('firstThree call anchor not found')
e = e.replace(old, new, 1)

# Keep the existing fast Yau macro planner for Next 2, but filter every macro atomically.
old = '''          2,
          null,
          7,
        );
'''
new = '''          2,
          null,
          7,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );
'''
if old not in e:
    raise SystemExit('nextTwoFirst call anchor not found')
e = e.replace(old, new, 1)

old = '''          2,
          null,
          8,
        );
'''
new = '''          2,
          null,
          8,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          requiredSolvedTypeMask,
          requiredTypeMask,
        );
'''
if old not in e:
    raise SystemExit('nextTwoSecond call anchor not found')
e = e.replace(old, new, 1)

old = '''            3,
            null,
            9,
          );
'''
new = '''            4,
            null,
            9,
            YAU_TARGET_RESCUE_BEAM_WIDTH,
            true,
            false,
            requiredSolvedTypeMask,
            requiredTypeMask,
          );
'''
if old not in e:
    raise SystemExit('finalSetup macro call anchor not found')
e = e.replace(old, new, 1)

# L2E: preserve the protected cross dedges token-by-token too.
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

# Final edge-stage verification: all dedges paired, centers solved, protected cross still solved.
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
    raise SystemExit('final edge verification anchor not found')
e = e.replace(old, new, 1)

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
    raise SystemExit('edge meta anchor not found')
e = e.replace(old, new, 1)
edge.write_text(e)

# ---- Regression: no free-bank fallback, no repair step, paired cross after every displayed move ----
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
  assert.equal(Number(result.meta.yauCrossRestoreMoveCount), 0, "Yau edge pairing must not need Cross Restore");
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
      `Yau 3-2-3 did not restore the solved cross after ${segment.name}`,
    );
  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
if old not in v:
    raise SystemExit('verifier edge block not found')
v = v.replace(old, new, 1)
verify.write_text(v)

print('patched fast protected Yau 3-2-3')
