from pathlib import Path

# Production-shaped diagnostic patch: keep Yau's four-edge bank, choose the
# bank-matching working-slice frame, and only use seed macros whose wide turns
# stay on that one working face.
solver = Path('solver/solver444.js')
s = solver.read_text()
old = '''  let yauEdge323ProtectedCrossBank = true;
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
new = '''  const yauEdge323ProtectedCrossBank = true;
  const yauEdge323ProtectedBankFallbackReason = null;
'''
if old not in s:
    raise SystemExit('solver444 free-bank fallback block not found')
s = s.replace(old, new, 1)
solver.write_text(s)

edge = Path('solver/edgePairing444.js')
e = edge.read_text()

# Add a compact seed-macro selector. Outer turns are harmless to paired dedges;
# only wide turns can split a cross pair. Require every wide token in a macro
# to use the bank frame's single working face.
anchor = '''function searchTargetEdgeTypes444(
'''
helper = '''function seedActionIndicesForWideFace444(model, workingWideFace) {
  const face = String(workingWideFace || "").charAt(0).toUpperCase();
  if (!/^[URFDLB]$/.test(face)) return [];
  const indices = [];
  for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
    const tokens = splitAlgorithm(model.seedActions[actionIndex].algorithm);
    const wideTokens = tokens.filter((token) => /^[URFDLB]w/.test(token));
    if (wideTokens.length && wideTokens.every((token) => token[0] === face)) indices.push(actionIndex);
  }
  return indices;
}

'''
if anchor not in e:
    raise SystemExit('searchTargetEdgeTypes444 anchor not found')
e = e.replace(anchor, helper + anchor, 1)

old = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
) {
'''
new = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
  actionIndices = null,
) {
'''
if old not in e:
    raise SystemExit('searchTarget signature tail not found')
e = e.replace(old, new, 1)

old = '''  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
'''
new = '''  const candidateActionIndices = Array.isArray(actionIndices)
    ? actionIndices
    : model.seedActions.map((_, actionIndex) => actionIndex);
  if (!candidateActionIndices.length) return null;
  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
'''
if old not in e:
    raise SystemExit('searchTarget beam anchor not found')
e = e.replace(old, new, 1)

old = '''      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);
'''
new = '''      for (const actionIndex of candidateActionIndices) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);
'''
# This exact loop appears in searchTarget after collectSeedCandidates; replace last occurrence only.
pos = e.find('function searchTargetEdgeTypes444(')
head, tail = e[:pos], e[pos:]
if old not in tail:
    raise SystemExit('searchTarget action loop not found')
tail = tail.replace(old, new, 1)
e = head + tail

# For Yau, only the frame whose bank slots are the four protected cross dedges
# is a legitimate 3-2-3 frame. This naturally makes the working wide slice the
# face opposite the cross.
old = '''  const diagnostics = {
    frameCount: model.sliceFamilies.length,
'''
new = '''  const candidateFamilies = yauBank
    ? model.sliceFamilies.filter((family) => family.bankMask === requiredTypeMask)
    : model.sliceFamilies;
  const diagnostics = {
    frameCount: candidateFamilies.length,
'''
if old not in e:
    raise SystemExit('diagnostics frame anchor not found')
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

# The safe seed vocabulary is tied to this frame's working wide face.
old = '''      const eighthTarget = 8;
      const secondTarget = 9;
      let nextTwo;
'''
new = '''      const eighthTarget = 8;
      const secondTarget = 9;
      const yauSafeSeedActionIndices = yauBank
        ? seedActionIndicesForWideFace444(model, sliceFamily.openMoves[0][0])
        : null;
      let nextTwo;
'''
if old not in e:
    raise SystemExit('Next2 setup anchor not found')
e = e.replace(old, new, 1)

# First Next-2 insertion.
old = '''          2,
          null,
          7,
        );
'''
new = '''          4,
          null,
          7,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          yauSafeSeedActionIndices,
        );
'''
if old not in e:
    raise SystemExit('Next2 first call anchor not found')
e = e.replace(old, new, 1)
# Second Next-2 insertion.
old = '''          2,
          null,
          8,
        );
'''
new = '''          4,
          null,
          8,
          YAU_TARGET_BEAM_WIDTH,
          false,
          false,
          yauSafeSeedActionIndices,
        );
'''
if old not in e:
    raise SystemExit('Next2 second call anchor not found')
e = e.replace(old, new, 1)
# Last-3 setup to ten pairs.
old = '''            3,
            null,
            9,
          );
'''
new = '''            5,
            null,
            9,
            YAU_TARGET_BEAM_WIDTH,
            false,
            false,
            yauSafeSeedActionIndices,
          );
'''
if old not in e:
    raise SystemExit('Last3 setup call anchor not found')
e = e.replace(old, new, 1)
edge.write_text(e)

# Atomic verifier: a Yau result is invalid if any of the four cross edge types
# cease to be paired after any displayed move.
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
  assert.equal(result.meta.yauEdge323ProtectedCrossBank, true, "Yau must keep the original four-cross bank");
  assert.equal(result.meta.yauEdge323ProtectedBankFallbackReason, null);
  for (const segment of edge.segments) {
    const tokens = String(segment.solution || "").trim().split(/\\s+/).filter(Boolean);
    for (const token of tokens) {
      pattern = pattern.applyAlg(token);
      assert.equal(
        pairedTypeMask(pattern) & targetMask,
        targetMask,
        `Yau cross dedge split during ${segment.name} at ${token}`,
      );
    }
  }
  assert.equal(bitCount(pairedTypeMask(pattern)), 12, "Yau remaining edge stage did not pair all dedges");
  assert.equal((solvedTypeMask(pattern) & targetMask), targetMask, "Yau 3-2-3 disturbed the solved cross");
'''
if old not in v:
    raise SystemExit('Yau verifier edge block not found')
v = v.replace(old, new, 1)
verify.write_text(v)
print('patched bank-matched Yau safe-wide seed macros')
