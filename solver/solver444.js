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

export async function solve444(scramble, onProgress = null, options = {}) {
  const deadlineTs = Number(options?.deadlineTs) || 0;
  const crossColor = /^[URFDLB]$/i.test(String(options?.crossColor || "D"))
    ? String(options?.crossColor || "D").toUpperCase()
    : "D";
  const publicScramble = String(scramble || "").trim();
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

  result = await preferHumanEdgePairing323(
    api,
    result,
    publicScramble,
    internalScramble,
    crossColor,
    deadlineTs,
  );

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
    if (publicEdgeStage && publicEdgeStage.method !== "3-2-3") {
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
  try {
    const publicCenterStage = publicStages.find((stage) => stage?.id === "centers");
    const publicEdgeStage = publicStages.find((stage) => stage?.id === "edges");
    const publicCfopStage = publicStages.find((stage) => stage?.id === "threeByThree");

    const centerHuman = publicCenterStage
      ? buildHumanCenterPresentation444(publicCenterStage, result.meta?.centerPhaseMoveCounts, crossColor)
      : null;
    if (centerHuman) {
      publicCenterStage.segments = centerHuman.segments;
      publicCenterStage.solution = centerHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      publicCenterStage.method = "Cross → Opposite → Remaining 4";
      viewpointRotationCount += centerHuman.rotationCount;
    }

    const edgeHuman = publicEdgeStage?.segments?.length
      ? buildHumanYawPresentation444(publicEdgeStage.segments)
      : null;
    if (edgeHuman) {
      publicEdgeStage.segments = edgeHuman.segments;
      publicEdgeStage.solution = edgeHuman.segments.map((segment) => segment.solution).filter(Boolean).join(" ");
      viewpointRotationCount += edgeHuman.rotationCount;
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
    }
  } catch (error) {
    console.warn("[444] human viewpoint presentation failed", error);
    publicStages.splice(0, publicStages.length, ...rotationlessPublicStages);
    viewpointRotationCount = 0;
    humanViewpointApplied = false;
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
      humanViewpointApplied,
      viewpointRotationCount,
      fullVerificationSolved: true,
    },
  };
}
