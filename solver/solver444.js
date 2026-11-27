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

// Yau stage budgets default to the historical values; internal options let the
// frame scheduler (and benchmarks) widen them when a frame has time to spare.
function resolveYauBudget444(options, key, fallback) {
  const explicit = Number(options?.[key]);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return fallback;
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

const FACE_TURN_444 = /^(?:(2)([URFDLB])|(3)([URFDLB])w|([URFDLB])(w)?)(2|')?$/;

function remapFaceTurn444(token, mapFace) {
  const match = FACE_TURN_444.exec(token);
  if (!match) return null;
  const [, inner, innerFace, triple, tripleFace, face, wide, suffix] = match;
  const mapped = mapFace(innerFace || tripleFace || face);
  return mapped ? `${inner || triple || ""}${mapped}${triple ? "w" : wide || ""}${suffix || ""}` : null;
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
  return remapFaceTurn444(token, (physicalFace) => VIEW_FACE_ORDER_444.find(
    (face) => orientation.map[face] === physicalFace,
  ));
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
    const { solveEdgePairing323 } = await import("./edgePairing444.js?v=20261126-yau-stages-1");
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
  const turn = remapFaceTurn444(raw, (face) => orientation.map[face]);
  if (turn) return turn;
  const match = /^([xyz])(2|')?$/.exec(raw);
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
  for (const field of ["protectedSideColors", "startingSideColors"]) {
    if (Array.isArray(stage[field])) mapped[field] = stage[field].map((color) => orientation.map[color]);
  }
  if (stage.edgeSideColor) mapped.edgeSideColor = orientation.map[stage.edgeSideColor];
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

// Work around the left face so a regrip keeps every completed pair attached
// to its center. Compare all four grips per turn to minimize regrips across
// insertions and return to the top working slot for the remaining centers.
function planYauCross3View444(segments, from, finish) {
  const grips = VIEW_ORIENTATIONS_444.filter(({ map }) => map.L === finish.map.L);
  const turns = segments.flatMap((segment, index) => splitAlgorithm(segment.solution)
    .map((turn) => ({ turn, index })));
  const rotationCost = (rotation) => 5 * rotation.length + 0.3 * viewRotationExecutionCost444(rotation);
  let paths = [{ grip: from, cost: 0, steps: [] }];
  for (const { turn, index } of turns) {
    const next = [];
    for (const grip of grips) {
      const move = remapPhysical444MoveForView(turn, grip);
      if (!move || /^\d*B/.test(move)) continue;
      let best;
      for (const path of paths) {
        const rotation = shortestViewRotationPath444(path.grip, grip);
        const cost = path.cost + rotationCost(rotation) + viewMoveExecutionCost444([move]);
        if (!best || cost < best.cost) {
          best = { grip, cost, steps: [...path.steps, { index, rotation, move }] };
        }
      }
      if (best) next.push(best);
    }
    paths = next;
  }

  let best;
  for (const path of paths) {
    const rotation = shortestViewRotationPath444(path.grip, finish);
    const cost = path.cost + rotationCost(rotation);
    if (!best || cost < best.cost) best = { ...path, cost, rotation };
  }
  if (!best) throw new Error("444_YAU_CROSS3_VIEW_NOT_FOUND");

  const presented = segments.map((segment) => ({ ...segment, solution: "", viewpointRotations: 0 }));
  for (const { index, rotation, move } of best.steps) {
    const segment = presented[index];
    segment.solution = [segment.solution, ...rotation, move].filter(Boolean).join(" ");
    segment.viewpointRotations += rotation.length;
  }
  const last = presented.at(-1);
  last.solution = [last.solution, ...best.rotation].filter(Boolean).join(" ");
  last.viewpointRotations += best.rotation.length;
  return presented;
}

function yauCross3Grip444(crossColor, workColor) {
  return VIEW_ORIENTATIONS_444.find(({ map }) => map.L === crossColor && map.U === workColor);
}

function yauCenterGrips444(first, opposite, crossColor, canonicalGrip) {
  const identity = VIEW_ORIENTATION_BY_KEY_444.get(viewMapKey444(CFOP_444_IDENTITY_FACE_MAP));
  const upGrips = VIEW_ORIENTATIONS_444.filter(({ map }) => map.U === crossColor);
  const sideColors = [canonicalGrip.map.R, canonicalGrip.map.L];
  const downGrips = VIEW_ORIENTATIONS_444.filter(({ map }) => map.D === crossColor && sideColors.includes(map.R));
  const turnsCost = (segment, grip) => viewMoveExecutionCost444(remapPhysical444SequenceForView(segment.solution, grip));
  let best;
  for (const up of upGrips) {
    const initialGrip = shortestViewRotationPath444(identity, up);
    for (const down of downGrips) {
      const flip = shortestViewRotationPath444(up, down);
      if (flip.length !== 1) continue;
      const cost = turnsCost(first, up) + turnsCost(opposite, down) +
        5 * initialGrip.length + (flip[0] === "z2" ? 0.8 : 0);
      if (!best || cost < best.cost) best = { up, down, cost };
    }
  }
  return best;
}

function makeYauCross3Scorer444(first, opposite, crossColor, canonicalGrip) {
  const physical = (turns) => mapLogical444SequenceToPhysical(turns.join(" "), canonicalGrip);
  const { down } = yauCenterGrips444(
    { solution: physical(first) },
    { solution: physical(opposite) },
    crossColor,
    canonicalGrip,
  );
  return ({ steps, workingFace }) => {
    const leftGrip = yauCross3Grip444(crossColor, canonicalGrip.map[workingFace]);
    const segments = steps.length ? steps.map(({ turns }) => ({ solution: physical(turns) })) : [{ solution: "" }];
    const presented = planYauCross3View444(segments, down, leftGrip);
    return steps.reduce((sum, { turns }) => sum + turns.length, 0) +
      6 * presented.reduce((sum, { viewpointRotations }) => sum + viewpointRotations, 0);
  };
}

function presentYauStages444(stages, crossColor, canonicalGrip, workingFace) {
  const identity = VIEW_ORIENTATION_BY_KEY_444.get(viewMapKey444(CFOP_444_IDENTITY_FACE_MAP));
  const workColor = canonicalGrip.map[workingFace];
  const leftGrip = yauCross3Grip444(crossColor, workColor);
  // Place the 3-2-3 working slot at DR and keep that grip into CFOP.
  const edgeGrip = VIEW_ORIENTATIONS_444.find(({ map }) => map.D === crossColor && map.R === workColor);
  if (!leftGrip || !edgeGrip) return null;
  const [setup, edges, cfop] = stages;
  const [first, opposite] = setup.segments;
  const firstPair = yauCenterGrips444(first, opposite, crossColor, canonicalGrip);

  let current = identity;
  let rotationCount = 0;
  function presentSegment(segment, grip, keepCrossGrip = false) {
    if (segment.segments?.length) {
      const children = segment.segments.map((item) => presentSegment(item, keepCrossGrip && item.name === "Cross" ? current : grip));
      return {
        ...segment,
        segments: children,
        solution: children.map(({ solution }) => solution).filter(Boolean).join(" "),
        viewpointRotations: children.reduce((count, item) => count + item.viewpointRotations, 0),
      };
    }
    const transition = shortestViewRotationPath444(current, grip);
    const turns = remapPhysical444SequenceForView(segment.solution, grip);
    if (!turns) throw new Error(`444_YAU_PRESENTATION_MOVE:${segment.id}`);
    current = grip;
    rotationCount += transition.length;
    return { ...segment, solution: [...transition, ...turns].join(" "), viewpointRotations: transition.length };
  }
  const [cross3, sides, cross4] = setup.segments.slice(2);
  const setupSegments = [presentSegment(first, firstPair.up), presentSegment(opposite, firstPair.down)];
  const crossSteps = planYauCross3View444(cross3.segments.length ? cross3.segments : [cross3], current, leftGrip);
  const crossRotations = crossSteps.reduce((count, step) => count + step.viewpointRotations, 0);
  setupSegments.push({
    ...cross3,
    solution: crossSteps.map(({ solution }) => solution).filter(Boolean).join(" "),
    segments: cross3.segments.length ? crossSteps : [],
    viewpointRotations: crossRotations,
  });
  current = leftGrip;
  rotationCount += crossRotations;
  setupSegments.push(presentSegment(sides, leftGrip), presentSegment(cross4, leftGrip));
  const presentedEdges = presentSegment(edges, edgeGrip);
  const presentedCfop = presentSegment(cfop, edgeGrip, true);
  return {
    stages: [
      { ...setup, segments: setupSegments, solution: setupSegments.map(({ solution }) => solution).filter(Boolean).join(" ") },
      presentedEdges,
      presentedCfop,
    ],
    rotationCount,
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
  return method444 === "yau"
    ? solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs)
    : solve444Frame(publicScramble, onProgress, options, crossColor, deadlineTs);
}

async function solve444Frame(publicScramble, onProgress, options, crossColor, deadlineTs) {
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

  result = await preferHumanEdgePairing323(api, result, publicScramble, internalScramble, crossColor, deadlineTs);

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

  return finish444Cfop({
    api, publicScramble, onProgress, crossColor, deadlineTs, options,
    stages: [reductionStageToPublic444(centerStage), reductionStageToPublic444(edgeStage)],
    meta: result.meta,
    reductionParityMoveCount: Number(reductionParityStage?.moveCount) || 0,
  });
}

function reductionStageToPublic444(stage) {
  return {
    ...stage,
    solution: translate444MoveConvention(stage.solution),
    segments: stage.segments?.map(reductionStageToPublic444),
  };
}

function verifierNotation444(sequence) {
  const moves = splitAlgorithm(sequence).flatMap((turn) => {
    const match = FACE_TURN_444.exec(turn);
    if (!match) return [turn];
    const [, inner, innerFace, triple, tripleFace, , , suffix = ""] = match;
    const inverse = suffix === "2" ? "2" : suffix === "'" ? "" : "'";
    if (inner) return [`${innerFace}w${suffix}`, `${innerFace}${inverse}`];
    if (triple) {
      const opposite = OPPOSITE_FACE_444[tripleFace];
      return [`${tripleFace}w${suffix}`, `${opposite}w${inverse}`, `${opposite}${suffix}`];
    }
    return [turn];
  });
  return translate444MoveConvention(moves.join(" "));
}

async function presentReduction444(publicScramble, verifiedStages, meta, crossColor) {
  const stages = structuredClone(verifiedStages);
  const [centers, edges, cfop] = stages;
  const centerView = buildHumanCenterPresentation444(centers, meta?.centerPhaseMoveCounts, crossColor);
  if (centerView) centers.method = "Cross → Opposite → Remaining 4";
  const edgeView = edges.segments?.length ? buildHumanYawPresentation444(edges.segments) : null;
  const cfopView = cfop.segments?.length ? buildHumanCfopPresentation444(cfop.segments, crossColor) : null;
  let rotations = 0;
  for (const [stage, view] of [[centers, centerView], [edges, edgeView], [cfop, cfopView]]) {
    if (!view) continue;
    stage.segments = view.segments;
    stage.solution = view.segments.map(({ solution }) => solution).filter(Boolean).join(" ");
    rotations += view.rotationCount;
  }
  return rotations && await verifyEquivalent444Presentation(publicScramble, verifiedStages, stages)
    ? { stages, rotations } : { stages: verifiedStages, rotations: 0 };
}

async function finish444Cfop({
  api, publicScramble, onProgress, crossColor, deadlineTs, options = {}, stages, meta,
  reductionParityMoveCount = 0,
}) {
  const [centers, edges] = stages;
  const isYau = meta.method444 === "yau";
  emitProgress(onProgress, {
    type: "444_stage_start", eventId: "444", stage: "THREE_BY_THREE", stageName: "3x3 CFOP · LL parity",
  });

  let ll;
  try {
    const { solveLlDeferred444 } = await import("./llParity444.js?v=20261126-yau-stages-1");
    ll = await solveLlDeferred444({
      scramble: publicScramble,
      centerSolution: centers.solution,
      edgeSolution: edges.solution,
      crossColor,
      deadlineTs,
      onProgress(progress) {
        emitProgress(onProgress, {
          type: "444_stage_update", eventId: "444", stage: "THREE_BY_THREE", phase: "ll",
          stageName: "3x3 CFOP · LL parity", cfopStageName: String(progress?.stageName || "LL"),
        });
      },
    });
  } catch (error) {
    ll = { ok: false, reason: "444_LL_PARITY_BRIDGE_FAILED", detail: String(error?.message || error) };
  }
  if (!ll?.ok) {
    const timeout = deadlineReached(deadlineTs);
    const reason = timeout ? "444_DEADLINE_REACHED" : "444_LL_PARITY_FAILED";
    emitProgress(onProgress, { type: "444_stage_fail", eventId: "444", stage: "THREE_BY_THREE", reason });
    return {
      ...emptyFailure(reason, timeout ? "timeout" : "partial", ll?.detail || ll?.reason, {
        ...meta, llParityReason: ll?.reason || null, parityHandledAt: "LL",
      }),
      stages,
    };
  }

  const cfopSegments = ll.segments.map((stage, index) => ({
    ...stage,
    id: stage.id || `cfop${index + 1}`,
    name: normalizeCfopStageName(stage.name),
    solution: String(stage.solution || "").trim(),
    moveCount: splitAlgorithm(stage.solution).length,
    verified: true,
  }));
  const cfopSolution = cfopSegments.map(({ solution }) => solution).filter(Boolean).join(" ");
  const cfop = {
    id: "threeByThree", name: "3x3 CFOP", solution: cfopSolution,
    moveCount: splitAlgorithm(cfopSolution).length, verified: true, method: "CFOP · LL Parity", segments: cfopSegments,
  };
  const verifiedStages = [...stages, cfop];
  const plainSolution = verifiedStages.map(({ solution }) => solution).filter(Boolean).join(" ");
  let verification;
  try {
    verification = JSON.parse(String(api.verify({
      scramble: verifierNotation444(publicScramble),
      solution: verifierNotation444(plainSolution),
    }) || ""));
  } catch (error) {
    verification = { ok: false, solved: false, reason: String(error?.message || error) };
  }
  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {
      type: "444_stage_fail", eventId: "444", stage: "VERIFY", reason: verification?.reason || "444_FINAL_VERIFICATION_FAILED",
    });
    return {
      ...emptyFailure("444_FINAL_VERIFICATION_FAILED", "error", verification?.reason, {
        ...meta, parityHandledAt: "LL", fullVerificationSolved: false,
      }),
      stages,
    };
  }

  let publicStages = verifiedStages;
  let viewpointRotationCount = 0;
  if (!isYau) {
    try {
      if (!String(edges.method || "").includes("3-2-3")) {
        edges.segments = await buildEdgePairingSegments(publicScramble, centers.solution, edges.solution);
      }
      if (options?.__skipHumanPresentation !== true) {
        const presentation = await presentReduction444(publicScramble, verifiedStages, meta, crossColor);
        publicStages = presentation.stages;
        viewpointRotationCount = presentation.rotations;
      }
    } catch (error) {
      console.warn("[444] reduction presentation failed", error);
    }
  }
  const solution = publicStages.map((stage) => stage.solution).filter(Boolean).join(" ");
  const moveCount = countMetric444Moves(solution);
  emitProgress(onProgress, { type: "444_stage_done", eventId: "444", stage: "THREE_BY_THREE", stageName: "3x3 CFOP", moveCount: cfop.moveCount });
  if (!isYau) emitProgress(onProgress, { type: "444_stage_done", eventId: "444", stage: "VERIFY", moveCount });

  return {
    ok: true, eventId: "444", status: "ok", reason: null, detail: null, solution, moveCount, verified: true,
    stages: publicStages,
    source: "WASM_444_COMPLETE",
    meta: {
      ...meta,
      apiVersion: api.version(),
      cfopMoveCount: Number(ll.cfopMoveCount) || 0,
      threeByThreeMoveCount: cfop.moveCount,
      parityMoveCount: Number(ll.parityMoveCount) || 0,
      reductionParityMoveCount,
      cfopNodes: Number(ll.nodes) || 0,
      cfopStageCount: cfopSegments.filter((stage) => stage.parity !== true).length,
      llStageCount: cfopSegments.length,
      cfopMethod: "CFOP",
      parityHandledAt: "LL",
      ollParityDetected: ll.ollParityDetected === true,
      pllParityDetected: ll.pllParityDetected === true,
      reductionOllParityDetected: isYau ? ll.reducedParity.oll : meta.ollParityDetected === true,
      reductionPllParityDetected: isYau ? ll.reducedParity.pll : meta.pllParityDetected === true,
      ...(isYau ? { virtual333Ready: true, virtual333: ll.reducedCubie, parityNormalized: false } : {}),
      crossColor,
      method444: isYau ? "yau" : "reduction",
      humanViewpointApplied: viewpointRotationCount > 0,
      viewpointRotationCount,
      fullVerificationSolved: true,
    },
  };
}

async function solveYauCanonicalFrame444(publicScramble, onProgress, options, crossColor, deadlineTs) {
  const hardDeadline = deadlineTs || Date.now() + 60_000;
  const base = yauCanonicalOrientation444(crossColor);
  const meta = { method444: "yau", crossColor, yauCanonicalCrossColor: "D", yauFrameRotation: base.token };
  if (deadlineReached(hardDeadline)) return emptyFailure("444_DEADLINE_REACHED", "timeout", null, meta);

  const frames = ["y2", "y'", "", "y"].flatMap((spin) => {
    const parsed = rotationTokenAmount444(spin);
    const map = parsed ? cfop444ComposeFaceMaps(base.map, cfop444RotationMap(parsed.axis, parsed.amount)) : base.map;
    const orientation = { map, key: viewMapKey444(map) };
    const scramble = mapPhysical444SequenceToLogical(publicScramble, orientation);
    return scramble == null ? [] : [{ spin, orientation, scramble }];
  });
  if (!frames.length) return emptyFailure("444_INVALID_SCRAMBLE", "invalid", null, meta);

  const progress = (stage, extra = {}) => emitProgress(onProgress, { type: "444_stage_start", eventId: "444", stage, ...extra });
  progress("BOUNDARY");
  const api = await ensureSolver444Ready();
  if (!api) return emptyFailure("444_WASM_UNAVAILABLE", "unavailable", solver444LastFailure?.message, meta);

  let yau;
  try {
    yau = await import("./yau444.js?v=20261127-yau-natural-centers-1");
  } catch (error) {
    return emptyFailure("444_YAU_MODULE_UNAVAILABLE", "error", error?.message, meta);
  }

  const attempts = [];
  let last = emptyFailure("444_YAU_ALL_FRAMES_FAILED", "partial", null, meta);
  for (const [index, { spin, orientation, scramble }] of frames.entries()) {
    if (deadlineReached(hardDeadline)) break;
    const started = Date.now();
    const remaining = hardDeadline - started;
    const budget = Math.max(750, Math.min(20000, Math.floor(remaining / (frames.length - index))));
    const frameDeadline = Math.min(hardDeadline, started + budget);
    progress("YAU_FRAME", { attempt: index + 1 });
    try {
      const reduction = await yau.solveYauPhases444(scramble, {
        deadlineTs: frameDeadline,
        edgeBudgetMs: resolveYauBudget444(options, "__yauEdgeBudgetMs", 12000),
        cross4BudgetMs: resolveYauBudget444(options, "__yauCross4BudgetMs", 1500),
        onStage: progress,
        scoreCross3Plans: (first, opposite) => makeYauCross3Scorer444(first, opposite, crossColor, orientation),
      });
      const result = await finish444Cfop({
        api, publicScramble: scramble, onProgress, crossColor: "D", deadlineTs: frameDeadline,
        stages: reduction.stages, meta: reduction.meta,
      });
      if (!result.ok) {
        last = result;
      } else {
        const mapped = result.stages.map((stage) => mapYauStageToPhysical444(stage, orientation));
        if (mapped.some((stage) => stage == null)) throw new Error("444_YAU_FRAME_MAPPING_FAILED");
        const presentation = presentYauStages444(mapped, crossColor, orientation, reduction.workingFace);
        if (!presentation) throw new Error("444_YAU_FRAME_MAPPING_FAILED");
        await yau.verifyYauPlayback444(publicScramble, presentation.stages, crossColor);
        const solution = presentation.stages.map((stage) => stage.solution).filter(Boolean).join(" ");
        const moveCount = countMetric444Moves(solution);
        attempts.push({ spin: spin || "identity", elapsedMs: Date.now() - started, ok: true });
        emitProgress(onProgress, { type: "444_stage_done", eventId: "444", stage: "VERIFY", moveCount });
        return {
          ...result, solution, moveCount, stages: presentation.stages,
          meta: {
            ...result.meta, ...meta,
            yauFrameSpin: spin || "identity", yauFrameAttemptCount: attempts.length, yauFrameAttempts: attempts,
            humanViewpointApplied: true, viewpointRotationCount: presentation.rotationCount,
            yauHumanGripApplied: true, yauViewpointRotationCount: presentation.rotationCount,
            yauPlaybackVerified: true,
          },
        };
      }
    } catch (error) {
      const detail = String(error?.message || error);
      const code = detail.split(":", 1)[0];
      last = emptyFailure(/^444_[A-Z0-9_]+$/.test(code) ? code : "444_YAU_PHASE_FAILED", "partial", detail, meta);
    }
    attempts.push({ spin: spin || "identity", elapsedMs: Date.now() - started, ok: false, reason: last.reason, detail: last.detail });
  }
  const report = { ...last.meta, ...meta, yauFrameAttemptCount: attempts.length, yauFrameAttempts: attempts };
  if (deadlineReached(hardDeadline)) return emptyFailure("444_DEADLINE_REACHED", "timeout", last.reason, report);
  return emptyFailure(last.reason === "444_DEADLINE_REACHED" ? "444_YAU_ALL_FRAMES_FAILED" : last.reason, "partial", last.detail, report);
}
