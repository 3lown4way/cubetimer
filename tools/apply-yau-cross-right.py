from pathlib import Path

solver = Path("solver/solver444.js")
s = solver.read_text()

# 1) Cross 3/4 + remaining centers: calibrate the human presentation so the
# selected cross color is physically visible on R.  In the internal view-map
# convention the B slot maps to the rendered R face.
old = '''  const crossLeftCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.L === normalizedCross && entry.map.R === opposite,
  );'''
new = '''  const crossRightCandidates = VIEW_ORIENTATIONS_444.filter(
    // The view-map convention is inverse to the rendered cube rotation here:
    // map.B = cross places the selected cross-colored center on visible R.
    (entry) => entry.map.B === normalizedCross && entry.map.F === opposite,
  );'''
if old not in s:
    raise SystemExit("missing cross-left Yau presentation anchor")
s = s.replace(old, new, 1)
old = '''    if (index === 2 || index === 3) return crossLeftCandidates;'''
new = '''    if (index === 2 || index === 3) return crossRightCandidates;'''
if old not in s:
    raise SystemExit("missing Yau cross-left candidate use")
s = s.replace(old, new, 1)
s = s.replace(
    "// 3) hold the cross center on L for Cross 3/4 and the last four centers,",
    "// 3) hold the cross center on the visible R face for Cross 3/4 and the last four centers,",
    1,
)

# 2) A canonical Yau solve is computed with logical D.  Humanize only after it
# has been mapped back to the user's physical cross color, otherwise e.g. an F
# cross gets its intended R grip rotated into another public face.
anchor = '''async function verifyEquivalent444Presentation(publicScramble, baselineStages, candidateStages) {
  if (!Array.isArray(baselineStages) || baselineStages.length !== candidateStages?.length) return false;
  const { puzzles } = await import("../vendor/cubing/puzzles/index.js");
  const kpuzzle = await puzzles["4x4x4"].kpuzzle();
  let baseline = kpuzzle.defaultPattern();
  let candidate = kpuzzle.defaultPattern();
  if (publicScramble) {
    baseline = baseline.applyAlg(publicScramble);
    candidate = candidate.applyAlg(publicScramble);
  }
  for (let index = 0; index < baselineStages.length; index += 1) {
    const baselineSolution = String(baselineStages[index]?.solution || "").trim();
    const candidateSolution = String(candidateStages[index]?.solution || "").trim();
    if (baselineSolution) baseline = baseline.applyAlg(baselineSolution);
    if (candidateSolution) candidate = candidate.applyAlg(candidateSolution);
    if (JSON.stringify(baseline.patternData) !== JSON.stringify(candidate.patternData)) return false;
  }
  return true;
}
'''
if anchor not in s:
    raise SystemExit("missing presentation verification function")
helper = anchor + '''
async function humanizeMappedYauStages444(publicScramble, sourceStages, crossColor) {
  const baselineStages = structuredClone(Array.isArray(sourceStages) ? sourceStages : []);
  const stages = structuredClone(baselineStages);
  let viewpointRotationCount = 0;
  let yauViewpointRotationCount = 0;
  try {
    const centerStage = stages.find((stage) => stage?.id === "centers");
    const edgeStage = stages.find((stage) => stage?.id === "edges");
    const cfopStage = stages.find((stage) => stage?.id === "threeByThree");

    const setupHuman = centerStage?.method === "Yau" && centerStage?.segments?.length
      ? buildHumanYauSetupPresentation444(centerStage.segments, crossColor)
      : null;
    if (setupHuman) {
      centerStage.segments = setupHuman.segments;
      centerStage.solution = setupHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += setupHuman.rotationCount;
      yauViewpointRotationCount += setupHuman.rotationCount;
    }

    const edgeHuman = edgeStage?.segments?.length && String(edgeStage?.method || "").startsWith("Yau")
      ? buildHumanYauEdgePresentation444(edgeStage.segments, crossColor)
      : null;
    if (edgeHuman) {
      edgeStage.segments = edgeHuman.segments;
      edgeStage.solution = edgeHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += edgeHuman.rotationCount;
      yauViewpointRotationCount += edgeHuman.rotationCount;
    }

    const cfopHuman = cfopStage?.segments?.length
      ? buildHumanCfopPresentation444(cfopStage.segments, crossColor)
      : null;
    if (cfopHuman) {
      cfopStage.segments = cfopHuman.segments;
      cfopStage.solution = cfopHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += cfopHuman.rotationCount;
    }

    const verified = viewpointRotationCount > 0
      && await verifyEquivalent444Presentation(publicScramble, baselineStages, stages);
    if (!verified) {
      return {
        stages: baselineStages,
        humanViewpointApplied: false,
        viewpointRotationCount: 0,
        yauHumanGripApplied: false,
        yauViewpointRotationCount: 0,
      };
    }
    return {
      stages,
      humanViewpointApplied: true,
      viewpointRotationCount,
      yauHumanGripApplied: yauViewpointRotationCount > 0,
      yauViewpointRotationCount,
    };
  } catch (_) {
    return {
      stages: baselineStages,
      humanViewpointApplied: false,
      viewpointRotationCount: 0,
      yauHumanGripApplied: false,
      yauViewpointRotationCount: 0,
    };
  }
}
'''
s = s.replace(anchor, helper, 1)

# 3) Skip the logical-D presentation during canonical full/rescue solves.
old = '''      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
    });'''
new = '''      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
      __skipHumanPresentation: true,
    });'''
count = s.count(old)
if count != 2:
    raise SystemExit(f"expected 2 canonical full/rescue anchors, found {count}")
s = s.replace(old, new, 2)

# 4) Humanize the already-mapped physical stages with the user's real cross
# color and verify the presented sequence independently before returning it.
old = '''  const mapVerifiedSuccess = async (logicalResult, candidate) => {
    const physicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, candidate.orientation);
    if (physicalSolution == null) return null;
    const physicalStages = [];
    for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
      const mappedStage = mapYauStageToPhysical444(stage, candidate.orientation);
      if (!mappedStage) return null;
      physicalStages.push(mappedStage);
    }
    try {
      const { puzzles } = await import("../vendor/cubing/puzzles/index.js");
      const kpuzzle = await puzzles["4x4x4"].kpuzzle();
      let pattern = kpuzzle.defaultPattern();
      if (publicScramble) pattern = pattern.applyAlg(publicScramble);
      if (physicalSolution) pattern = pattern.applyAlg(physicalSolution);
      const solved = typeof pattern.experimentalIsSolved === "function"
        ? pattern.experimentalIsSolved({ ignorePuzzleOrientation: false })
        : JSON.stringify(pattern.patternData) === JSON.stringify(kpuzzle.defaultPattern().patternData);
      if (!solved) return null;
    } catch (_) {
      return null;
    }
    return {
      ...logicalResult,
      solution: physicalSolution,
      moveCount: countMetric444Moves(physicalSolution),
      stages: physicalStages,
      meta: {
        ...logicalResult.meta,
        method444: "yau",
        crossColor,
        yauCanonicalCrossColor: "D",
        yauFrameRotation: baseOrientation.token,
        yauFrameSpin: candidate.spin || "identity",
        yauFrameAttemptCount: attempts.length,
        yauFrameAttempts: attempts,
        fullVerificationSolved: true,
      },
    };
  };'''
new = '''  const mapVerifiedSuccess = async (logicalResult, candidate) => {
    const mappedPhysicalSolution = mapLogical444SequenceToPhysical(logicalResult.solution, candidate.orientation);
    if (mappedPhysicalSolution == null) return null;
    const physicalStages = [];
    for (const stage of Array.isArray(logicalResult.stages) ? logicalResult.stages : []) {
      const mappedStage = mapYauStageToPhysical444(stage, candidate.orientation);
      if (!mappedStage) return null;
      physicalStages.push(mappedStage);
    }

    const presentation = await humanizeMappedYauStages444(publicScramble, physicalStages, crossColor);
    const presentedStages = presentation.stages;
    const physicalSolution = presentedStages
      .map((stage) => String(stage?.solution || "").trim())
      .filter(Boolean)
      .join(" ");

    try {
      const { puzzles } = await import("../vendor/cubing/puzzles/index.js");
      const kpuzzle = await puzzles["4x4x4"].kpuzzle();
      let pattern = kpuzzle.defaultPattern();
      if (publicScramble) pattern = pattern.applyAlg(publicScramble);
      if (physicalSolution) pattern = pattern.applyAlg(physicalSolution);
      const solved = typeof pattern.experimentalIsSolved === "function"
        ? pattern.experimentalIsSolved({ ignorePuzzleOrientation: false })
        : JSON.stringify(pattern.patternData) === JSON.stringify(kpuzzle.defaultPattern().patternData);
      if (!solved) return null;
    } catch (_) {
      return null;
    }
    return {
      ...logicalResult,
      solution: physicalSolution,
      moveCount: countMetric444Moves(physicalSolution),
      stages: presentedStages,
      meta: {
        ...logicalResult.meta,
        method444: "yau",
        crossColor,
        yauCanonicalCrossColor: "D",
        yauFrameRotation: baseOrientation.token,
        yauFrameSpin: candidate.spin || "identity",
        yauFrameAttemptCount: attempts.length,
        yauFrameAttempts: attempts,
        humanViewpointApplied: presentation.humanViewpointApplied,
        viewpointRotationCount: presentation.viewpointRotationCount,
        yauHumanGripApplied: presentation.yauHumanGripApplied,
        yauViewpointRotationCount: presentation.yauViewpointRotationCount,
        fullVerificationSolved: true,
      },
    };
  };'''
if old not in s:
    raise SystemExit("missing canonical mapVerifiedSuccess anchor")
s = s.replace(old, new, 1)

# 5) Respect __skipHumanPresentation in the inner logical solve.
old = '''  try {
    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
    const publicCfopStage = publicStages.find((stage) => stage?.id === "threeByThree");'''
new = '''  if (options?.__skipHumanPresentation !== true) {
    try {
      const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
      const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
      const publicCfopStage = publicStages.find((stage) => stage?.id === "threeByThree");'''
if old not in s:
    raise SystemExit("missing human presentation try anchor")
s = s.replace(old, new, 1)
old = '''  } catch (error) {
    console.warn("[444] human viewpoint presentation failed", error);
    publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);
    viewpointRotationCount = 0;
    yauViewpointRotationCount = 0;
    humanViewpointApplied = false;
    yauHumanGripApplied = false;
  }

  const completeSolution = publicStages'''
new = '''    } catch (error) {
      console.warn("[444] human viewpoint presentation failed", error);
      publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);
      viewpointRotationCount = 0;
      yauViewpointRotationCount = 0;
      humanViewpointApplied = false;
      yauHumanGripApplied = false;
    }
  }

  const completeSolution = publicStages'''
if old not in s:
    raise SystemExit("missing human presentation catch anchor")
s = s.replace(old, new, 1)

solver.write_text(s)

# 6) Lock the intended public geometry into regression tests.
verify = Path("tools/verify-444-yau.mjs")
v = verify.read_text()
old = '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");'''
new = '''  assert.equal(centerColorGroupedSomewhere(pattern, crossColor), true, "human-view Cross 3/4 lost the cross center");
  assert.equal(centerColorGroupedSomewhere(pattern, OPPOSITE[crossColor]), true, "human-view Cross 3/4 lost the opposite center");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "human-view Cross 3/4 must keep the cross center on the R face");'''
if old not in v:
    raise SystemExit("missing Cross 3/4 verification anchor")
v = v.replace(old, new, 1)
old = '''  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;'''
new = '''  assert.equal(allCentersGrouped(pattern), true, "Yau remaining centers did not finish all centers");
  assert.equal(centerFaceForColor(pattern, crossColor), "R", "Yau remaining centers must keep the 3-cross on the R face");
  pattern = setup.segments[4].solution ? pattern.applyAlg(setup.segments[4].solution) : pattern;
  assert.equal(centerFaceForColor(pattern, crossColor), "D", "Yau Cross 4/4 must return the cross center to the D face before 3-2-3");'''
if old not in v:
    raise SystemExit("missing Remaining Centers verification anchor")
v = v.replace(old, new, 1)
verify.write_text(v)
