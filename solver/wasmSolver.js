const WASM_MODULE_CANDIDATES = [
  "/solver-wasm/solver_wasm.js",
  "../public/solver-wasm/solver_wasm.js",
  "../solver-wasm/pkg/solver_wasm.js",
];

let wasmApiPromise = null;
let wasmApi = null;

function normalizeSolveResponse(raw) {
  if (!raw || typeof raw !== "object") return null;
  const moveCountRaw =
    raw.moveCount ?? raw.move_count ?? raw.moves ?? (typeof raw.solution === "string" ? raw.solution.split(/\s+/).filter(Boolean).length : 0);
  const moveCountNum = Number(moveCountRaw);
  const moveCount = Number.isFinite(moveCountNum) ? Math.max(0, Math.floor(moveCountNum)) : 0;
  return {
    ok: !!raw.ok,
    solution: String(raw.solution || "").trim(),
    moveCount,
    nodes: Number.isFinite(raw.nodes) ? raw.nodes : 0,
    bound: Number.isFinite(raw.bound) ? raw.bound : 0,
    reason: raw.reason ? String(raw.reason) : null,
  };
}

async function loadWasmCandidate(specifier) {
  let mod;
  try {
    mod = await import(/* @vite-ignore */ specifier);
  } catch (_) {
    return null;
  }
  if (!mod) return null;

  const init = typeof mod.default === "function" ? mod.default : typeof mod.init === "function" ? mod.init : null;
  if (init) {
    try {
      await init();
    } catch (_) {
      return null;
    }
  }
  if (typeof mod.solve_json !== "function") return null;
  return {
    solveJson(req) {
      return mod.solve_json(req);
    },
  };
}

export async function ensureWasmSolverReady() {
  if (wasmApi) return wasmApi;
  if (wasmApiPromise) return wasmApiPromise;

  wasmApiPromise = (async () => {
    for (let i = 0; i < WASM_MODULE_CANDIDATES.length; i++) {
      const api = await loadWasmCandidate(WASM_MODULE_CANDIDATES[i]);
      if (!api) continue;
      wasmApi = api;
      return wasmApi;
    }
    return null;
  })();

  return wasmApiPromise;
}

export async function solveWithWasmIfAvailable(scramble, eventId) {
  if (!scramble || !eventId) return null;
  const api = await ensureWasmSolverReady();
  if (!api) return null;

  let rawResponse = "";
  try {
    rawResponse = api.solveJson(
      JSON.stringify({
        scramble,
        event_id: eventId,
      }),
    );
  } catch (_) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(String(rawResponse || ""));
  } catch (_) {
    return null;
  }
  const normalized = normalizeSolveResponse(parsed);
  if (!normalized) return null;
  return {
    ...normalized,
    source: "WASM_SOLVER",
  };
}
