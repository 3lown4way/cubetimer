from pathlib import Path

# 1) Expose exact center phase boundaries from Rust.
p = Path('solver444-wasm/src/centers.rs')
s = p.read_text()
s = s.replace(
'''pub struct CenterSolveResult {\n    pub moves: Vec<Move444>,\n    pub table_build_ms: f64,\n    pub search_ms: f64,\n}\n''',
'''pub struct CenterSolveResult {\n    pub moves: Vec<Move444>,\n    pub phase_move_counts: [usize; 4],\n    pub table_build_ms: f64,\n    pub search_ms: f64,\n}\n''')

old = '''    descend_single(\n        &mut working,\n        &mut moves,\n        &[frame.cross_color],\n        &ALL_CENTER_POSITIONS,\n        4,\n        &tables.phase1_distance,\n        &tables.phase1_moves,\n        "phase1-cross",\n        deadline_ts,\n    )?;\n    descend_macro_single(\n'''
new = '''    descend_single(\n        &mut working,\n        &mut moves,\n        &[frame.cross_color],\n        &ALL_CENTER_POSITIONS,\n        4,\n        &tables.phase1_distance,\n        &tables.phase1_moves,\n        "phase1-cross",\n        deadline_ts,\n    )?;\n    let phase1_end = moves.len();\n    descend_macro_single(\n'''
if old not in s:
    raise SystemExit('phase1 boundary marker missing')
s = s.replace(old, new, 1)
old = '''        "phase2-opposite",\n        deadline_ts,\n    )?;\n    descend_single(\n'''
new = '''        "phase2-opposite",\n        deadline_ts,\n    )?;\n    let phase2_end = moves.len();\n    descend_single(\n'''
if old not in s:
    raise SystemExit('phase2 boundary marker missing')
s = s.replace(old, new, 1)
old = '''        "phase3-sides",\n        deadline_ts,\n    )?;\n    descend_pair(&mut working, &mut moves, deadline_ts, tables)?;\n    check_deadline(deadline_ts)?;\n'''
new = '''        "phase3-sides",\n        deadline_ts,\n    )?;\n    let phase3_end = moves.len();\n    descend_pair(&mut working, &mut moves, deadline_ts, tables)?;\n    check_deadline(deadline_ts)?;\n'''
if old not in s:
    raise SystemExit('phase3 boundary marker missing')
s = s.replace(old, new, 1)
old = '''    Ok(CenterSolveResult {\n        moves,\n        table_build_ms: if tables_were_ready {\n'''
new = '''    let phase4_end = moves.len();\n    Ok(CenterSolveResult {\n        moves,\n        phase_move_counts: [\n            phase1_end,\n            phase2_end - phase1_end,\n            phase3_end - phase2_end,\n            phase4_end - phase3_end,\n        ],\n        table_build_ms: if tables_were_ready {\n'''
if old not in s:
    raise SystemExit('CenterSolveResult construction marker missing')
s = s.replace(old, new, 1)
p.write_text(s)

# 2) Serialize center phase counts through the WASM boundary.
p = Path('solver444-wasm/src/api.rs')
s = p.read_text()
s = s.replace('    center_move_count: usize,\n    center_table_build_ms: f64,', '    center_move_count: usize,\n    center_phase_move_counts: [usize; 4],\n    center_table_build_ms: f64,', 1)
s = s.replace('    center_move_count: usize,\n    center_table_build_ms: f64,', '    center_move_count: usize,\n    center_phase_move_counts: [usize; 4],\n    center_table_build_ms: f64,', 1)
s = s.replace('            center_move_count: state.center_move_count,\n            center_table_build_ms:', '            center_move_count: state.center_move_count,\n            center_phase_move_counts: state.center_phase_move_counts,\n            center_table_build_ms:', 1)
s = s.replace('    boundary.center_move_count = center_result.moves.len();\n    boundary.center_table_build_ms', '    boundary.center_move_count = center_result.moves.len();\n    boundary.center_phase_move_counts = center_result.phase_move_counts;\n    boundary.center_table_build_ms', 1)
p.write_text(s)

# 3) Add orientation-aware public presentation. Internal verified moves stay absolute.
p = Path('solver/solver444.js')
s = p.read_text()
marker = '''function simplifyCfop444OuterMoves(moves) {\n'''
helper = r'''const VIEW_FACE_ORDER_444 = Object.freeze(["U", "R", "F", "D", "L", "B"]);
const VIEW_ROTATION_TOKENS_444 = Object.freeze(["x", "x2", "x'", "y", "y2", "y'", "z", "z2", "z'"]);
const CUBE_ROTATION_444_RE = /^[xyz](?:2|')?$/i;
const OPPOSITE_FACE_444 = Object.freeze({ U: "D", R: "L", F: "B", D: "U", L: "R", B: "F" });

function countMetric444Moves(sequence) {
  return splitAlgorithm(sequence).filter((token) => !CUBE_ROTATION_444_RE.test(token)).length;
}

function viewMapKey444(faceMap) {
  return VIEW_FACE_ORDER_444.map((face) => faceMap[face]).join("");
}

function rotationTokenAmount444(token) {
  const match = /^([xyz])(2|')?$/i.exec(String(token || "").trim());
  if (!match) return null;
  return {
    axis: match[1].toLowerCase(),
    amount: match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1,
  };
}

function applyViewRotation444(faceMap, token) {
  const parsed = rotationTokenAmount444(token);
  if (!parsed) return null;
  const rotation = cfop444RotationMap(parsed.axis, parsed.amount);
  if (!rotation) return null;
  return cfop444ComposeFaceMaps(faceMap, rotation);
}

function buildViewOrientations444() {
  const start = { ...CFOP_444_IDENTITY_FACE_MAP };
  const queue = [{ map: start, path: [] }];
  const byKey = new Map([[viewMapKey444(start), queue[0]]]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const token of VIEW_ROTATION_TOKENS_444) {
      const nextMap = applyViewRotation444(current.map, token);
      const key = viewMapKey444(nextMap);
      if (byKey.has(key)) continue;
      const entry = { map: nextMap, path: [...current.path, token] };
      byKey.set(key, entry);
      queue.push(entry);
    }
  }
  if (queue.length !== 24) throw new Error(`INVALID_444_ORIENTATION_GROUP:${queue.length}`);
  return Object.freeze(queue.map((entry, index) => Object.freeze({
    index,
    map: Object.freeze({ ...entry.map }),
    path: Object.freeze([...entry.path]),
    key: viewMapKey444(entry.map),
  })));
}

const VIEW_ORIENTATIONS_444 = buildViewOrientations444();
const VIEW_ORIENTATION_BY_KEY_444 = new Map(VIEW_ORIENTATIONS_444.map((entry) => [entry.key, entry]));
const VIEW_ROTATION_PATH_CACHE_444 = new Map();

function shortestViewRotationPath444(from, to) {
  if (from.key === to.key) return [];
  const cacheKey = `${from.key}>${to.key}`;
  const cached = VIEW_ROTATION_PATH_CACHE_444.get(cacheKey);
  if (cached) return [...cached];
  const queue = [{ map: { ...from.map }, path: [] }];
  const seen = new Set([from.key]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const token of VIEW_ROTATION_TOKENS_444) {
      const nextMap = applyViewRotation444(current.map, token);
      const key = viewMapKey444(nextMap);
      if (seen.has(key)) continue;
      const path = [...current.path, token];
      if (key === to.key) {
        VIEW_ROTATION_PATH_CACHE_444.set(cacheKey, path);
        return [...path];
      }
      seen.add(key);
      queue.push({ map: nextMap, path });
    }
  }
  return [];
}

function remapPhysical444MoveForView(token, orientation) {
  const match = /^([URFDLB])(w)?(2|')?$/.exec(String(token || "").trim());
  if (!match) return null;
  const physicalFace = match[1];
  const logicalFace = VIEW_FACE_ORDER_444.find((face) => orientation.map[face] === physicalFace);
  if (!logicalFace) return null;
  return `${logicalFace}${match[2] || ""}${match[3] || ""}`;
}

function remapPhysical444SequenceForView(sequence, orientation) {
  const output = [];
  for (const token of splitAlgorithm(sequence)) {
    const remapped = remapPhysical444MoveForView(token, orientation);
    if (!remapped) return null;
    output.push(remapped);
  }
  return output;
}

function viewRotationExecutionCost444(tokens) {
  return tokens.reduce((cost, token) => cost + (String(token).includes("2") ? 1.25 : 0.9), 0);
}

function viewMoveExecutionCost444(tokens) {
  const faceWeight = { U: 0.7, R: 0.65, F: 0.75, D: 1.05, L: 1.2, B: 2.7 };
  let cost = 0;
  for (const token of tokens) {
    const match = /^([URFDLB])(w)?(2|')?$/.exec(token);
    if (!match) continue;
    cost += faceWeight[match[1]] ?? 1;
    if (match[2]) cost += match[1] === "B" ? 1.0 : 0.35;
    if (match[3] === "2") cost *= 0.985;
  }
  return cost;
}

function humanizeAbsoluteSegments444(segments, candidateSets) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const identity = VIEW_ORIENTATION_BY_KEY_444.get(viewMapKey444(CFOP_444_IDENTITY_FACE_MAP));
  const normalizedCandidates = segments.map((segment, index) => {
    const moves = splitAlgorithm(segment?.solution);
    if (!moves.length) return VIEW_ORIENTATIONS_444;
    const candidates = Array.isArray(candidateSets?.[index]) && candidateSets[index].length
      ? candidateSets[index]
      : VIEW_ORIENTATIONS_444;
    return candidates;
  });
  const remapCache = new Map();
  const remappedFor = (segmentIndex, orientation) => {
    const key = `${segmentIndex}:${orientation.key}`;
    if (remapCache.has(key)) return remapCache.get(key);
    const value = remapPhysical444SequenceForView(segments[segmentIndex]?.solution || "", orientation);
    remapCache.set(key, value);
    return value;
  };

  let previous = new Map([[identity.key, { cost: 0, orientation: identity, path: [] }]]);
  const layers = [];
  for (let index = 0; index < segments.length; index += 1) {
    const next = new Map();
    for (const target of normalizedCandidates[index]) {
      const remapped = remappedFor(index, target);
      if (!remapped) continue;
      for (const state of previous.values()) {
        const transition = shortestViewRotationPath444(state.orientation, target);
        const cost = state.cost
          + viewRotationExecutionCost444(transition)
          + viewMoveExecutionCost444(remapped);
        const existing = next.get(target.key);
        if (!existing || cost < existing.cost) {
          next.set(target.key, {
            cost,
            orientation: target,
            previousKey: state.orientation.key,
          });
        }
      }
    }
    if (!next.size) return null;
    layers.push(next);
    previous = next;
  }

  let best = null;
  for (const state of previous.values()) {
    const restore = shortestViewRotationPath444(state.orientation, identity);
    const cost = state.cost + viewRotationExecutionCost444(restore);
    if (!best || cost < best.cost) best = { ...state, cost };
  }
  if (!best) return null;

  const chosen = new Array(segments.length);
  let key = best.orientation.key;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const state = layers[index].get(key);
    if (!state) return null;
    chosen[index] = state.orientation;
    key = state.previousKey;
  }

  const output = [];
  let current = identity;
  let rotationCount = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const target = chosen[index];
    const transition = shortestViewRotationPath444(current, target);
    const remapped = remappedFor(index, target) || [];
    rotationCount += transition.length;
    output.push({
      ...segments[index],
      solution: [...transition, ...remapped].join(" "),
      moveCount: countMetric444Moves(segments[index]?.solution || ""),
      viewpointRotations: transition.length,
    });
    current = target;
  }
  const restore = shortestViewRotationPath444(current, identity);
  if (restore.length) {
    const last = output[output.length - 1];
    last.solution = [last.solution, restore.join(" ")].filter(Boolean).join(" ");
    last.viewpointRotations += restore.length;
    rotationCount += restore.length;
  }
  return { segments: output, rotationCount };
}

function buildHumanCenterPresentation444(centerStage, phaseMoveCounts, crossColor) {
  const moves = splitAlgorithm(centerStage?.solution);
  const counts = Array.from(phaseMoveCounts || [], Number).map((value) => Math.max(0, Math.floor(value || 0)));
  if (counts.length !== 4 || counts.reduce((sum, value) => sum + value, 0) !== moves.length || !moves.length) {
    return null;
  }
  const p1End = counts[0];
  const p2End = p1End + counts[1];
  const firstTwo = counts[0] + counts[1];
  const segments = [
    {
      id: "centerCross",
      name: "Centers · Cross Color",
      solution: moves.slice(0, p1End).join(" "),
      moveCount: counts[0],
      verified: true,
    },
    {
      id: "centerOpposite",
      name: "Centers · Opposite",
      solution: moves.slice(p1End, p2End).join(" "),
      moveCount: counts[1],
      verified: true,
    },
    {
      id: "centerRemaining",
      name: "Centers · Remaining 4",
      solution: moves.slice(firstTwo).join(" "),
      moveCount: counts[2] + counts[3],
      verified: true,
    },
  ];
  const normalizedCross = /^[URFDLB]$/.test(String(crossColor || "")) ? String(crossColor) : "D";
  const opposite = OPPOSITE_FACE_444[normalizedCross];
  const firstCandidates = VIEW_ORIENTATIONS_444.filter((entry) => entry.map.U === normalizedCross);
  const oppositeCandidates = VIEW_ORIENTATIONS_444.filter((entry) => entry.map.U === opposite);
  const remainingCandidates = VIEW_ORIENTATIONS_444.filter((entry) => {
    const pair = new Set([entry.map.L, entry.map.R]);
    return pair.has(normalizedCross) && pair.has(opposite);
  });
  return humanizeAbsoluteSegments444(segments, [firstCandidates, oppositeCandidates, remainingCandidates]);
}

function buildHumanYawPresentation444(segments) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const yawCandidates = VIEW_ORIENTATIONS_444.filter((entry) => entry.map.U === "U" && entry.map.D === "D");
  return humanizeAbsoluteSegments444(segments, segments.map(() => yawCandidates));
}

function buildHumanCfopPresentation444(segments, crossColor) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const normalizedCross = /^[URFDLB]$/.test(String(crossColor || "")) ? String(crossColor) : "D";
  const crossDownCandidates = VIEW_ORIENTATIONS_444.filter((entry) => entry.map.D === normalizedCross);
  return humanizeAbsoluteSegments444(segments, segments.map(() => crossDownCandidates));
}

async function verifyEquivalent444Presentation(publicScramble, baselineStages, candidateStages) {
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
if 'function buildHumanCenterPresentation444(' not in s:
    if marker not in s:
        raise SystemExit('human viewpoint insertion marker missing')
    s = s.replace(marker, helper + marker, 1)

s = s.replace('    enableHumanViewpoint: false,', '    enableHumanViewpoint: true,', 1)
# Preserve original center phase boundaries after the second boundary call used by 3-2-3.
s = s.replace('''      centerMoveCount: Number(centerStage.moveCount) || 0,\n      centerTableBuildMs:''', '''      centerMoveCount: Number(centerStage.moveCount) || 0,\n      centerPhaseMoveCounts: Array.isArray(reduction.meta?.centerPhaseMoveCounts)\n        ? [...reduction.meta.centerPhaseMoveCounts]\n        : [0, 0, 0, 0],\n      centerTableBuildMs:''', 1)

old_block = '''  try {\n    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");\n    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");\n    if (publicEdgeStage && publicEdgeStage.method !== "3-2-3") {\n      publicEdgeStage.segments = await buildEdgePairingSegments(\n        publicScramble,\n        publicCenterStage?.solution || "",\n        publicEdgeStage.solution || "",\n      );\n    }\n  } catch (error) {\n    console.warn("[444] edge pairing segmentation failed", error);\n  }\n  const completeSolution = publicStages\n    .map((stage) => String(stage.solution || "").trim())\n    .filter(Boolean)\n    .join(" ");\n  const moveCount = splitAlgorithm(completeSolution).length;\n'''
new_block = '''  try {\n    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");\n    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");\n    if (publicEdgeStage && publicEdgeStage.method !== "3-2-3") {\n      publicEdgeStage.segments = await buildEdgePairingSegments(\n        publicScramble,\n        publicCenterStage?.solution || "",\n        publicEdgeStage.solution || "",\n      );\n    }\n  } catch (error) {\n    console.warn("[444] edge pairing segmentation failed", error);\n  }\n\n  const rotationlessPublicStages = structuredClone(publicStages);\n  let humanViewpointApplied = false;\n  let viewpointRotationCount = 0;\n  try {\n    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");\n    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");\n    const publicCfopStage = publicStages.find((stage) => stage?.id === "threeByThree");\n\n    const centerHuman = publicCenterStage\n      ? buildHumanCenterPresentation444(publicCenterStage, result.meta?.centerPhaseMoveCounts, crossColor)\n      : null;\n    if (centerHuman) {\n      publicCenterStage.segments = centerHuman.segments;\n      publicCenterStage.solution = centerHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");\n      publicCenterStage.method = "Cross → Opposite → Remaining 4";\n      viewpointRotationCount += centerHuman.rotationCount;\n    }\n\n    const edgeHuman = publicEdgeStage?.segments?.length\n      ? buildHumanYawPresentation444(publicEdgeStage.segments)\n      : null;\n    if (edgeHuman) {\n      publicEdgeStage.segments = edgeHuman.segments;\n      publicEdgeStage.solution = edgeHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");\n      viewpointRotationCount += edgeHuman.rotationCount;\n    }\n\n    const cfopHuman = publicCfopStage?.segments?.length\n      ? buildHumanCfopPresentation444(publicCfopStage.segments, crossColor)\n      : null;\n    if (cfopHuman) {\n      publicCfopStage.segments = cfopHuman.segments;\n      publicCfopStage.solution = cfopHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");\n      viewpointRotationCount += cfopHuman.rotationCount;\n    }\n\n    humanViewpointApplied = viewpointRotationCount > 0\n      && await verifyEquivalent444Presentation(publicScramble, rotationlessPublicStages, publicStages);\n    if (!humanViewpointApplied) {\n      publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);\n      viewpointRotationCount = 0;\n    }\n  } catch (error) {\n    console.warn("[444] human viewpoint presentation failed", error);\n    publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);\n    viewpointRotationCount = 0;\n    humanViewpointApplied = false;\n  }\n\n  const completeSolution = publicStages\n    .map((stage) => String(stage.solution || "").trim())\n    .filter(Boolean)\n    .join(" ");\n  const moveCount = countMetric444Moves(completeSolution);\n'''
if old_block not in s:
    raise SystemExit('public stage postprocess block missing')
s = s.replace(old_block, new_block, 1)
s = s.replace('''      cfopMethod: "CFOP",\n      fullVerificationSolved: true,\n''', '''      cfopMethod: "CFOP",\n      crossColor,\n      humanViewpointApplied,\n      viewpointRotationCount,\n      fullVerificationSolved: true,\n''', 1)
p.write_text(s)

# 4) Update contracts for rotations and explicit human center stages.
p = Path('tools/verify-444-worker-boundary.mjs')
s = p.read_text()
s = s.replace('assert.equal(valid.moveCount, valid.solution.split(/\\s+/).filter(Boolean).length);', 'assert.equal(valid.moveCount, valid.solution.split(/\\s+/).filter((move) => move && !/^[xyz](?:2|\u0027)?$/i.test(move)).length);')
s = s.replace('assert.match(solver444Source, /enableHumanViewpoint: false/);', 'assert.match(solver444Source, /enableHumanViewpoint: true/);')
insert_after = '''assert.equal(valid.stages[3].moveCount, valid.meta.cfopMoveCount);\n'''
extra = '''assert.equal(valid.meta.humanViewpointApplied, true);\nassert.ok(valid.meta.viewpointRotationCount > 0);\nassert.equal(valid.stages[0].method, "Cross → Opposite → Remaining 4");\nassert.deepEqual(\n  valid.stages[0].segments.map((stage) => stage.name),\n  ["Centers · Cross Color", "Centers · Opposite", "Centers · Remaining 4"],\n);\nassert.ok(valid.stages[0].segments.some((stage) => /(?:^|\\s)[xyz](?:2|')?(?:\\s|$)/.test(stage.solution)));\nassert.equal(\n  valid.stages[0].segments.map((stage) => stage.solution).filter(Boolean).join(" "),\n  valid.stages[0].solution,\n);\n'''
if extra.strip() not in s:
    if insert_after not in s:
        raise SystemExit('worker contract insertion marker missing')
    s = s.replace(insert_after, insert_after + extra, 1)
p.write_text(s)

p = Path('tools/verify-444-public-notation.mjs')
s = p.read_text()
s = s.replace('assert.match(move, /^[URFDLB](?:2|\u0027)?$/, `4x4 CFOP emitted unsupported move ${move}`);', 'assert.match(move, /^(?:[URFDLB](?:2|\u0027)?|[xyz](?:2|\u0027)?)$/, `4x4 CFOP emitted unsupported move ${move}`);')
center_marker = '''  assert.ok(centerStage?.verified, "verified Centers stage is missing");\n'''
center_extra = '''  assert.equal(centerStage.method, "Cross → Opposite → Remaining 4");\n  assert.deepEqual(\n    centerStage.segments.map((stage) => stage.name),\n    ["Centers · Cross Color", "Centers · Opposite", "Centers · Remaining 4"],\n  );\n  assert.ok(centerStage.segments.some((stage) => /(?:^|\\s)[xyz](?:2|')?(?:\\s|$)/.test(stage.solution)));\n'''
if center_extra.strip() not in s:
    if center_marker not in s:
        raise SystemExit('public notation center marker missing')
    s = s.replace(center_marker, center_marker + center_extra, 1)
p.write_text(s)
