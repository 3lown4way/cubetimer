from pathlib import Path

# Preserve exact Cross3 step boundaries so presentation can regrip between
# individual Yau edge insertions instead of freezing one view for the whole 3-cross.
edge_path = Path('solver/edgePairing444.js')
edge = edge_path.read_text()
old = '''  const simplified = simplifyOuterSequence(moves);
  const solution = simplified.join(" ");
  let verified = pattern;
'''
new = '''  // Each committed candidate is already simplified. Keep the boundaries
  // between human edge-insertion steps intact rather than cancelling across
  // them; the presentation layer may then regrip between steps while the
  // cross center stays on the R face.
  const simplified = [...moves];
  const solution = simplified.join(" ");
  let verified = pattern;
'''
# Replace only the occurrence inside solveYauCross3Natural444: anchor from function.
pos = edge.find('export async function solveYauCross3Natural444')
if pos < 0:
    raise SystemExit('Cross3 function missing')
sub = edge[pos:]
if old not in sub:
    raise SystemExit('Cross3 simplify anchor missing')
sub = sub.replace(old, new, 1)
edge = edge[:pos] + sub
edge_path.write_text(edge)

solver_path = Path('solver/solver444.js')
solver = solver_path.read_text()
old_segment = '''    makeSetupSegment("yauCross3", "Yau · Cross Edges 3/4", cross3.solution, {
      crossEdgeCount: 3,
      lockedTypeMask: cross3.lockedTypeMask,
    }),
'''
new_segment = '''    makeSetupSegment("yauCross3", "Yau · Cross Edges 3/4", cross3.solution, {
      crossEdgeCount: 3,
      lockedTypeMask: cross3.lockedTypeMask,
      humanStepMoveCounts: Array.isArray(cross3.steps)
        ? cross3.steps.map((step) => Math.max(0, Number(step?.moveCount) || 0))
        : [],
    }),
'''
if old_segment not in solver:
    raise SystemExit('setup Cross3 segment anchor missing')
solver = solver.replace(old_segment, new_segment, 1)

old_loop = '''    let bestYau = null;
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
'''
new_loop = '''    const sourceCenterSegments = centerStage.segments;
    const expandedCenterSegments = [];
    const expandedCenterParents = [];
    for (let index = 0; index < sourceCenterSegments.length; index += 1) {
      const segment = sourceCenterSegments[index];
      const tokens = splitAlgorithm(segment?.solution);
      const rawCounts = index === 2 && Array.isArray(segment?.humanStepMoveCounts)
        ? segment.humanStepMoveCounts.map((value) => Math.max(0, Math.floor(Number(value) || 0)))
        : [];
      const canSplit = rawCounts.length > 1 &&
        rawCounts.every((value) => value > 0) &&
        rawCounts.reduce((sum, value) => sum + value, 0) === tokens.length;
      if (!canSplit) {
        expandedCenterSegments.push(segment);
        expandedCenterParents.push(index);
        continue;
      }
      let cursor = 0;
      for (let part = 0; part < rawCounts.length; part += 1) {
        const count = rawCounts[part];
        expandedCenterSegments.push({
          ...segment,
          id: `${segment.id}HumanStep${part + 1}`,
          name: `${segment.name} · ${part + 1}/${rawCounts.length}`,
          solution: tokens.slice(cursor, cursor + count).join(" "),
        });
        expandedCenterParents.push(index);
        cursor += count;
      }
    }

    let bestYau = null;
    for (const edgeGrip of crossDownCandidates) {
      const edgeSegments = edgeStage.segments;
      const cfopSegments = Array.isArray(cfopStage?.segments) ? cfopStage.segments : [];
      const combined = [...expandedCenterSegments, ...edgeSegments, ...cfopSegments];
      const candidateSets = [];

      for (let index = 0; index < expandedCenterSegments.length; index += 1) {
        const parent = expandedCenterParents[index];
        if (parent === 0) candidateSets.push(firstCenterCandidates);
        else if (parent === 1) candidateSets.push(oppositeCenterCandidates);
        else if (parent === 2 || parent === 3) candidateSets.push(crossRightCandidates);
        else candidateSets.push([edgeGrip]);
      }
      for (let index = 0; index < edgeSegments.length; index += 1) {
        candidateSets.push([edgeGrip]);
      }
      for (let index = 0; index < cfopSegments.length; index += 1) {
        candidateSets.push(crossDownCandidates);
      }

      const human = humanizeAbsoluteSegments444(combined, candidateSets);
      if (!human?.segments?.length || human.segments.length !== combined.length) continue;
'''
if old_loop not in solver:
    raise SystemExit('human Yau loop anchor missing')
solver = solver.replace(old_loop, new_loop, 1)

old_collapse = '''    const centerCount = centerStage.segments.length;
    const edgeCount = edgeStage.segments.length;
    const cfopCount = Array.isArray(cfopStage?.segments) ? cfopStage.segments.length : 0;
    const edgeStart = centerCount;
    const cfopStart = centerCount + edgeCount;

    centerStage.segments = bestYau.segments.slice(0, centerCount);
    edgeStage.segments = bestYau.segments.slice(edgeStart, cfopStart);
    centerStage.solution = centerStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
'''
new_collapse = '''    const expandedCenterCount = expandedCenterSegments.length;
    const edgeCount = edgeStage.segments.length;
    const cfopCount = Array.isArray(cfopStage?.segments) ? cfopStage.segments.length : 0;
    const edgeStart = expandedCenterCount;
    const cfopStart = expandedCenterCount + edgeCount;

    const presentedCenterParts = bestYau.segments.slice(0, expandedCenterCount);
    centerStage.segments = sourceCenterSegments.map((segment, parent) => {
      const parts = presentedCenterParts.filter((_, index) => expandedCenterParents[index] === parent);
      if (!parts.length) return segment;
      return {
        ...segment,
        solution: parts.map((part) => part.solution).filter(Boolean).join(" "),
        viewpointRotations: parts.reduce((sum, part) => sum + (Number(part?.viewpointRotations) || 0), 0),
      };
    });
    edgeStage.segments = bestYau.segments.slice(edgeStart, cfopStart);
    centerStage.solution = centerStage.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
'''
if old_collapse not in solver:
    raise SystemExit('human Yau collapse anchor missing')
solver = solver.replace(old_collapse, new_collapse, 1)

solver_path.write_text(solver)
print('enabled per-edge R-face regrips inside Cross3 presentation')
