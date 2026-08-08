import re
from pathlib import Path

solver = Path("solver/solver444.js")
s = solver.read_text()

pattern = r'''async function humanizeMappedYauStages444\(publicScramble, sourceStages, crossColor\) \{.*?\n\}\n\nfunction simplifyCfop444OuterMoves'''
replacement = r'''async function humanizeMappedYauStages444(publicScramble, sourceStages, crossColor) {
  const baselineStages = structuredClone(Array.isArray(sourceStages) ? sourceStages : []);
  const stages = structuredClone(baselineStages);
  const fallback = () => ({
    stages: baselineStages,
    humanViewpointApplied: false,
    viewpointRotationCount: 0,
    yauHumanGripApplied: false,
    yauViewpointRotationCount: 0,
  });
  try {
    const centerStage = stages.find((stage) => stage?.id === "centers");
    const edgeStage = stages.find((stage) => stage?.id === "edges");
    const cfopStage = stages.find((stage) => stage?.id === "threeByThree");
    if (!centerStage?.segments?.length || !edgeStage?.segments?.length) return fallback();

    const normalizedCross = /^[URFDLB]$/.test(String(crossColor || "")) ? String(crossColor) : "D";
    const opposite = OPPOSITE_FACE_444[normalizedCross];
    const firstCenterCandidates = VIEW_ORIENTATIONS_444.filter(
      (entry) => entry.map.U === normalizedCross,
    );
    const oppositeCenterCandidates = VIEW_ORIENTATIONS_444.filter(
      (entry) => entry.map.D === normalizedCross && entry.map.U === opposite,
    );
    const crossRightCandidates = VIEW_ORIENTATIONS_444.filter(
      (entry) => entry.map.R === normalizedCross && entry.map.L === opposite,
    );
    const crossDownCandidates = VIEW_ORIENTATIONS_444.filter(
      (entry) => entry.map.D === normalizedCross && entry.map.U === opposite,
    );
    if (!firstCenterCandidates.length || !oppositeCenterCandidates.length ||
        !crossRightCandidates.length || !crossDownCandidates.length) return fallback();

    // Human Yau grip policy:
    //   Center 1           : cross color on U
    //   Opposite center    : cross color on D
    //   Cross 3/4 + centers: cross color on visible R
    //   Cross 4/4 + 3-2-3  : one fixed cross-down yaw
    // Restore the public frame only after edge pairing is complete.
    let bestYau = null;
    for (const edgeGrip of crossDownCandidates) {
      const combined = [...centerStage.segments, ...edgeStage.segments];
      const candidateSets = [];
      for (let index = 0; index < centerStage.segments.length; index += 1) {
        if (index === 0) candidateSets.push(firstCenterCandidates);
        else if (index === 1) candidateSets.push(oppositeCenterCandidates);
        else if (index === 2 || index === 3) candidateSets.push(crossRightCandidates);
        else candidateSets.push([edgeGrip]);
      }
      for (let index = 0; index < edgeStage.segments.length; index += 1) {
        candidateSets.push([edgeGrip]);
      }
      const human = humanizeAbsoluteSegments444(combined, candidateSets);
      if (!human?.segments?.length) continue;
      const tokenCount = human.segments.reduce(
        (sum, segment) => sum + splitAlgorithm(segment?.solution).length,
        0,
      );
      const score = human.rotationCount * 100000 + tokenCount;
      if (!bestYau || score < bestYau.score) bestYau = { ...human, score };
    }
    if (!bestYau) return fallback();

    const centerCount = centerStage.segments.length;
    centerStage.segments = bestYau.segments.slice(0, centerCount);
    edgeStage.segments = bestYau.segments.slice(centerCount);
    centerStage.solution = centerStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
    edgeStage.solution = edgeStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");

    let cfopRotationCount = 0;
    if (cfopStage?.segments?.length) {
      const cfopHuman = buildHumanCfopPresentation444(cfopStage.segments, crossColor);
      if (cfopHuman) {
        cfopStage.segments = cfopHuman.segments;
        cfopStage.solution = cfopHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
        cfopRotationCount = cfopHuman.rotationCount;
      }
    }

    // Center and edge presentation intentionally share a rotated grip. They
    // must be equivalent as one block; the edge stage restores the frame.
    const baselineCheck = [
      {
        solution: baselineStages
          .filter((stage) => stage?.id === "centers" || stage?.id === "edges")
          .map((stage) => String(stage?.solution || "").trim())
          .filter(Boolean)
          .join(" "),
      },
      {
        solution: String(baselineStages.find((stage) => stage?.id === "threeByThree")?.solution || "").trim(),
      },
    ];
    const candidateCheck = [
      { solution: [centerStage.solution, edgeStage.solution].filter(Boolean).join(" ") },
      { solution: String(cfopStage?.solution || "").trim() },
    ];
    const verified = await verifyEquivalent444Presentation(publicScramble, baselineCheck, candidateCheck);
    if (!verified) return fallback();

    return {
      stages,
      humanViewpointApplied: bestYau.rotationCount + cfopRotationCount > 0,
      viewpointRotationCount: bestYau.rotationCount + cfopRotationCount,
      yauHumanGripApplied: bestYau.rotationCount > 0,
      yauViewpointRotationCount: bestYau.rotationCount,
    };
  } catch (_) {
    return fallback();
  }
}

function simplifyCfop444OuterMoves'''
s2, n = re.subn(pattern, replacement, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit(f"Yau mapped humanizer replacement count={n}")
solver.write_text(s2)

verify = Path("tools/verify-444-yau.mjs")
v = verify.read_text()
pattern = re.compile(
    r'''  assert\.equal\(\(pairedTypeMask\(pattern\) & targetMask\), targetMask, "Yau Cross 4/4 did not pair all cross dedges"\);\n'''
    r'''  assert\.equal\(\(solvedTypeMask\(pattern\) & targetMask\), targetMask, "Yau Cross 4/4 did not align the completed cross"\);'''
)
replacement = '''  assert.equal((pairedTypeMask(pattern) & targetMask), targetMask, "Yau Cross 4/4 did not pair all cross dedges");
  assert.equal(
    pairedCrossTypesAdjacentToCenter(pattern, crossColor) & targetMask,
    targetMask,
    "Yau Cross 4/4 is not a complete cross around the D-face cross center",
  );'''
v2, n = pattern.subn(replacement, v, count=1)
if n != 1:
    raise SystemExit(f"Cross 4 human-frame assertion replacement count={n}")
verify.write_text(v2)
