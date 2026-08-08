const SOLVER_444_MODULE_CANDIDATES = [
  new URL("../public/solver444-wasm/solver444_wasm.js", import.meta.url).href,
  // GitHub Pages publishes the public directory as the site root.
  new URL("../solver444-wasm/solver444_wasm.js", import.meta.url).href,
  new URL("../solver444-wasm/pkg/solver444_wasm.js", import.meta.url).href,
];

let solver444ApiPromise = null;
let solver444Api = null;
let solver444LastFailure = null;

function emitProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  try {
    void onProgress(progress);
  } catch (_) {
    // Progress reporting must never change the solve contract.
  }
}

function recordFailure(stage, target, error) {
  solver444LastFailure = {
    stage: String(stage || "unknown"),
    target: target ? String(target) : null,
    message: String(error?.message || error || "UNKNOWN_444_WASM_ERROR"),
    timestamp: Date.now(),
  };
  console.warn(
    `[444 WASM] ${solver444LastFailure.stage} failed${solver444LastFailure.target ? `: ${solver444LastFailure.target}` : ""}: ${solver444LastFailure.message}`,
  );
}

function deadlineReached(deadlineTs) {
  const deadline = Number(deadlineTs);
  return Number.isFinite(deadline) && deadline > 0 && Date.now() >= deadline;
}

export function translate444MoveConvention(sequence) {
  return String(sequence || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      let match = /^([URFDLB])(w)?(2|')?$/.exec(token);
      let face;
      let wide;
      let suffix;
      if (match) {
        [, face, wide = "", suffix = ""] = match;
      } else {
        match = /^([urfdlb])(2|')?$/.exec(token);
        if (!match) return token;
        face = match[1].toUpperCase();
        wide = "w";
        suffix = match[2] || "";
      }
      const normalized = `${face}${wide}${suffix}`;
      if (suffix === "2" || !["U", "R", "D", "L"].includes(face)) {
        return normalized;
      }
      return `${face}${wide}${suffix === "'" ? "" : "'"}`;
    })
    .join(" ");
}

const EDGE_SLOT_PAIRS_444 = Object.freeze([
  [8, 2], [9, 15], [5, 11], [10, 20], [21, 14], [6, 23],
  [22, 18], [3, 4], [7, 17], [19, 13], [16, 0], [12, 1],
]);
const EDGE_TYPE_BY_WING_444 = (() => {
  const edgeTypes = new Array(24).fill(-1);
  EDGE_SLOT_PAIRS_444.forEach((pair, edgeType) => {
    for (const wing of pair) edgeTypes[wing] = edgeType;
  });
  return Object.freeze(edgeTypes);
})();

function splitAlgorithm(sequence) {
  return String(sequence || "").trim().split(/\s+/).filter(Boolean);
}

const CFOP_444_IDENTITY_FACE_MAP = Object.freeze({
  U: "U", R: "R", F: "F", D: "D", L: "L", B: "B",
});
const CFOP_444_ROTATION_FACE_MAP = Object.freeze({
  x: Object.freeze({ U: "F", R: "R", F: "D", D: "B", L: "L", B: "U" }),
  y: Object.freeze({ U: "U", R: "B", F: "R", D: "D", L: "F", B: "L" }),
  z: Object.freeze({ U: "L", R: "U", F: "F", D: "R", L: "D", B: "B" }),
});
const CFOP_444_SLICE_EXPANSIONS = Object.freeze({
  M: Object.freeze(["L'", "R", "x'"]),
  E: Object.freeze(["D'", "U", "y'"]),
  S: Object.freeze(["F'", "B", "z"]),
});
const CFOP_444_WIDE_EXPANSIONS = Object.freeze({
  R: Object.freeze(["R", "M'"]),
  L: Object.freeze(["L", "M"]),
  U: Object.freeze(["U", "E'"]),
  D: Object.freeze(["D", "E"]),
  F: Object.freeze(["F", "S"]),
  B: Object.freeze(["B", "S'"]),
});

function cfop444TurnAmount(suffix) {
  const value = String(suffix || "");
  if (value.startsWith("2")) return 2;
  if (value === "'") return 3;
  return 1;
}

function cfop444FormatTurn(face, amount) {
  const normalized = ((Number(amount) % 4) + 4) % 4;
  if (!normalized) return "";
  if (normalized === 1) return face;
  if (normalized === 2) return `${face}2`;
  return `${face}'`;
}

function cfop444InvertToken(token) {
  const match = /^([A-Za-z]+)(2'?|')?$/.exec(String(token || "").trim());
  if (!match) return null;
  const amount = cfop444TurnAmount(match[2]);
  return cfop444FormatTurn(match[1], 4 - amount);
}

function cfop444PowerTokens(baseTokens, amount) {
  const normalized = ((Number(amount) % 4) + 4) % 4;
  if (normalized === 0) return [];
  if (normalized === 1) return [...baseTokens];
  if (normalized === 2) return [...baseTokens, ...baseTokens];
  const inverse = [];
  for (let index = baseTokens.length - 1; index >= 0; index -= 1) {
    const token = cfop444InvertToken(baseTokens[index]);
    if (!token) return null;
    inverse.push(token);
  }
  return inverse;
}

function cfop444ComposeFaceMaps(left, right) {
  const composed = {};
  for (const face of Object.keys(CFOP_444_IDENTITY_FACE_MAP)) {
    composed[face] = left[right[face]];
  }
  return composed;
}

function cfop444RotationMap(axis, amount) {
  let result = { ...CFOP_444_IDENTITY_FACE_MAP };
  const quarter = CFOP_444_ROTATION_FACE_MAP[axis];
  if (!quarter) return null;
  for (let turn = 0; turn < amount; turn += 1) {
    result = cfop444ComposeFaceMaps(result, quarter);
  }
  return result;
}

const VIEW_FACE_ORDER_444 = Object.freeze(["U", "R", "F", "D", "L", "B"]);
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

function buildHumanYauSetupPresentation444(segments, crossColor) {
  if (!Array.isArray(segments) || segments.length < 5) return null;
  const normalizedCross = /^[URFDLB]$/.test(String(crossColor || "")) ? String(crossColor) : "D";
  const opposite = OPPOSITE_FACE_444[normalizedCross];

  // Human Yau grip sequence:
  // 1) build the first center on U,
  // 2) flip so the first center is D while building its opposite on U,
  // 3) hold the cross center on the visible R face for Cross 3/4 and the last four centers,
  // 4) put the cross on D before Cross 4/4 and the remaining edge stage.
  const firstCenterCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.U === normalizedCross,
  );
  const oppositeCenterCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.D === normalizedCross && entry.map.U === opposite,
  );
  const crossRightCandidates = VIEW_ORIENTATIONS_444.filter(
    // Presentation is applied after canonical mapping, so map.R is the visible R face.
    (entry) => entry.map.R === normalizedCross && entry.map.L === opposite,
  );
  const crossDownCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.D === normalizedCross && entry.map.U === opposite,
  );

  const candidateSets = segments.map((_, index) => {
    if (index === 0) return firstCenterCandidates;
    if (index === 1) return oppositeCenterCandidates;
    if (index === 2 || index === 3) return crossRightCandidates;
    return crossDownCandidates;
  });
  return humanizeAbsoluteSegments444(segments, candidateSets);
}

function buildHumanYauEdgePresentation444(segments, crossColor) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const normalizedCross = /^[URFDLB]$/.test(String(crossColor || "")) ? String(crossColor) : "D";
  const opposite = OPPOSITE_FACE_444[normalizedCross];
  const crossDownCandidates = VIEW_ORIENTATIONS_444.filter(
    (entry) => entry.map.D === normalizedCross && entry.map.U === opposite,
  );
  return humanizeAbsoluteSegments444(segments, segments.map(() => crossDownCandidates));
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

async function humanizeMappedYauStages444(publicScramble, sourceStages, crossColor) {
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

function simplifyCfop444OuterMoves(moves) {
  const simplified = [];
  for (const rawMove of moves) {
    const match = /^([URFDLB])(2|')?$/.exec(String(rawMove || "").trim());
    if (!match) return null;
    const face = match[1];
    const amount = cfop444TurnAmount(match[2]);
    const previous = simplified.at(-1);
    const previousMatch = previous ? /^([URFDLB])(2|')?$/.exec(previous) : null;
    if (!previousMatch || previousMatch[1] !== face) {
      simplified.push(cfop444FormatTurn(face, amount));
      continue;
    }
    simplified.pop();
    const combined = (cfop444TurnAmount(previousMatch[2]) + amount) % 4;
    const merged = cfop444FormatTurn(face, combined);
    if (merged) simplified.push(merged);
  }
  return simplified;
}

function compileCfopSegmentsFor444(segments) {
  let faceMap = { ...CFOP_444_IDENTITY_FACE_MAP };
  const compiledSegments = [];
  let unsupportedMove = null;

  const processToken = (rawToken, output) => {
    const token = String(rawToken || "").trim();
    if (!token) return true;

    let match = /^([xyzXYZ])(2'?|')?$/.exec(token);
    if (match) {
      const axis = match[1].toLowerCase();
      const rotation = cfop444RotationMap(axis, cfop444TurnAmount(match[2]));
      if (!rotation) return false;
      faceMap = cfop444ComposeFaceMaps(faceMap, rotation);
      return true;
    }

    match = /^([MESmes])(2'?|')?$/.exec(token);
    if (match) {
      const base = CFOP_444_SLICE_EXPANSIONS[match[1].toUpperCase()];
      const expanded = cfop444PowerTokens(base, cfop444TurnAmount(match[2]));
      if (!expanded) return false;
      return expanded.every((expandedToken) => processToken(expandedToken, output));
    }

    match = /^([URFDLB])(w)?(2'?|')?$/.exec(token);
    if (match?.[2]) {
      const base = CFOP_444_WIDE_EXPANSIONS[match[1]];
      const expanded = cfop444PowerTokens(base, cfop444TurnAmount(match[3]));
      if (!expanded) return false;
      return expanded.every((expandedToken) => processToken(expandedToken, output));
    }

    if (!match) {
      const lowerWide = /^([urfdlb])(2'?|')?$/.exec(token);
      if (lowerWide) {
        const base = CFOP_444_WIDE_EXPANSIONS[lowerWide[1].toUpperCase()];
        const expanded = cfop444PowerTokens(base, cfop444TurnAmount(lowerWide[2]));
        if (!expanded) return false;
        return expanded.every((expandedToken) => processToken(expandedToken, output));
      }
      unsupportedMove = token;
      return false;
    }

    const mappedFace = faceMap[match[1]];
    if (!mappedFace) {
      unsupportedMove = token;
      return false;
    }
    output.push(cfop444FormatTurn(mappedFace, cfop444TurnAmount(match[3])));
    return true;
  };

  for (const stage of Array.isArray(segments) ? segments : []) {
    const output = [];
    for (const move of splitAlgorithm(stage?.solution)) {
      if (!processToken(move, output)) {
        return { ok: false, reason: "unsupported_move", detail: unsupportedMove || move, segments: [] };
      }
    }
    const simplified = simplifyCfop444OuterMoves(output);
    if (!simplified) {
      return { ok: false, reason: "compile_failed", detail: stage?.name || stage?.id || null, segments: [] };
    }
    compiledSegments.push({
      ...stage,
      solution: simplified.join(" "),
      moveCount: simplified.length,
    });
  }

  const frameRestored = Object.keys(CFOP_444_IDENTITY_FACE_MAP)
    .every((face) => faceMap[face] === face);
  if (!frameRestored) {
    return {
      ok: false,
      reason: "frame_not_restored",
      detail: JSON.stringify(faceMap),
      segments: [],
    };
  }

  return { ok: true, reason: null, detail: null, segments: compiledSegments };
}

function getPairedEdgeTypes444(pattern) {
  const edges = pattern?.patternData?.EDGES;
  if (!edges?.pieces || !edges?.orientation) return new Set();
  const paired = new Set();
  for (const [first, second] of EDGE_SLOT_PAIRS_444) {
    const firstType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[first])];
    const secondType = EDGE_TYPE_BY_WING_444[Number(edges.pieces[second])];
    if (
      firstType >= 0 &&
      firstType === secondType &&
      Number(edges.orientation[first]) === Number(edges.orientation[second])
    ) {
      paired.add(firstType);
    }
  }
  return paired;
}

function intersectSets(left, right) {
  const result = new Set();
  for (const value of left) {
    if (right.has(value)) result.add(value);
  }
  return result;
}

async function buildEdgePairingSegments(publicScramble, centerSolution, edgeSolution) {
  const edgeMoves = splitAlgorithm(edgeSolution);
  if (!edgeMoves.length) return [];
  const { puzzles } = await import("../vendor/cubing/puzzles/index.js");
  const kpuzzle = await puzzles["4x4x4"].kpuzzle();
  let pattern = kpuzzle.defaultPattern();
  if (publicScramble) pattern = pattern.applyAlg(publicScramble);
  if (centerSolution) pattern = pattern.applyAlg(centerSolution);

  // The Rust edge solver operates in six-move macros. A locked dedge can be
  // disturbed inside a macro and restored at its boundary, so pairing
  // milestones must be sampled at macro boundaries rather than every move.
  const checkpoints = [{ moveIndex: 0, paired: getPairedEdgeTypes444(pattern) }];
  for (let index = 0; index < edgeMoves.length; index += 1) {
    pattern = pattern.applyAlg(edgeMoves[index]);
    const moveIndex = index + 1;
    if (moveIndex % 6 === 0 || moveIndex === edgeMoves.length) {
      checkpoints.push({ moveIndex, paired: getPairedEdgeTypes444(pattern) });
    }
  }
  if (checkpoints.at(-1)?.paired.size !== 12) return [];

  const permanentHistory = new Array(checkpoints.length);
  let permanent = new Set(checkpoints.at(-1).paired);
  permanentHistory[permanentHistory.length - 1] = new Set(permanent);
  for (let index = checkpoints.length - 2; index >= 0; index -= 1) {
    permanent = intersectSets(permanent, checkpoints[index].paired);
    permanentHistory[index] = new Set(permanent);
  }

  const segments = [];
  let completed = permanentHistory[0].size;
  let moveStart = 0;
  if (completed > 0) {
    segments.push({
      id: "edgePairInitial",
      name: completed === 1 ? "Edge Pairing 1/12" : `Edge Pairing 1-${completed}/12`,
      solution: "",
      moveCount: 0,
      pairStart: 1,
      pairEnd: completed,
      alreadyPaired: true,
      verified: true,
    });
  }

  for (let index = 1; index < checkpoints.length; index += 1) {
    const nextCompleted = permanentHistory[index].size;
    if (nextCompleted <= completed) continue;
    const moveEnd = checkpoints[index].moveIndex;
    const segmentMoves = edgeMoves.slice(moveStart, moveEnd);
    const pairStart = completed + 1;
    const pairEnd = nextCompleted;
    segments.push({
      id: `edgePair${pairStart}`,
      name: pairStart === pairEnd
        ? `Edge Pairing ${pairEnd}/12`
        : `Edge Pairing ${pairStart}-${pairEnd}/12`,
      solution: segmentMoves.join(" "),
      moveCount: segmentMoves.length,
      pairStart,
      pairEnd,
      alreadyPaired: false,
      verified: true,
    });
    completed = nextCompleted;
    moveStart = moveEnd;
  }

  if (completed !== 12 || !segments.length) return [];
  if (moveStart < edgeMoves.length) {
    const tail = edgeMoves.slice(moveStart);
    const last = segments[segments.length - 1];
    last.solution = [last.solution, tail.join(" ")].filter(Boolean).join(" ");
    last.moveCount += tail.length;
  }
  const rebuilt = segments.map((segment) => segment.solution).filter(Boolean).join(" ");
  if (rebuilt !== edgeMoves.join(" ")) return [];
  return segments;
}

function build333PatternFromCubie(solvedPattern, cubieState) {
  const cp = Array.from(cubieState?.cp || [], Number);
  const co = Array.from(cubieState?.co || [], Number);
  const ep = Array.from(cubieState?.ep || [], Number);
  const eo = Array.from(cubieState?.eo || [], Number);
  if (cp.length !== 8 || co.length !== 8 || ep.length !== 12 || eo.length !== 12) {
    throw new Error("INVALID_VIRTUAL_333_CUBIE_STATE");
  }
  const patternData = structuredClone(solvedPattern.patternData);
  patternData.CORNERS.pieces = cp;
  patternData.CORNERS.orientation = co;
  patternData.EDGES.pieces = ep;
  patternData.EDGES.orientation = eo;
  return new solvedPattern.constructor(solvedPattern.kpuzzle, patternData);
}

function normalizeCfopStageName(name) {
  const value = String(name || "CFOP").trim();
  return /^Cross\b/i.test(value) ? "Cross" : value;
}

async function solveCfop333FromCubie(cubieState, onProgress, deadlineTs, crossColor = "D") {
  const [{ getDefaultPattern }, { solve3x3StrictCfopFromPattern }] = await Promise.all([
    import("./context.js"),
    import("./cfop3x3.js"),
  ]);
  const solved333 = await getDefaultPattern("333");
  const pattern = build333PatternFromCubie(solved333, cubieState);
  return solve3x3StrictCfopFromPattern(pattern, {
    mode: "strict",
    crossColor,
    solverVersion: "v2",
    deadlineTs,
    enableHumanViewpoint: true,
    enableMixedCfopStages: false,
    onStageUpdate(progress) {
      emitProgress(onProgress, {
        type: "444_stage_update",
        eventId: "444",
        stage: "THREE_BY_THREE",
        phase: String(progress?.type || "cfop"),
        stageName: "3x3 CFOP",
        cfopStageName: normalizeCfopStageName(progress?.stageName),
        moveCount: Number(progress?.moveCount) || 0,
      });
    },
  });
}

function emptyFailure(reason, status = "error", detail = null, meta = {}) {
  return {
    ok: false,
    eventId: "444",
    status,
    reason: String(reason || "444_FAILED"),
    detail: detail == null ? null : String(detail),
    solution: "",
    moveCount: 0,
    verified: false,
    stages: [],
    source: "WASM_444_BOUNDARY",
    meta: meta && typeof meta === "object" ? { ...meta } : {},
  };
}

async function preferHumanEdgePairing323(api, reduction, publicScramble, internalScramble, crossColor, deadlineTs) {
  if (
    reduction?.status !== "partial" ||
    reduction?.reason !== "444_REDUCTION_INCOMPLETE" ||
    reduction?.meta?.centersSolved !== true ||
    reduction?.meta?.edgesPaired !== true
  ) {
    return reduction;
  }
  const centerStage = Array.isArray(reduction.stages)
    ? reduction.stages.find((stage) => stage?.id === "centers" && stage?.verified === true)
    : null;
  const exactEdgeStage = Array.isArray(reduction.stages)
    ? reduction.stages.find((stage) => stage?.id === "edges" && stage?.verified === true)
    : null;
  if (!centerStage || !exactEdgeStage || Number(exactEdgeStage.moveCount) === 0 || deadlineReached(deadlineTs)) {
    return reduction;
  }

  const started = Date.now();
  let human;
  try {
    const { solveEdgePairing323 } = await import("./edgePairing444.js");
    human = await solveEdgePairing323(
      publicScramble,
      translate444MoveConvention(centerStage.solution),
      { deadlineTs },
    );
  } catch (error) {
    human = { ok: false, reason: "444_323_IMPORT_FAILED", detail: String(error?.message || error) };
  }
  if (!human?.ok) {
    return {
      ...reduction,
      meta: {
        ...reduction.meta,
        edge323Attempted: true,
        edge323FallbackReason: human?.detail || human?.reason || "444_323_NO_PLAN",
      },
    };
  }

  const internalHumanSegments = (Array.isArray(human.segments) ? human.segments : []).map((segment) => ({
    ...segment,
    solution: translate444MoveConvention(segment?.solution || ""),
    verified: true,
  }));
  const internalHumanSolution = translate444MoveConvention(human.solution || "");
  const continuationScramble = [internalScramble, centerStage.solution, internalHumanSolution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  let continued;
  try {
    continued = normalizeBoundaryResponse(api.solve({
      scramble: continuationScramble,
      crossColor,
      deadlineTs,
    }));
  } catch (error) {
    return {
      ...reduction,
      meta: {
        ...reduction.meta,
        edge323Attempted: true,
        edge323FallbackReason: `444_323_CONTINUATION_FAILED:${String(error?.message || error)}`,
      },
    };
  }
  const parityStage = Array.isArray(continued.stages)
    ? continued.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;
  if (
    continued.status !== "partial" ||
    continued.reason !== "444_REDUCTION_INCOMPLETE" ||
    continued.meta?.virtual333Ready !== true ||
    !continued.meta?.virtual333 ||
    !parityStage
  ) {
    return {
      ...reduction,
      meta: {
        ...reduction.meta,
        edge323Attempted: true,
        edge323FallbackReason: continued.reason || "444_323_CONTINUATION_INVALID",
      },
    };
  }

  const humanEdgeStage = {
    id: "edges",
    name: "Edge Pairing · 3-2-3",
    solution: internalHumanSolution,
    moveCount: splitAlgorithm(internalHumanSolution).length,
    verified: true,
    method: "3-2-3",
    segments: internalHumanSegments,
  };
  return {
    ...continued,
    stages: [centerStage, humanEdgeStage, parityStage],
    meta: {
      ...continued.meta,
      parsedMoveCount: reduction.meta?.parsedMoveCount,
      scrambleValid: reduction.meta?.scrambleValid,
      stateValid: reduction.meta?.stateValid,
      solvedState: reduction.meta?.solvedState,
      centersSolved: true,
      centerMoveCount: Number(centerStage.moveCount) || 0,
      centerPhaseMoveCounts: Array.isArray(reduction.meta?.centerPhaseMoveCounts)
        ? [...reduction.meta.centerPhaseMoveCounts]
        : [0, 0, 0, 0],
      centerTableBuildMs: Number(reduction.meta?.centerTableBuildMs) || 0,
      centerSearchMs: Number(reduction.meta?.centerSearchMs) || 0,
      edgesPaired: true,
      edgeMoveCount: humanEdgeStage.moveCount,
      edgeTableBuildMs: 0,
      edgeSearchMs: Math.max(0, Date.now() - started),
      edgeMethod: "3-2-3",
      edge323Attempted: true,
      edge323FallbackReason: null,
      edge323: human.meta && typeof human.meta === "object" ? { ...human.meta } : {},
    },
  };
}

function yauFailure444(reduction, reason, detail = null, deadlineTs = 0) {
  const timedOut = deadlineReached(deadlineTs);
  return {
    ...reduction,
    ok: false,
    status: timedOut ? "timeout" : "partial",
    reason: timedOut ? "444_DEADLINE_REACHED" : reason,
    detail: detail == null ? null : String(detail),
    solution: "",
    moveCount: 0,
    verified: false,
    stages: [],
    meta: {
      ...reduction.meta,
      method444: "yau",
      yauAttempted: true,
      yauFallbackReason: detail || reason,
    },
  };
}

async function preferYauReduction444(
  api,
  reduction,
  publicScramble,
  internalScramble,
  crossColor,
  deadlineTs,
  options = {},
) {
  if (
    reduction?.status !== "partial" ||
    reduction?.reason !== "444_REDUCTION_INCOMPLETE" ||
    reduction?.meta?.centersSolved !== true ||
    reduction?.meta?.edgesPaired !== true
  ) {
    return yauFailure444(reduction, "444_YAU_REDUCTION_BASE_INVALID", reduction?.reason, deadlineTs);
  }

  const sourceCenterStage = Array.isArray(reduction.stages)
    ? reduction.stages.find((stage) => stage?.id === "centers" && stage?.verified === true)
    : null;
  if (!sourceCenterStage) {
    return yauFailure444(reduction, "444_YAU_CENTER_SOURCE_MISSING", null, deadlineTs);
  }

  const phaseCounts = Array.isArray(reduction.meta?.centerPhaseMoveCounts)
    ? reduction.meta.centerPhaseMoveCounts.map((value) => Math.max(0, Number(value) || 0))
    : [];
  if (phaseCounts.length !== 4) {
    return yauFailure444(reduction, "444_YAU_CENTER_PHASES_MISSING", null, deadlineTs);
  }
  const publicCenterMoves = splitAlgorithm(translate444MoveConvention(sourceCenterStage.solution || ""));
  if (phaseCounts.reduce((sum, value) => sum + value, 0) !== publicCenterMoves.length) {
    return yauFailure444(reduction, "444_YAU_CENTER_PHASE_COUNT_MISMATCH", null, deadlineTs);
  }

  const p1End = phaseCounts[0];
  const p2End = p1End + phaseCounts[1];
  const p3End = p2End + phaseCounts[2];
  const firstCenter = publicCenterMoves.slice(0, p1End).join(" ");
  const oppositeCenter = publicCenterMoves.slice(p1End, p2End).join(" ");
  const remainingCenters = publicCenterMoves.slice(p2End).join(" ");
  const firstTwoCenters = [firstCenter, oppositeCenter].filter(Boolean).join(" ");

  let edgeModule;
  try {
    edgeModule = await import("./edgePairing444.js");
  } catch (error) {
    return yauFailure444(reduction, "444_YAU_EDGE_MODULE_FAILED", error?.message || error, deadlineTs);
  }
  const targetTypeMask = edgeModule.crossEdgeTypeMask444(crossColor);

  let cross3 = null;
  let effectiveRemainingCenters = remainingCenters;
  let naturalCross3Applied = false;
  let remainingCentersRecomputed = false;
  let naturalCross3FallbackReason = null;
  let recomputedCenterPhaseMoveCounts = null;
  let protectedCenterSearchMs = 0;
  let remainingCentersCrossLockedEveryMove = false;

  if (
    !deadlineReached(deadlineTs) &&
    typeof edgeModule.solveYauCross3Natural444 === "function" &&
    typeof api.solveYauRemainingCenters === "function"
  ) {
    const natural = await edgeModule.solveYauCross3Natural444(
      publicScramble, firstTwoCenters, targetTypeMask,
      {
        deadlineTs,
        timeBudgetMs: options?.__yauFastFrameProbe === true ? 950 : 2400,
        protectedCenterFaces: [crossColor, OPPOSITE_FACE_444[crossColor]],
      },
    );
    if (natural?.ok) {
      const stateBeforeRemainingCenters = [firstTwoCenters, natural.solution]
        .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
      const protectedCenterScramble = [internalScramble, translate444MoveConvention(stateBeforeRemainingCenters)]
        .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
      const protectedDeadlineTs = deadlineTs > 0
        ? Math.min(deadlineTs, Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200))
        : Date.now() + (options?.__yauFastFrameProbe === true ? 900 : 2200);
      let protectedResult = null;
      try {
        const rawProtected = api.solveYauRemainingCenters({
          scramble: protectedCenterScramble,
          crossColor,
          deadlineTs: protectedDeadlineTs,
        });
        protectedResult = typeof rawProtected === "string" ? JSON.parse(rawProtected) : rawProtected;
      } catch (error) {
        naturalCross3FallbackReason = `PROTECTED_CENTER_CALL:${String(error?.message || error)}`;
      }
      if (
        protectedResult?.ok === true &&
        protectedResult?.verified === true &&
        protectedResult?.crossLockedEveryMove === true &&
        Number(protectedResult?.protectedCrossPairCount) === 3
      ) {
        const candidateRemainingCenters = translate444MoveConvention(protectedResult.solution || "");
        const verifySetup = [stateBeforeRemainingCenters, candidateRemainingCenters]
          .map((part) => String(part || "").trim()).filter(Boolean).join(" ");
        const preserved = await edgeModule.solveTargetEdgeTypes444(
          publicScramble, verifySetup, targetTypeMask,
          {
            targetCount: 3, requiredTypeMask: natural.lockedTypeMask, deadlineTs,
            maxMacros: 0, enableRescue: false,
          },
        );
        if (preserved?.ok) {
          cross3 = natural;
          effectiveRemainingCenters = candidateRemainingCenters;
          naturalCross3Applied = true;
          remainingCentersRecomputed = true;
          recomputedCenterPhaseMoveCounts = Array.isArray(protectedResult.phaseMoveCounts)
            ? [...protectedResult.phaseMoveCounts]
            : null;
          protectedCenterSearchMs = Number(protectedResult.searchMs) || 0;
          remainingCentersCrossLockedEveryMove = true;
        } else {
          naturalCross3FallbackReason = preserved?.reason || "PROTECTED_CENTER_JS_VERIFY_FAILED";
        }
      } else if (!naturalCross3FallbackReason) {
        naturalCross3FallbackReason = protectedResult?.reason || "PROTECTED_CENTER_SEARCH_FAILED";
      }
    } else {
      naturalCross3FallbackReason = natural?.reason || "NATURAL_CROSS3_NOT_FOUND";
    }
  }

  if (!cross3?.ok) {
    return yauFailure444(
      reduction,
      "444_YAU_HUMAN_CROSS3_FAILED",
      naturalCross3FallbackReason || cross3?.reason || cross3?.detail || "HUMAN_CROSS3_REQUIRED",
      deadlineTs,
    );
  }

  const beforeCross4 = [firstTwoCenters, cross3.solution, effectiveRemainingCenters]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const cross4 = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    beforeCross4,
    targetTypeMask,
    {
      targetCount: 4,
      requiredTypeMask: cross3.lockedTypeMask,
      alignSolved: true,
      deadlineTs,
      maxMacros: 6,
      enableRescue: options?.__yauFastFrameProbe !== true,
      projectTargetState: options?.__yauFastFrameProbe === true,
    },
  );
  if (!cross4?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS4_FAILED", cross4?.reason || cross4?.detail, deadlineTs);
  }

  if (options?.__yauProbeOnly === true) {
    return {
      ...reduction,
      ok: true,
      status: "yau_probe",
      reason: null,
      detail: null,
      solution: "",
      moveCount: 0,
      verified: false,
      stages: [],
      meta: {
        ...reduction.meta,
        method444: "yau",
        yauAttempted: true,
        yauProbePassed: true,
        yauCross3MoveCount: Number(cross3.moveCount) || 0,
        yauCross4MoveCount: Number(cross4.moveCount) || 0,
        yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      },
    };
  }

  const yauSetupPublic = [beforeCross4, cross4.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  let remainingEdges = await edgeModule.solveEdgePairing323(
    publicScramble,
    yauSetupPublic,
    {
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

  if (!remainingEdges?.ok) {
    let frameDiagnostics = [];
    try {
      frameDiagnostics = await edgeModule.debugEdge323Frames444();
    } catch (_) {}
    const detail = JSON.stringify({
      reason: remainingEdges?.reason || remainingEdges?.detail || null,
      diagnostics: remainingEdges?.meta || remainingEdges?.detail || null,
      protectedBankFailure: yauEdge323ProtectedBankFallbackReason,
      targetTypeMask,
      frames: frameDiagnostics,
    });
    return yauFailure444(reduction, "444_YAU_EDGE_PAIRING_FAILED", detail, deadlineTs);
  }

  const beforeCrossRestore = [yauSetupPublic, remainingEdges.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const crossRestore = await edgeModule.solveTargetEdgeTypes444(
    publicScramble,
    beforeCrossRestore,
    targetTypeMask,
    {
      targetCount: 4,
      requiredTypeMask: targetTypeMask,
      alignSolved: true,
      deadlineTs,
      maxMacros: 0,
    },
  );
  if (!crossRestore?.ok) {
    return yauFailure444(reduction, "444_YAU_CROSS_RESTORE_FAILED", crossRestore?.reason || crossRestore?.detail, deadlineTs);
  }
  const yauRemainingEdgePublic = [remainingEdges.solution, crossRestore.solution]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  const internalYauSetup = translate444MoveConvention(yauSetupPublic);
  const internalYauEdges = translate444MoveConvention(yauRemainingEdgePublic);
  const continuationScramble = [internalScramble, internalYauSetup, internalYauEdges]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");

  let continued;
  try {
    continued = normalizeBoundaryResponse(api.solve({
      scramble: continuationScramble,
      crossColor,
      deadlineTs,
    }));
  } catch (error) {
    return yauFailure444(reduction, "444_YAU_CONTINUATION_FAILED", error?.message || error, deadlineTs);
  }
  const parityStage = Array.isArray(continued.stages)
    ? continued.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;
  if (
    continued.status !== "partial" ||
    continued.reason !== "444_REDUCTION_INCOMPLETE" ||
    continued.meta?.virtual333Ready !== true ||
    !continued.meta?.virtual333 ||
    !parityStage
  ) {
    return yauFailure444(reduction, "444_YAU_CONTINUATION_INVALID", continued.reason, deadlineTs);
  }

  const makeSetupSegment = (id, name, publicSolution, extra = {}) => {
    const internalSolution = translate444MoveConvention(publicSolution || "");
    return {
      id,
      name,
      solution: internalSolution,
      moveCount: splitAlgorithm(internalSolution).length,
      verified: true,
      ...extra,
    };
  };
  const setupSegments = [
    makeSetupSegment("yauFirstCenter", "Yau · First Center", firstCenter),
    makeSetupSegment("yauOppositeCenter", "Yau · Opposite Center", oppositeCenter),
    makeSetupSegment("yauCross3", "Yau · Cross Edges 3/4", cross3.solution, {
      crossEdgeCount: 3,
      lockedTypeMask: cross3.lockedTypeMask,
    }),
    makeSetupSegment("yauRemainingCenters", "Yau · Remaining 4 Centers", effectiveRemainingCenters, {
      recomputedAfterCross3: remainingCentersRecomputed,
      crossLockedEveryMove: remainingCentersCrossLockedEveryMove,
    }),
    makeSetupSegment("yauCross4", "Yau · Cross Edge 4/4", cross4.solution, {
      crossEdgeCount: 4,
      alignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
    }),
  ];
  const yauSetupStage = {
    id: "centers",
    name: "Yau Setup",
    solution: internalYauSetup,
    moveCount: splitAlgorithm(internalYauSetup).length,
    verified: true,
    method: "Yau",
    segments: setupSegments,
  };

  const internalEdgeSegments = (Array.isArray(remainingEdges.segments) ? remainingEdges.segments : []).map((segment) => ({
    ...segment,
    solution: translate444MoveConvention(segment?.solution || ""),
    verified: true,
  }));
  if (crossRestore.solution) {
    internalEdgeSegments.push({
      id: "yauCrossRestore",
      name: "Yau · Cross Restore",
      solution: translate444MoveConvention(crossRestore.solution),
      moveCount: splitAlgorithm(crossRestore.solution).length,
      pairStart: 12,
      pairEnd: 12,
      alreadyPaired: true,
      verified: true,
    });
  }
  const yauEdgeStage = {
    id: "edges",
    name: "Edge Pairing · Yau 3-2-3",
    solution: internalYauEdges,
    moveCount: splitAlgorithm(internalYauEdges).length,
    verified: true,
    method: "Yau 3-2-3",
    segments: internalEdgeSegments,
  };

  return {
    ...continued,
    stages: [yauSetupStage, yauEdgeStage, parityStage],
    meta: {
      ...continued.meta,
      parsedMoveCount: reduction.meta?.parsedMoveCount,
      scrambleValid: reduction.meta?.scrambleValid,
      stateValid: reduction.meta?.stateValid,
      solvedState: reduction.meta?.solvedState,
      centersSolved: true,
      centerMoveCount: yauSetupStage.moveCount,
      centerPhaseMoveCounts: [...phaseCounts],
      centerTableBuildMs: Number(reduction.meta?.centerTableBuildMs) || 0,
      centerSearchMs: Number(reduction.meta?.centerSearchMs) || 0,
      edgesPaired: true,
      edgeMoveCount: yauEdgeStage.moveCount,
      edgeTableBuildMs: 0,
      edgeSearchMs: Number(remainingEdges.meta?.diagnostics?.elapsedMs) || 0,
      edgeMethod: "Yau 3-2-3",
      method444: "yau",
      yauAttempted: true,
      yauFallbackReason: null,
      yauCrossTypeMask: targetTypeMask,
      yauCross3MoveCount: Number(cross3.moveCount) || 0,
      yauCross3HumanStepCount: Number(cross3.humanStepCount) || 0,
      yauCross3HumanWorkingSlices: Array.isArray(cross3.steps)
        ? cross3.steps.map((step) => String(step?.workingSlice || ""))
        : [],
      yauCross3SolvedTargetMask: Number(cross3.solvedTargetMask) || 0,
      yauCross3PairedTargetMask: Number(cross3.pairedTargetMask) || 0,
      yauCross3Method: String(cross3.method || "Yau Cross Edges"),
      yauNaturalCross3Applied: naturalCross3Applied,
      yauHumanCross3Applied: naturalCross3Applied && cross3.method === "Yau Human Cross 3/4",
      yauNaturalCross3FallbackReason: naturalCross3FallbackReason,
      yauRemainingCentersRecomputed: remainingCentersRecomputed,
      yauRecomputedCenterPhaseMoveCounts: recomputedCenterPhaseMoveCounts,
      yauProtectedCenterSearchMs: protectedCenterSearchMs,
      yauRemainingCentersCrossLockedEveryMove: remainingCentersCrossLockedEveryMove,
      yauCross3SearchRescueUsed: cross3.searchRescueUsed === true,
      yauCross3SearchMaxMacros: Number(cross3.searchMaxMacros) || 0,
      yauCross4MoveCount: Number(cross4.moveCount) || 0,
      yauCross4SearchRescueUsed: cross4.searchRescueUsed === true,
      yauCross4SearchMaxMacros: Number(cross4.searchMaxMacros) || 0,
      yauCrossAlignmentMoveCount: Number(cross4.alignmentMoveCount) || 0,
      yauCrossAlignmentRescueUsed: cross4.alignmentRescueUsed === true,
      yauCrossRestoreMoveCount: Number(crossRestore.moveCount) || 0,
      yauEdge323ProtectedCrossBank,
      yauEdge323ProtectedBankFallbackReason,
      yauPureCenterMoveCount: publicCenterMoves.length,
      yauRemainingCenterMoveCount: splitAlgorithm(effectiveRemainingCenters).length,
      yauEdge323: remainingEdges.meta && typeof remainingEdges.meta === "object"
        ? { ...remainingEdges.meta }
        : {},
    },
  };
}

function normalizeBoundaryResponse(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      return emptyFailure("444_INVALID_WASM_RESPONSE", "error", error?.message || error);
    }
  }
  if (!value || typeof value !== "object") {
    return emptyFailure("444_INVALID_WASM_RESPONSE");
  }

  const ok = value.ok === true;
  const partial = !ok && String(value.status || "") === "partial";
  const solution = ok ? String(value.solution || "").trim() : "";
  const moveCountValue = Number(value.moveCount ?? value.move_count ?? 0);
  const moveCount = ok && Number.isFinite(moveCountValue)
    ? Math.max(0, Math.floor(moveCountValue))
    : 0;
  return {
    ok,
    eventId: "444",
    status: String(value.status || (ok ? "ok" : "error")),
    reason: value.reason ? String(value.reason) : ok ? null : "444_FAILED",
    detail: value.detail == null ? null : String(value.detail),
    solution,
    moveCount,
    verified: ok && value.verified === true,
    stages: (ok || partial) && Array.isArray(value.stages) ? value.stages : [],
    source: "WASM_444_BOUNDARY",
    meta: value.meta && typeof value.meta === "object" ? { ...value.meta } : {},
  };
}

async function loadModuleCandidate(specifier) {
  let mod;
  try {
    mod = await import(/* @vite-ignore */ specifier);
  } catch (error) {
    recordFailure("module-import", specifier, error);
    return null;
  }

  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const isBrowserLike = typeof window !== "undefined" || typeof self !== "undefined";
  if (typeof mod.initSync === "function" && isNode && !isBrowserLike) {
    try {
      const [{ fileURLToPath }, fs] = await Promise.all([import("url"), import("fs")]);
      const wasmUrl = new URL("solver444_wasm_bg.wasm", specifier);
      const wasmBytes = fs.readFileSync(fileURLToPath(wasmUrl));
      mod.initSync({ module: wasmBytes });
    } catch (error) {
      recordFailure("module-init-sync", specifier, error);
      return null;
    }
  } else {
    const init = typeof mod.default === "function" ? mod.default : typeof mod.init === "function" ? mod.init : null;
    if (init) {
      try {
        await init();
      } catch (error) {
        recordFailure("module-init", specifier, error);
        return null;
      }
    }
  }

  if (typeof mod.solve_444_json !== "function" || typeof mod.verify_444_solution_json !== "function") {
    recordFailure("module-api", specifier, new Error("SOLVER_444_EXPORT_MISSING"));
    return null;
  }

  return {
    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
    },
    solveYauRemainingCenters(request) {
      return typeof mod.solve_444_yau_remaining_centers_json === "function"
        ? mod.solve_444_yau_remaining_centers_json(JSON.stringify(request))
        : null;
    },
    verify(request) {
      return mod.verify_444_solution_json(JSON.stringify(request));
    },
    version() {
      return typeof mod.solver_444_api_version === "function"
        ? String(mod.solver_444_api_version())
        : "unknown";
    },
  };
}

async function loadSolver444Api() {
  for (const candidate of SOLVER_444_MODULE_CANDIDATES) {
    const api = await loadModuleCandidate(candidate);
    if (api) return api;
  }
  return null;
}

export async function ensureSolver444Ready() {
  if (solver444Api) return solver444Api;
  if (!solver444ApiPromise) {
    solver444ApiPromise = loadSolver444Api()
      .then((api) => {
        solver444Api = api;
        return api;
      })
      .finally(() => {
        if (!solver444Api) solver444ApiPromise = null;
      });
  }
  return solver444ApiPromise;
}

export function getSolver444ReadinessStatus() {
  return {
    ready: solver444Api !== null,
    loading: solver444Api === null && solver444ApiPromise !== null,
    apiVersion: solver444Api ? solver444Api.version() : null,
    lastFailure: solver444LastFailure ? { ...solver444LastFailure } : null,
  };
}

const YAU_CANONICAL_FRAME_ROTATION_444 = Object.freeze({
  U: "x2",
  R: "z",
  F: "x'",
  D: "",
  L: "z'",
  B: "x",
});

function inverseFaceMap444(faceMap) {
  const inverse = {};
  for (const face of VIEW_FACE_ORDER_444) inverse[faceMap[face]] = face;
  return inverse;
}

function yauCanonicalOrientation444(crossColor) {
  const token = YAU_CANONICAL_FRAME_ROTATION_444[crossColor] || "";
  let map = { ...CFOP_444_IDENTITY_FACE_MAP };
  if (token) {
    const parsed = rotationTokenAmount444(token);
    const rotation = parsed ? cfop444RotationMap(parsed.axis, parsed.amount) : null;
    if (!rotation) return null;
    map = rotation;
  }
  return {
    token,
    map,
    key: viewMapKey444(map),
  };
}

function rotationTokenForFaceMap444(faceMap) {
  for (const token of VIEW_ROTATION_TOKENS_444) {
    const parsed = rotationTokenAmount444(token);
    if (!parsed) continue;
    const candidate = cfop444RotationMap(parsed.axis, parsed.amount);
    if (candidate && viewMapKey444(candidate) === viewMapKey444(faceMap)) return token;
  }
  if (viewMapKey444(faceMap) === viewMapKey444(CFOP_444_IDENTITY_FACE_MAP)) return "";
  return null;
}

function mapLogical444MoveToPhysical(token, orientation) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  let match = /^([URFDLB])(w)?(2|')?$/.exec(raw);
  if (match) {
    const face = orientation.map[match[1]];
    if (!face) return null;
    return `${face}${match[2] || ""}${match[3] || ""}`;
  }
  match = /^([xyz])(2|')?$/.exec(raw);
  if (match) {
    const logicalRotation = cfop444RotationMap(match[1], cfop444TurnAmount(match[2]));
    if (!logicalRotation) return null;
    const inverseFrame = inverseFaceMap444(orientation.map);
    const physicalRotation = cfop444ComposeFaceMaps(
      orientation.map,
      cfop444ComposeFaceMaps(logicalRotation, inverseFrame),
    );
    return rotationTokenForFaceMap444(physicalRotation);
  }
  return null;
}

function mapLogical444SequenceToPhysical(sequence, orientation) {
  const output = [];
  for (const token of splitAlgorithm(sequence)) {
    const mapped = mapLogical444MoveToPhysical(token, orientation);
    if (mapped == null) return null;
    if (mapped) output.push(mapped);
  }
  return output.join(" ");
}

function mapPhysical444SequenceToLogical(sequence, orientation) {
  const output = [];
  for (const raw of splitAlgorithm(sequence)) {
    let token = raw;
    const lowerWide = /^([urfdlb])(2|')?$/.exec(token);
    if (lowerWide) token = `${lowerWide[1].toUpperCase()}w${lowerWide[2] || ""}`;
    const mapped = remapPhysical444MoveForView(token, orientation);
    if (!mapped) return null;
    output.push(mapped);
  }
  return output.join(" ");
}

function mapYauStageToPhysical444(stage, orientation) {
  const solution = mapLogical444SequenceToPhysical(stage?.solution || "", orientation);
  if (solution == null) return null;
  const mapped = {
    ...stage,
    solution,
    moveCount: countMetric444Moves(solution),
  };
  if (Array.isArray(stage?.segments)) {
    mapped.segments = [];
    for (const segment of stage.segments) {
      const mappedSegment = mapYauStageToPhysical444(segment, orientation);
      if (!mappedSegment) return null;
      mapped.segments.push(mappedSegment);
    }
  }
  return mapped;
}

async function solveYauCanonicalFrame444(
  publicScramble,
  onProgress,
  options,
  crossColor,
  deadlineTs,
) {
  const baseOrientation = yauCanonicalOrientation444(crossColor);
  if (!baseOrientation) {
    return emptyFailure("444_YAU_FRAME_INVALID", "error", crossColor, { method444: "yau", crossColor });
  }

  const frameSpins = ["y2", "y'", "", "y"];
  const attempts = [];
  let lastFailure = null;

  const buildOrientation = (spin) => {
    let map = { ...baseOrientation.map };
    if (spin) {
      const parsed = rotationTokenAmount444(spin);
      const rotation = parsed ? cfop444RotationMap(parsed.axis, parsed.amount) : null;
      if (!rotation) return null;
      map = cfop444ComposeFaceMaps(baseOrientation.map, rotation);
    }
    return { token: baseOrientation.token, map, key: viewMapKey444(map) };
  };

  const mapVerifiedSuccess = async (logicalResult, candidate) => {
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
  };

  // Probe a frame and, once it demonstrates a valid Cross 4/4 setup, solve it
  // immediately. This avoids paying for the other three probes when the first
  // useful frame already works.
  for (let frameIndex = 0; frameIndex < frameSpins.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const spin = frameSpins[frameIndex];
    const orientation = buildOrientation(spin);
    if (!orientation) continue;
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) continue;
    const candidate = { spin, orientation, logicalScramble };

    const probeStarted = Date.now();
    const hardDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Number(deadlineTs)
      : probeStarted + 60_000;
    const probe = await solve444(logicalScramble, null, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, probeStarted + 6_000),
      __yauCanonicalFrame: true,
      __yauProbeOnly: true,
      __yauFastFrameProbe: true,
    });
    const probeOk = probe?.ok === true && probe?.status === "yau_probe";
    attempts.push({
      phase: "probe",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - probeStarted),
      ok: probeOk,
      reason: probe?.reason || null,
    });
    if (!probeOk) {
      lastFailure = probe;
      continue;
    }

    const fullStarted = Date.now();
    const remaining = Math.max(0, hardDeadline - fullStarted);
    const framesLeft = Math.max(1, frameSpins.length - frameIndex);
    const fullBudget = Math.max(6_000, Math.min(14_000, Math.floor(remaining / framesLeft)));
    const logicalResult = await solve444(logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, fullStarted + fullBudget),
      __yauCanonicalFrame: true,
      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
      __skipHumanPresentation: true,
    });
    attempts.push({
      phase: "full",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - fullStarted),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }
    const mapped = await mapVerifiedSuccess(logicalResult, candidate);
    if (mapped) return mapped;
    lastFailure = emptyFailure("444_YAU_FRAME_VERIFICATION_FAILED", "error", spin || "identity", {
      method444: "yau",
      crossColor,
    });
  }

  // If no cheap probe succeeds, spend the remaining budget on bounded deep
  // rescue attempts. Every frame gets a chance; no single hostile frame may
  // consume the whole worker deadline.
  for (let frameIndex = 0; frameIndex < frameSpins.length; frameIndex += 1) {
    if (deadlineReached(deadlineTs)) break;
    const spin = frameSpins[frameIndex];
    const orientation = buildOrientation(spin);
    if (!orientation) continue;
    const logicalScramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    if (logicalScramble == null) continue;
    const candidate = { spin, orientation, logicalScramble };
    const started = Date.now();
    const hardDeadline = Number.isFinite(Number(deadlineTs)) && Number(deadlineTs) > 0
      ? Number(deadlineTs)
      : started + 60_000;
    const remaining = Math.max(0, hardDeadline - started);
    const framesLeft = Math.max(1, frameSpins.length - frameIndex);
    const rescueBudget = Math.max(4_000, Math.min(10_000, Math.floor(remaining / framesLeft)));
    const logicalResult = await solve444(logicalScramble, onProgress, {
      ...options,
      method444: "yau",
      crossColor: "D",
      deadlineTs: Math.min(hardDeadline, started + rescueBudget),
      __yauCanonicalFrame: true,
      __yauProbeOnly: false,
      __yauFastFrameProbe: false,
      __skipHumanPresentation: true,
    });
    attempts.push({
      phase: "rescue",
      spin: spin || "identity",
      elapsedMs: Math.max(0, Date.now() - started),
      ok: logicalResult?.ok === true,
      reason: logicalResult?.reason || null,
    });
    if (!logicalResult?.ok) {
      lastFailure = logicalResult;
      continue;
    }
    const mapped = await mapVerifiedSuccess(logicalResult, candidate);
    if (mapped) return mapped;
  }

  if (deadlineReached(deadlineTs)) {
    return emptyFailure("444_DEADLINE_REACHED", "timeout", lastFailure?.reason || null, {
      method444: "yau",
      crossColor,
      yauCanonicalCrossColor: "D",
      yauFrameRotation: baseOrientation.token,
      yauFrameAttemptCount: attempts.length,
      yauFrameAttempts: attempts,
    });
  }
  return {
    ...(lastFailure || emptyFailure("444_YAU_ALL_FRAMES_FAILED", "partial", null)),
    meta: {
      ...(lastFailure?.meta || {}),
      method444: "yau",
      crossColor,
      yauCanonicalCrossColor: "D",
      yauFrameRotation: baseOrientation.token,
      yauFrameAttemptCount: attempts.length,
      yauFrameAttempts: attempts,
    },
  };
}

export async function solve444(scramble, onProgress = null, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossColor = /^[URFDLB]$/i.test(String(options?.crossColor || "D"))
    ? String(options?.crossColor || "D").toUpperCase()
    : "D";
  const method444 = String(options?.method444 || "reduction").trim().toLowerCase() === "yau"
    ? "yau"
    : "reduction";
  const publicScramble = String(scramble || "").trim();
  if (method444 === "yau" && options?.__yauCanonicalFrame !== true) {
    return solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs);
  }
  const internalScramble = translate444MoveConvention(publicScramble);
  if (deadlineReached(deadlineTs)) {
    return emptyFailure("444_DEADLINE_REACHED", "timeout", null, { deadlineTs });
  }

  emitProgress(onProgress, {
    type: "444_stage_start",
    eventId: "444",
    stage: "BOUNDARY",
    stageName: "4x4 engine loading",
  });

  const api = await ensureSolver444Ready();
  if (!api) {
    const result = emptyFailure(
      "444_WASM_UNAVAILABLE",
      "unavailable",
      solver444LastFailure?.message || null,
      { deadlineTs },
    );
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "BOUNDARY",
      reason: result.reason,
    });
    return result;
  }

  if (deadlineReached(deadlineTs)) {
    const result = emptyFailure("444_DEADLINE_REACHED", "timeout", null, {
      deadlineTs,
      apiVersion: api.version(),
    });
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "BOUNDARY",
      reason: result.reason,
    });
    return result;
  }

  emitProgress(onProgress, {
    type: "444_stage_update",
    eventId: "444",
    stage: "BOUNDARY",
    phase: "wasm_ready",
    apiVersion: api.version(),
  });

  let result;
  try {
    result = normalizeBoundaryResponse(api.solve({
      scramble: internalScramble,
      crossColor,
      deadlineTs,
    }));
  } catch (error) {
    recordFailure("solve-call", null, error);
    result = emptyFailure("444_WASM_CALL_FAILED", "error", error?.message || error, {
      deadlineTs,
      apiVersion: api.version(),
    });
  }

  result = method444 === "yau"
    ? await preferYauReduction444(
        api,
        result,
        publicScramble,
        internalScramble,
        crossColor,
        deadlineTs,
        options,
      )
    : await preferHumanEdgePairing323(
        api,
        result,
        publicScramble,
        internalScramble,
        crossColor,
        deadlineTs,
      );

  if (options?.__yauProbeOnly === true) return result;

  if (result.meta?.stateValid === true) {
    emitProgress(onProgress, {
      type: "444_state_validated",
      eventId: "444",
      stage: "BOUNDARY",
      parsedMoveCount: Number(result.meta.parsedMoveCount) || 0,
      solvedState: result.meta.solvedState === true,
    });
  }

  const centerStage = Array.isArray(result.stages)
    ? result.stages.find((stage) => stage?.id === "centers" && stage?.verified === true)
    : null;
  if (centerStage && result.meta?.centersSolved === true) {
    emitProgress(onProgress, {
      type: "444_stage_done",
      eventId: "444",
      stage: "CENTERS",
      stageName: "Centers",
      moveCount: Number(centerStage.moveCount) || 0,
      tableBuildMs: Number(result.meta.centerTableBuildMs) || 0,
      searchMs: Number(result.meta.centerSearchMs) || 0,
    });
  }

  const edgeStage = Array.isArray(result.stages)
    ? result.stages.find((stage) => stage?.id === "edges" && stage?.verified === true)
    : null;
  if (edgeStage && result.meta?.edgesPaired === true) {
    emitProgress(onProgress, {
      type: "444_stage_done",
      eventId: "444",
      stage: "EDGES",
      stageName: "Edge Pairing",
      moveCount: Number(edgeStage.moveCount) || 0,
      tableBuildMs: Number(result.meta.edgeTableBuildMs) || 0,
      searchMs: Number(result.meta.edgeSearchMs) || 0,
    });
  }

  const reductionParityStage = Array.isArray(result.stages)
    ? result.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;

  if (
    result.status !== "partial" ||
    result.reason !== "444_REDUCTION_INCOMPLETE" ||
    result.meta?.virtual333Ready !== true ||
    !result.meta?.virtual333 ||
    !centerStage ||
    !edgeStage
  ) {
    emitProgress(onProgress, {
      type: result.ok ? "444_stage_done" : "444_stage_fail",
      eventId: "444",
      stage: "REDUCTION",
      reason: result.reason,
      status: result.status,
    });
    return result;
  }

  emitProgress(onProgress, {
    type: "444_stage_start",
    eventId: "444",
    stage: "THREE_BY_THREE",
    stageName: "3x3 CFOP · LL parity",
  });

  let ll;
  try {
    const { solveLlDeferred444 } = await import("./llParity444.js");
    ll = await solveLlDeferred444({
      scramble: publicScramble,
      centerSolution: translate444MoveConvention(centerStage.solution || ""),
      edgeSolution: translate444MoveConvention(edgeStage.solution || ""),
      crossColor,
      deadlineTs,
      onProgress(progress) {
        emitProgress(onProgress, {
          type: "444_stage_update",
          eventId: "444",
          stage: "THREE_BY_THREE",
          phase: "ll",
          stageName: "3x3 CFOP · LL parity",
          cfopStageName: String(progress?.stageName || "LL"),
        });
      },
    });
  } catch (error) {
    ll = { ok: false, reason: "444_LL_PARITY_BRIDGE_FAILED", detail: String(error?.message || error) };
  }

  if (!ll?.ok) {
    const timedOut = deadlineReached(deadlineTs);
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "THREE_BY_THREE",
      reason: ll?.reason || "444_LL_PARITY_FAILED",
    });
    return {
      ...result,
      status: timedOut ? "timeout" : "partial",
      reason: timedOut ? "444_DEADLINE_REACHED" : "444_LL_PARITY_FAILED",
      detail: ll?.reason || ll?.detail || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        llParityReason: ll?.reason || null,
        parityHandledAt: "LL",
      },
    };
  }

  const publicLlSegments = (Array.isArray(ll.segments) ? ll.segments : []).map((stage, index) => ({
    ...stage,
    id: stage?.id || `cfop${index + 1}`,
    name: normalizeCfopStageName(stage?.name),
    solution: String(stage?.solution || "").trim(),
    moveCount: splitAlgorithm(stage?.solution).length,
    verified: true,
  }));
  const internalLlSegments = publicLlSegments.map((stage) => ({
    ...stage,
    solution: translate444MoveConvention(stage.solution),
  }));
  const internalThreeByThreeSolution = internalLlSegments
    .map((stage) => stage.solution)
    .filter(Boolean)
    .join(" ");
  const internalThreeByThreeStage = {
    id: "threeByThree",
    name: "3x3 CFOP",
    solution: internalThreeByThreeSolution,
    moveCount: splitAlgorithm(internalThreeByThreeSolution).length,
    verified: false,
    method: "CFOP · LL Parity",
    segments: internalLlSegments,
  };
  const internalCompleteStages = [centerStage, edgeStage, internalThreeByThreeStage];
  const internalCompleteSolution = internalCompleteStages
    .map((stage) => String(stage.solution || "").trim())
    .filter(Boolean)
    .join(" ");

  let verification;
  try {
    verification = JSON.parse(String(api.verify({
      scramble: internalScramble,
      solution: internalCompleteSolution,
    }) || ""));
  } catch (error) {
    verification = { ok: false, solved: false, reason: String(error?.message || error) };
  }

  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "VERIFY",
      reason: verification?.reason || "444_FINAL_VERIFICATION_FAILED",
    });
    return {
      ...result,
      status: "error",
      reason: "444_FINAL_VERIFICATION_FAILED",
      detail: verification?.reason || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        cfopMoveCount: Number(ll.cfopMoveCount) || 0,
        threeByThreeMoveCount: internalThreeByThreeStage.moveCount,
        parityMoveCount: Number(ll.parityMoveCount) || 0,
        parityHandledAt: "LL",
        fullVerificationSolved: false,
      },
    };
  }

  internalThreeByThreeStage.verified = true;
  const publicStages = internalCompleteStages.map((stage) => ({
    ...stage,
    solution: translate444MoveConvention(stage.solution),
    segments: Array.isArray(stage.segments)
      ? stage.segments.map((segment) => ({
          ...segment,
          solution: translate444MoveConvention(segment.solution),
        }))
      : stage.segments,
  }));
  try {
    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
    if (publicEdgeStage && !String(publicEdgeStage.method || "").includes("3-2-3")) {
      publicEdgeStage.segments = await buildEdgePairingSegments(
        publicScramble,
        publicCenterStage?.solution || "",
        publicEdgeStage.solution || "",
      );
    }
  } catch (error) {
    console.warn("[444] edge pairing segmentation failed", error);
  }

  const rotationlessPublicStages = structuredClone(publicStages);
  let humanViewpointApplied = false;
  let viewpointRotationCount = 0;
  let yauHumanGripApplied = false;
  let yauViewpointRotationCount = 0;
  if (options?.__skipHumanPresentation !== true) {
    try {
      const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
      const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
      const publicCfopStage = publicStages.find((stage) => stage?.id === "threeByThree");

    const yauSetupHuman = publicCenterStage?.method === "Yau" && publicCenterStage?.segments?.length
      ? buildHumanYauSetupPresentation444(publicCenterStage.segments, crossColor)
      : null;
    if (yauSetupHuman) {
      publicCenterStage.segments = yauSetupHuman.segments;
      publicCenterStage.solution = yauSetupHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += yauSetupHuman.rotationCount;
      yauViewpointRotationCount += yauSetupHuman.rotationCount;
    }

    const centerHuman = publicCenterStage && publicCenterStage.method !== "Yau"
      ? buildHumanCenterPresentation444(publicCenterStage, result.meta?.centerPhaseMoveCounts, crossColor)
      : null;
    if (centerHuman) {
      publicCenterStage.segments = centerHuman.segments;
      publicCenterStage.solution = centerHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      publicCenterStage.method = "Cross → Opposite → Remaining 4";
      viewpointRotationCount += centerHuman.rotationCount;
    }

    const isYauEdgeStage = String(publicEdgeStage?.method || "").startsWith("Yau");
    const edgeHuman = publicEdgeStage?.segments?.length
      ? isYauEdgeStage
        ? buildHumanYauEdgePresentation444(publicEdgeStage.segments, crossColor)
        : buildHumanYawPresentation444(publicEdgeStage.segments)
      : null;
    if (edgeHuman) {
      publicEdgeStage.segments = edgeHuman.segments;
      publicEdgeStage.solution = edgeHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += edgeHuman.rotationCount;
      if (isYauEdgeStage) yauViewpointRotationCount += edgeHuman.rotationCount;
    }

    const cfopHuman = publicCfopStage?.segments?.length
      ? buildHumanCfopPresentation444(publicCfopStage.segments, crossColor)
      : null;
    if (cfopHuman) {
      publicCfopStage.segments = cfopHuman.segments;
      publicCfopStage.solution = cfopHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += cfopHuman.rotationCount;
    }

    humanViewpointApplied = viewpointRotationCount > 0
      && await verifyEquivalent444Presentation(publicScramble, rotationlessPublicStages, publicStages);
    if (!humanViewpointApplied) {
      publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);
      viewpointRotationCount = 0;
      yauViewpointRotationCount = 0;
    } else if (result.meta?.method444 === "yau" && yauViewpointRotationCount > 0) {
      yauHumanGripApplied = true;
    }
    } catch (error) {
      console.warn("[444] human viewpoint presentation failed", error);
      publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);
      viewpointRotationCount = 0;
      yauViewpointRotationCount = 0;
      humanViewpointApplied = false;
      yauHumanGripApplied = false;
    }
  }

  const completeSolution = publicStages
    .map((stage) => String(stage.solution || "").trim())
    .filter(Boolean)
    .join(" ");
  const moveCount = countMetric444Moves(completeSolution);
  emitProgress(onProgress, {
    type: "444_stage_done",
    eventId: "444",
    stage: "THREE_BY_THREE",
    stageName: "3x3 CFOP",
    moveCount: internalThreeByThreeStage.moveCount,
  });
  emitProgress(onProgress, {
    type: "444_stage_done",
    eventId: "444",
    stage: "VERIFY",
    stageName: "Final 96-facelet verification",
    moveCount,
  });
  return {
    ok: true,
    eventId: "444",
    status: "ok",
    reason: null,
    detail: null,
    solution: completeSolution,
    moveCount,
    verified: true,
    stages: publicStages,
    source: "WASM_444_COMPLETE",
    meta: {
      ...result.meta,
      apiVersion: api.version(),
      cfopMoveCount: Number(ll.cfopMoveCount) || 0,
      threeByThreeMoveCount: internalThreeByThreeStage.moveCount,
      parityMoveCount: Number(ll.parityMoveCount) || 0,
      reductionParityMoveCount: Number(reductionParityStage?.moveCount) || 0,
      cfopNodes: Number(ll.nodes) || 0,
      cfopStageCount: internalLlSegments.filter((stage) => stage?.parity !== true).length,
      llStageCount: internalLlSegments.length,
      cfopMethod: "CFOP",
      parityHandledAt: "LL",
      ollParityDetected: ll.ollParityDetected === true,
      pllParityDetected: ll.pllParityDetected === true,
      reductionOllParityDetected: result.meta?.ollParityDetected === true,
      reductionPllParityDetected: result.meta?.pllParityDetected === true,
      crossColor,
      method444: result.meta?.method444 === "yau" ? "yau" : method444,
      humanViewpointApplied,
      viewpointRotationCount,
      yauHumanGripApplied,
      yauViewpointRotationCount,
      fullVerificationSolved: true,
    },
  };
}
