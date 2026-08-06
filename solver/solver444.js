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

  if (typeof mod.solve_444_json !== "function") {
    recordFailure("module-api", specifier, new Error("SOLVE_444_JSON_EXPORT_MISSING"));
    return null;
  }

  return {
    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
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
      scramble: String(scramble || "").trim(),
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

  emitProgress(onProgress, {
    type: result.ok
      ? "444_stage_done"
      : result.status === "partial"
        ? "444_stage_update"
        : "444_stage_fail",
    eventId: "444",
    stage: "REDUCTION",
    reason: result.reason,
    status: result.status,
  });
  return result;
}
