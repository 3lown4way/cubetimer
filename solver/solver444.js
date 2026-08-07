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

async function solveCfop333FromCubie(cubieState, onProgress, deadlineTs) {
  const [{ getDefaultPattern }, { solve3x3StrictCfopFromPattern }] = await Promise.all([
    import("./context.js"),
    import("./cfop3x3.js"),
  ]);
  const solved333 = await getDefaultPattern("333");
  const pattern = build333PatternFromCubie(solved333, cubieState);
  return solve3x3StrictCfopFromPattern(pattern, {
    mode: "strict",
    crossColor: "D",
    solverVersion: "v2",
    deadlineTs,
    enableHumanViewpoint: false,
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
      deadlineTs,
    }));
  } catch (error) {
    recordFailure("solve-call", null, error);
    result = emptyFailure("444_WASM_CALL_FAILED", "error", error?.message || error, {
      deadlineTs,
      apiVersion: api.version(),
    });
  }

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

  const parityStage = Array.isArray(result.stages)
    ? result.stages.find((stage) => stage?.id === "parity" && stage?.verified === true)
    : null;
  if (parityStage && result.meta?.parityNormalized === true) {
    emitProgress(onProgress, {
      type: "444_stage_done",
      eventId: "444",
      stage: "PARITY",
      stageName: "Parity Normalization",
      moveCount: Number(parityStage.moveCount) || 0,
      ollParityDetected: result.meta.ollParityDetected === true,
      pllParityDetected: result.meta.pllParityDetected === true,
    });
  }

  if (result.meta?.virtual333Ready === true && result.meta?.virtual333) {
    emitProgress(onProgress, {
      type: "444_stage_done",
      eventId: "444",
      stage: "VIRTUAL_333",
      stageName: "Virtual 3x3",
      cubieState: result.meta.virtual333,
    });
  }

  if (
    result.status !== "partial" ||
    result.reason !== "444_REDUCTION_INCOMPLETE" ||
    result.meta?.virtual333Ready !== true ||
    !result.meta?.virtual333
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
    stageName: "3x3 CFOP",
  });

  let cfop;
  try {
    cfop = await solveCfop333FromCubie(result.meta.virtual333, onProgress, deadlineTs);
  } catch (error) {
    cfop = { ok: false, reason: "CFOP_CUBIE_BRIDGE_FAILED", detail: String(error?.message || error) };
  }

  if (!cfop?.ok) {
    const timedOut = deadlineReached(deadlineTs);
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "THREE_BY_THREE",
      reason: cfop?.reason || "444_CFOP_FAILED",
    });
    return {
      ...result,
      status: timedOut ? "timeout" : "partial",
      reason: timedOut ? "444_DEADLINE_REACHED" : "444_CFOP_FAILED",
      detail: cfop?.reason || cfop?.detail || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        cfopReason: cfop?.reason || null,
      },
    };
  }

  const publicCfopSegments = (Array.isArray(cfop.stages) ? cfop.stages : []).map((stage, index) => ({
    id: `cfop${index + 1}`,
    name: normalizeCfopStageName(stage?.name),
    solution: String(stage?.solution || "").trim(),
    moveCount: splitAlgorithm(stage?.solution).length,
    verified: true,
  }));
  const publicCfopSolution = publicCfopSegments
    .map((stage) => stage.solution)
    .filter(Boolean)
    .join(" ");
  const unsupportedCfopMove = splitAlgorithm(publicCfopSolution)
    .find((move) => !/^[URFDLB](?:2|')?$/.test(move));
  if (unsupportedCfopMove) {
    return {
      ...result,
      status: "partial",
      reason: "444_CFOP_UNSUPPORTED_MOVE",
      detail: unsupportedCfopMove,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        cfopUnsupportedMove: unsupportedCfopMove,
      },
    };
  }

  const internalCfopSegments = publicCfopSegments.map((stage) => ({
    ...stage,
    solution: translate444MoveConvention(stage.solution),
  }));
  const internalCfopSolution = internalCfopSegments
    .map((stage) => stage.solution)
    .filter(Boolean)
    .join(" ");
  const internalThreeByThreeStage = {
    id: "threeByThree",
    name: "3x3 CFOP",
    solution: internalCfopSolution,
    moveCount: splitAlgorithm(internalCfopSolution).length,
    verified: false,
    method: "CFOP",
    segments: internalCfopSegments,
  };
  const internalCompleteStages = [...result.stages, internalThreeByThreeStage];
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
        cfopMoveCount: internalThreeByThreeStage.moveCount,
        cfopMethod: "CFOP",
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
    if (publicEdgeStage) {
      publicEdgeStage.segments = await buildEdgePairingSegments(
        publicScramble,
        publicCenterStage?.solution || "",
        publicEdgeStage.solution || "",
      );
    }
  } catch (error) {
    console.warn("[444] edge pairing segmentation failed", error);
  }
  const completeSolution = publicStages
    .map((stage) => String(stage.solution || "").trim())
    .filter(Boolean)
    .join(" ");
  const moveCount = splitAlgorithm(completeSolution).length;
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
      cfopMoveCount: internalThreeByThreeStage.moveCount,
      cfopNodes: Number(cfop.nodes) || 0,
      cfopStageCount: internalCfopSegments.length,
      cfopMethod: "CFOP",
      fullVerificationSolved: true,
    },
  };
}
