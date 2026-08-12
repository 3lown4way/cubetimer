from pathlib import Path

# solver444: Yau may never abandon its four-cross bank.
p = Path('solver/solver444.js')
s = p.read_text()
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
# Test-only headroom for the unrelated protected-center local search.
old = '''      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200))
        : Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200);
'''
new = '''      const defaultProtectedBudgetMs = options?.__yauFastFrameProbe === true ? 900 : 2200;
      const protectedBudgetMs = Math.max(
        defaultProtectedBudgetMs,
        Math.min(8000, Number(options?.__yauProtectedCenterBudgetMs) || defaultProtectedBudgetMs),
      );
      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + protectedBudgetMs)
        : Date.now() + protectedBudgetMs;
'''
if old not in s:
    raise SystemExit('protected center budget anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('solver/edgePairing444.js')
e = p.read_text()

# Generate the 24 cube-orientation face maps. Remapping a center-preserving
# commutator by any whole-cube orientation keeps it center-preserving. We use
# this to turn every generic seed/L2E macro into an equivalent macro whose
# only wide turns are on the Yau working face opposite the cross.
anchor = '''function compactActionsEqual(left, right) {
'''
helper = '''const CUBE_ROTATION_FACE_MAPS_444 = Object.freeze({
  x: Object.freeze({ U: "B", B: "D", D: "F", F: "U", R: "R", L: "L" }),
  y: Object.freeze({ U: "U", R: "B", B: "L", L: "F", F: "R", D: "D" }),
  z: Object.freeze({ U: "R", R: "D", D: "L", L: "U", F: "F", B: "B" }),
});

function composeFaceMap444(faceMap, rotationMap) {
  const result = {};
  for (const face of "URFDLB") result[face] = rotationMap[faceMap[face]];
  return result;
}

function buildCubeOrientationFaceMaps444() {
  const identity = { U: "U", R: "R", F: "F", D: "D", L: "L", B: "B" };
  const keyFor = (faceMap) => [..."URFDLB"].map((face) => faceMap[face]).join("");
  const queue = [identity];
  const maps = [];
  const seen = new Set();
  while (queue.length) {
    const faceMap = queue.shift();
    const key = keyFor(faceMap);
    if (seen.has(key)) continue;
    seen.add(key);
    maps.push(Object.freeze({ ...faceMap }));
    for (const rotation of ["x", "y", "z"]) {
      queue.push(composeFaceMap444(faceMap, CUBE_ROTATION_FACE_MAPS_444[rotation]));
    }
  }
  if (maps.length !== 24) throw new Error(`444_ORIENTATION_FACE_MAP_COUNT:${maps.length}`);
  return Object.freeze(maps);
}

const CUBE_ORIENTATION_FACE_MAPS_444 = buildCubeOrientationFaceMaps444();

function remapMoveToken444(token, faceMap) {
  const match = /^([URFDLB])(w)?(2|')?$/.exec(String(token || ""));
  if (!match) return token;
  return `${faceMap[match[1]]}${match[2] || ""}${match[3] || ""}`;
}

function remapAlgorithmToWideFace444(algorithm, targetWideFace) {
  const tokens = splitAlgorithm(algorithm);
  const wideFaces = [...new Set(tokens.filter((token) => /^[URFDLB]w/.test(token)).map((token) => token[0]))];
  if (wideFaces.length !== 1) return null;
  const sourceWideFace = wideFaces[0];
  const targetFace = String(targetWideFace || "").charAt(0).toUpperCase();
  const faceMap = CUBE_ORIENTATION_FACE_MAPS_444.find((candidate) => candidate[sourceWideFace] === targetFace);
  if (!faceMap) return null;
  return tokens.map((token) => remapMoveToken444(token, faceMap)).join(" ");
}

function conjugatedActionPoolForWideFace444(baseActions, targetWideFace, model) {
  const seen = new Set();
  const pool = [];
  for (const base of baseActions) {
    const algorithm = remapAlgorithmToWideFace444(base.algorithm, targetWideFace);
    if (!algorithm || seen.has(algorithm)) continue;
    seen.add(algorithm);
    pool.push({ algorithm, action: model.actionFor(algorithm) });
  }
  return pool;
}

'''
if anchor not in e:
    raise SystemExit('compactActionsEqual anchor not found')
e = e.replace(anchor, helper + anchor, 1)

# findL2E can receive a Yau-specific conjugated L2E pool.
old = '''function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0) {
  const solvedCenters = model.solvedCompact;
'''
new = '''function findL2E(initialState, model, deadlineTs, requiredSolvedTypeMask = 0, actionPool = null) {
  const solvedCenters = model.solvedCompact;
  const l2eActions = Array.isArray(actionPool) ? actionPool : model.l2eActions;
'''
if old not in e:
    raise SystemExit('findL2E signature anchor not found')
e = e.replace(old, new, 1)
e = e.replace('    for (const l2e of model.l2eActions) {', '    for (const l2e of l2eActions) {', 1)

# Target-edge beam can also receive a Yau-specific seed pool.
old = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
) {
'''
new = '''  beamWidth = YAU_TARGET_BEAM_WIDTH,
  centerAwareKey = false,
  projectTargetState = false,
  actionPool = null,
) {
'''
if old not in e:
    raise SystemExit('searchTarget signature tail not found')
e = e.replace(old, new, 1)
old = '''  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
'''
new = '''  const searchActions = Array.isArray(actionPool) ? actionPool : model.seedActions;
  if (!searchActions.length) return null;
  let beam = [evaluate({ state: initialState, path: [] })];
  let overshoot = null;
'''
if old not in e:
    raise SystemExit('searchTarget beam anchor not found')
e = e.replace(old, new, 1)
pos = e.find('function searchTargetEdgeTypes444(')
head, tail = e[:pos], e[pos:]
old_loop = '''      for (let actionIndex = 0; actionIndex < model.seedActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, model.seedActions[actionIndex].action, true);
'''
new_loop = '''      for (let actionIndex = 0; actionIndex < searchActions.length; actionIndex += 1) {
        const nextState = applyCompactAction(node.state, searchActions[actionIndex].action, true);
'''
if old_loop not in tail:
    raise SystemExit('searchTarget seed loop not found')
tail = tail.replace(old_loop, new_loop, 1)
e = head + tail

# Yau gets exactly the bank-matching frame. Other 3-2-3 behavior is unchanged.
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

# Build the full-strength but cross-safe Yau macro pools for this frame.
old = '''      const eighthTarget = 8;
      const secondTarget = 9;
      let nextTwo;
'''
new = '''      const eighthTarget = 8;
      const secondTarget = 9;
      const yauSeedActions = yauBank
        ? conjugatedActionPoolForWideFace444(model.seedActions, sliceFamily.openMoves[0][0], model)
        : model.seedActions;
      const yauL2EActions = yauBank
        ? conjugatedActionPoolForWideFace444(model.l2eActions, sliceFamily.openMoves[0][0], model)
        : model.l2eActions;
      let nextTwo;
'''
if old not in e:
    raise SystemExit('Next2 pool anchor not found')
e = e.replace(old, new, 1)

# Next 2 uses the same depths as production but the conjugated full pool.
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
          yauSeedActions,
        );
'''
if old not in e:
    raise SystemExit('Next2 first call anchor not found')
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
          yauSeedActions,
        );
'''
if old not in e:
    raise SystemExit('Next2 second call anchor not found')
e = e.replace(old, new, 1)
# Path indices now refer to the conjugated pool.
e = e.replace('splitAlgorithm(model.seedActions[actionIndex].algorithm)\n        );\n        const secondMoves', 'splitAlgorithm(yauSeedActions[actionIndex].algorithm)\n        );\n        const secondMoves', 1)
e = e.replace('splitAlgorithm(model.seedActions[actionIndex].algorithm)\n        );\n        nextTwo =', 'splitAlgorithm(yauSeedActions[actionIndex].algorithm)\n        );\n        nextTwo =', 1)

# Last-3 setup uses the conjugated pool too.
old = '''            3,
            null,
            9,
          );
'''
new = '''            3,
            null,
            9,
            YAU_TARGET_BEAM_WIDTH,
            false,
            false,
            yauSeedActions,
          );
'''
if old not in e:
    raise SystemExit('Last3 setup call anchor not found')
e = e.replace(old, new, 1)
# The next occurrence is the Yau Last3 path reconstruction.
needle = '''                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(model.seedActions[actionIndex].algorithm)
                ),
'''
replacement = '''                moves: multiCycle.path.flatMap((actionIndex) =>
                  splitAlgorithm(yauSeedActions[actionIndex].algorithm)
                ),
'''
if needle not in e:
    raise SystemExit('Last3 reconstruction anchor not found')
e = e.replace(needle, replacement, 1)

# Yau L2E uses a conjugated algorithm whose only wide face is the safe working slice.
old = '''        : findL2E(beforeL2E.state, model, deadlineTs, requiredSolvedTypeMask);
'''
new = '''        : findL2E(
            beforeL2E.state,
            model,
            deadlineTs,
            requiredSolvedTypeMask,
            yauBank ? yauL2EActions : null,
          );
'''
if old not in e:
    raise SystemExit('findL2E call anchor not found')
e = e.replace(old, new, 1)
p.write_text(e)

# Regression: every atomic 3-2-3 move must keep all four cross dedges paired.
p = Path('tools/verify-444-yau.mjs')
v = p.read_text()
old = '''    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
  });
'''
new = '''    deadlineTs: Date.now() + 60_000,
    crossColor,
    method444: "yau",
    __yauProtectedCenterBudgetMs: 6000,
  });
'''
if old not in v:
    raise SystemExit('verifier options anchor not found')
v = v.replace(old, new, 1)
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
    raise SystemExit('verifier edge block not found')
v = v.replace(old, new, 1)
p.write_text(v)
print('patched full conjugated Yau seed/L2E pools and atomic cross verification')
