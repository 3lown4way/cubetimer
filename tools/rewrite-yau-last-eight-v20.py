from pathlib import Path
import runpy
import re

runpy.run_path('tools/rewrite-yau-last-eight-v19.py', run_name='__main__')

p = Path('solver/solver444.js')
s = p.read_text()

pattern = re.compile(r'async function humanizeMappedYauStages444\([\s\S]*?\n\}\n\n(?=function simplifyCfop444OuterMoves)')
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

    // One continuous human grip path for the entire Yau solve:
    //   first center              -> cross color U
    //   opposite center           -> cross color D
    //   Cross 3/4 + last centers  -> cross color visible R
    //   Cross 4/4                 -> cross color D
    //   complete 3-2-3            -> keep the SAME cross-down grip
    //   CFOP                       -> remain cross-down; yaw changes are allowed
    // The public/identity frame is restored only after the final CFOP move.
    // This avoids the old edge-stage reset that visibly moved an F/B/R/L
    // cross off D between Last 3 and CFOP.
    let bestYau = null;
    for (const edgeGrip of crossDownCandidates) {
      const centerSegments = centerStage.segments;
      const edgeSegments = edgeStage.segments;
      const cfopSegments = Array.isArray(cfopStage?.segments) ? cfopStage.segments : [];
      const combined = [...centerSegments, ...edgeSegments, ...cfopSegments];
      const candidateSets = [];

      for (let index = 0; index < centerSegments.length; index += 1) {
        if (index === 0) candidateSets.push(firstCenterCandidates);
        else if (index === 1) candidateSets.push(oppositeCenterCandidates);
        else if (index === 2 || index === 3) candidateSets.push(crossRightCandidates);
        else candidateSets.push([edgeGrip]);
      }
      for (let index = 0; index < edgeSegments.length; index += 1) {
        candidateSets.push([edgeGrip]);
      }
      for (let index = 0; index < cfopSegments.length; index += 1) {
        // All of these orientations keep the cross on D. Changing between
        // them is therefore only a yaw/regrip while preserving cross-down.
        candidateSets.push(crossDownCandidates);
      }

      const human = humanizeAbsoluteSegments444(combined, candidateSets);
      if (!human?.segments?.length || human.segments.length !== combined.length) continue;
      const tokenCount = human.segments.reduce(
        (sum, segment) => sum + splitAlgorithm(segment?.solution).length,
        0,
      );
      const score = human.rotationCount * 100000 + tokenCount;
      if (!bestYau || score < bestYau.score) bestYau = { ...human, score };
    }
    if (!bestYau) return fallback();

    const centerCount = centerStage.segments.length;
    const edgeCount = edgeStage.segments.length;
    const cfopCount = Array.isArray(cfopStage?.segments) ? cfopStage.segments.length : 0;
    const edgeStart = centerCount;
    const cfopStart = centerCount + edgeCount;

    centerStage.segments = bestYau.segments.slice(0, centerCount);
    edgeStage.segments = bestYau.segments.slice(edgeStart, cfopStart);
    centerStage.solution = centerStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
    edgeStage.solution = edgeStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
    if (cfopStage && cfopCount) {
      cfopStage.segments = bestYau.segments.slice(cfopStart, cfopStart + cfopCount);
      cfopStage.solution = cfopStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
    }

    // Grip rotations intentionally cross stage boundaries now. Validate the
    // whole Yau solve as one exact transformation instead of forcing centers,
    // edges, and CFOP to each return to the public frame independently.
    const baselineCombined = baselineStages
      .map((stage) => String(stage?.solution || "").trim())
      .filter(Boolean)
      .join(" ");
    const candidateCombined = stages
      .map((stage) => String(stage?.solution || "").trim())
      .filter(Boolean)
      .join(" ");
    const verified = await verifyEquivalent444Presentation(
      publicScramble,
      [{ solution: baselineCombined }],
      [{ solution: candidateCombined }],
    );
    if (!verified) return fallback();

    return {
      stages,
      humanViewpointApplied: bestYau.rotationCount > 0,
      viewpointRotationCount: bestYau.rotationCount,
      yauHumanGripApplied: bestYau.rotationCount > 0,
      yauViewpointRotationCount: bestYau.rotationCount,
    };
  } catch (_) {
    return fallback();
  }
}

'''
s, n = pattern.subn(lambda _: replacement, s, count=1)
if n != 1:
    raise SystemExit(f'humanizeMappedYauStages444 replacement count {n}')

p.write_text(s)
print('kept cross-down grip continuously from Cross 4/4 through 3-2-3 and CFOP')
