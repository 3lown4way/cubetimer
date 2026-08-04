import { loadChunkedMinmove333Bundle } from "./minmoveBundleLoader.js";

const WASM_MODULE_CANDIDATES = [
  new URL("../public/solver-wasm/solver_wasm.js", import.meta.url).href,
  new URL("../solver-wasm/pkg/solver_wasm.js", import.meta.url).href,
];
const MINMOVE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/minmove/minmove-333-v8.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v7.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v6.bin", import.meta.url).href,
];
const MINMOVE_333_MANIFEST_CANDIDATES = [
  new URL("../public/solver-wasm/minmove/minmove-333-v8.manifest.json", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v7.manifest.json", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v6.manifest.json", import.meta.url).href,
];
const TWOPHASE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/twophase/twophase-333-v2.bin", import.meta.url).href,
  new URL("../public/solver-wasm/twophase/twophase-333-v1.bin", import.meta.url).href,
];

let wasmApiPromise = null;
let wasmApi = null;
let minmove333ReadyPromise = null;
let twophase333ReadyPromise = null;

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

  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  const isBrowserLike = typeof window !== "undefined" || typeof self !== "undefined";
  if (typeof mod.initSync === "function" && isNode && !isBrowserLike) {
    try {
      const { fileURLToPath } = await import("url");
      const fs = await import("fs");
      const wasmUrl = new URL("solver_wasm_bg.wasm", specifier);
      const wasmBytes = fs.readFileSync(fileURLToPath(wasmUrl));
      mod.initSync({ module: wasmBytes });
    } catch (_) {
      return null;
    }
  } else {
    const init = typeof mod.default === "function" ? mod.default : typeof mod.init === "function" ? mod.init : null;
    if (init) {
      try {
        await init();
      } catch (_) {
        return null;
      }
    }
  }
  if (typeof mod.solve_json !== "function") return null;
  return {
    solveJson(req) {
      return mod.solve_json(req);
    },
    loadMinmove333Bundle(bytes) {
      if (typeof mod.load_minmove_333_bundle !== "function") return false;
      mod.load_minmove_333_bundle(bytes);
      return true;
    },
    beginMinmove333Bundle(totalBytes) {
      if (typeof mod.begin_minmove_333_bundle !== "function") {
        throw new Error("MINMOVE_CHUNK_API_UNAVAILABLE");
      }
      mod.begin_minmove_333_bundle(totalBytes >>> 0);
      return true;
    },
    appendMinmove333BundleGzipChunk(bytes) {
      if (typeof mod.append_minmove_333_bundle_gzip_chunk !== "function") {
        throw new Error("MINMOVE_CHUNK_API_UNAVAILABLE");
      }
      return Number(mod.append_minmove_333_bundle_gzip_chunk(bytes));
    },
    finishMinmove333Bundle(totalBytes) {
      if (typeof mod.finish_minmove_333_bundle !== "function") {
        throw new Error("MINMOVE_CHUNK_API_UNAVAILABLE");
      }
      mod.finish_minmove_333_bundle(totalBytes >>> 0);
      return true;
    },
    abortMinmove333Bundle() {
      if (typeof mod.abort_minmove_333_bundle === "function") {
        mod.abort_minmove_333_bundle();
      }
    },
    warmMinmove333() {
      if (typeof mod.warm_minmove_333 !== "function") return false;
      mod.warm_minmove_333();
      return true;
    },
    prepareMinmove333(scramble) {
      if (typeof mod.prepare_minmove_333 !== "function") return "";
      return mod.prepare_minmove_333(scramble);
    },
    searchMinmoveBound(searchId, bound, maxNodes) {
      if (typeof mod.search_minmove_bound !== "function") return "";
      return mod.search_minmove_bound(searchId, bound, maxNodes >>> 0);
    },
    dropMinmoveSearch(searchId) {
      if (typeof mod.drop_minmove_search !== "function") return false;
      mod.drop_minmove_search(searchId);
      return true;
    },
    loadTwophase333Bundle(bytes) {
      if (typeof mod.load_twophase_333_bundle !== "function") return false;
      mod.load_twophase_333_bundle(bytes);
      return true;
    },
    warmTwophase333() {
      if (typeof mod.warm_twophase_333 !== "function") return false;
      mod.warm_twophase_333();
      return true;
    },
    prepareTwophase333(scramble, optionsJson) {
      if (typeof mod.prepare_twophase_333 !== "function") return "";
      return mod.prepare_twophase_333(scramble, optionsJson);
    },
    searchTwophase333(searchId, optionsJson) {
      if (typeof mod.search_twophase_333 !== "function") return "";
      return mod.search_twophase_333(searchId, optionsJson);
    },
    searchTwophaseExact333(scramble, optionsJson) {
      if (typeof mod.search_twophase_exact_333 !== "function") return "";
      return mod.search_twophase_exact_333(scramble, optionsJson);
    },
    dropTwophaseSearch(searchId) {
      if (typeof mod.drop_twophase_search !== "function") return false;
      mod.drop_twophase_search(searchId);
      return true;
    },
    solvePhase2Direct(cpIdx, epIdx, sepIdx, maxDepth, nodeLimit) {
      if (typeof mod.solve_phase2_direct !== "function") return "";
      return mod.solve_phase2_direct(cpIdx, epIdx, sepIdx, maxDepth, nodeLimit >>> 0);
    },
    buildFmcTablesWasm() {
      if (typeof mod.build_fmc_tables_wasm !== "function") return "";
      return mod.build_fmc_tables_wasm();
    },
    warmFmcDeepTablesWasm() {
      if (typeof mod.warm_fmc_deep_tables_wasm !== "function") return "";
      return mod.warm_fmc_deep_tables_wasm();
    },
    solveFmcWasm(scramble, optionsJson) {
      if (typeof mod.solve_fmc_wasm !== "function") return "";
      return mod.solve_fmc_wasm(scramble, optionsJson);
    },
    optimizeInsertionWasm(scramble, movesStr, optionsJson) {
      if (typeof mod.optimize_insertion_wasm !== "function") return "";
      return mod.optimize_insertion_wasm(scramble, movesStr, optionsJson);
    },
    verifyFmcSolutionWasm(scramble, solution) {
      if (typeof mod.verify_fmc_solution_wasm !== "function") return "";
      return mod.verify_fmc_solution_wasm(scramble, solution);
    },
  };
}

async function loadBinaryCandidate(url) {
  if (url.startsWith("file://")) {
    try {
      const { fileURLToPath } = await import("url");
      const fs = await import("fs");
      const filePath = fileURLToPath(url);
      return new Uint8Array(fs.readFileSync(filePath));
    } catch (_) {
      return null;
    }
  }
  let response;
  try {
    response = await fetch(url, { cache: "force-cache" });
  } catch (_) {
    return null;
  }
  if (!response.ok) return null;
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (_) {
    return null;
  }
}

async function loadMinmove333BundleBytes() {
  for (let i = 0; i < MINMOVE_333_BUNDLE_CANDIDATES.length; i += 1) {
    const bytes = await loadBinaryCandidate(MINMOVE_333_BUNDLE_CANDIDATES[i]);
    if (bytes) return bytes;
  }
  return null;
}

async function loadTwophase333BundleBytes() {
  for (let i = 0; i < TWOPHASE_333_BUNDLE_CANDIDATES.length; i += 1) {
    const bytes = await loadBinaryCandidate(TWOPHASE_333_BUNDLE_CANDIDATES[i]);
    if (bytes) return bytes;
  }
  return null;
}

function parseJsonResponse(rawResponse) {
  try {
    return JSON.parse(String(rawResponse || ""));
  } catch (_) {
    return null;
  }
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

export async function ensureMinmove333Ready(onProgress = null) {
  const api = await ensureWasmSolverReady();
  if (!api) return null;
  if (minmove333ReadyPromise) return minmove333ReadyPromise;

  const readyPromise = (async () => {
    let loaded = false;
    const chunkedResult = await loadChunkedMinmove333Bundle(
      api,
      MINMOVE_333_MANIFEST_CANDIDATES,
      { onProgress },
    );
    loaded = chunkedResult.ok === true;

    if (!loaded && typeof api.loadMinmove333Bundle === "function") {
      const bytes = await loadMinmove333BundleBytes();
      if (bytes) {
        try {
          loaded = api.loadMinmove333Bundle(bytes) !== false;
        } catch (_) {
          loaded = false;
        }
      }
    }
    if (!loaded) return null;

    try {
      if (typeof api.warmMinmove333 === "function") {
        api.warmMinmove333();
      }
      return api;
    } catch (_) {
      return null;
    }
  })();

  minmove333ReadyPromise = readyPromise;
  const ready = await readyPromise;
  if (!ready && minmove333ReadyPromise === readyPromise) {
    minmove333ReadyPromise = null;
  }
  return ready;
}

export async function ensureTwophase333Ready() {
  const api = await ensureWasmSolverReady();
  if (!api) return null;
  if (twophase333ReadyPromise) return twophase333ReadyPromise;

  twophase333ReadyPromise = (async () => {
    if (typeof api.loadTwophase333Bundle !== "function") return null;
    const bytes = await loadTwophase333BundleBytes();
    if (!bytes) return null;
    try {
      const loaded = api.loadTwophase333Bundle(bytes);
      if (!loaded) return null;
      if (typeof api.warmTwophase333 === "function") {
        api.warmTwophase333();
      }
      return api;
    } catch (_) {
      return null;
    }
  })();

  return twophase333ReadyPromise;
}

export async function prepareMinmove333(scramble) {
  const api = await ensureMinmove333Ready();
  if (!api || typeof api.prepareMinmove333 !== "function") return null;

  let rawResponse = "";
  try {
    rawResponse = api.prepareMinmove333(String(scramble || ""));
  } catch (_) {
    return null;
  }
  return parseJsonResponse(rawResponse);
}

export async function searchMinmove333Bound(searchId, bound, maxNodes = 8000000) {
  const api = await ensureMinmove333Ready();
  if (!api || typeof api.searchMinmoveBound !== "function") return null;

  let rawResponse = "";
  try {
    rawResponse = api.searchMinmoveBound(searchId, bound, maxNodes);
  } catch (_) {
    return null;
  }
  return parseJsonResponse(rawResponse);
}

export async function prepareTwophase333(scramble, options = {}) {
  const api = await ensureTwophase333Ready();
  if (!api || typeof api.prepareTwophase333 !== "function") return null;

  let rawResponse = "";
  try {
    rawResponse = api.prepareTwophase333(String(scramble || ""), JSON.stringify(options || {}));
  } catch (_) {
    return null;
  }
  return parseJsonResponse(rawResponse);
}

export async function searchTwophase333(searchId, options = {}) {
  const api = await ensureTwophase333Ready();
  if (!api || typeof api.searchTwophase333 !== "function") return null;

  let rawResponse = "";
  try {
    rawResponse = api.searchTwophase333(searchId, JSON.stringify(options || {}));
  } catch (_) {
    return null;
  }
  return parseJsonResponse(rawResponse);
}

export async function searchTwophaseExact333(scramble, options = {}) {
  const api = await ensureTwophase333Ready();
  if (!api || typeof api.searchTwophaseExact333 !== "function") return null;

  let rawResponse = "";
  try {
    rawResponse = api.searchTwophaseExact333(String(scramble || ""), JSON.stringify(options || {}));
  } catch (_) {
    return null;
  }
  return parseJsonResponse(rawResponse);
}

export async function dropTwophase333Search(searchId) {
  const api = await ensureTwophase333Ready();
  if (!api || typeof api.dropTwophaseSearch !== "function") return false;
  try {
    return api.dropTwophaseSearch(searchId) !== false;
  } catch (_) {
    return false;
  }
}

/**
 * Solve Phase 2 directly using WASM with (cpIdx, epIdx, sepIdx) coordinates.
 * Returns { ok, moves: string[], depth, nodes } or null if WASM unavailable.
 */
export async function solvePhase2Direct(cpIdx, epIdx, sepIdx, maxDepth = 18, nodeLimit = 0) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.solvePhase2Direct !== "function") return null;
  try {
    const raw = api.solvePhase2Direct(cpIdx, epIdx, sepIdx, maxDepth, nodeLimit >>> 0);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && parsed.ok !== undefined ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Build FMC-specific tables (CO×Slice BFS, EO distance) on top of twophase tables.
 * Built once and cached.
 */
let fmcTablesBuilt = false;
export async function buildFmcTablesWasm() {
  if (fmcTablesBuilt) return true;
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return false;
  }
  if (!api || typeof api.buildFmcTablesWasm !== "function") return false;
  try {
    const raw = api.buildFmcTablesWasm();
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    fmcTablesBuilt = !!(parsed && parsed.ok);
    return fmcTablesBuilt;
  } catch (_) {
    return false;
  }
}

let fmcDeepTablesWarmPromise = null;
export async function warmFmcDeepTablesWasm() {
  if (fmcDeepTablesWarmPromise) return fmcDeepTablesWarmPromise;
  fmcDeepTablesWarmPromise = (async () => {
    if (!(await buildFmcTablesWasm())) return null;
    const api = await ensureTwophase333Ready();
    if (!api || typeof api.warmFmcDeepTablesWasm !== "function") return null;
    try {
      const raw = api.warmFmcDeepTablesWasm();
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return parsed?.ok ? parsed : null;
    } catch (_) {
      return null;
    }
  })();
  const result = await fmcDeepTablesWarmPromise;
  if (!result) fmcDeepTablesWarmPromise = null;
  return result;
}

function normalizeFmcMoveTokens(value) {
  if (Array.isArray(value)) return value.map((move) => String(move || "").trim()).filter(Boolean);
  return String(value || "").trim().split(/\s+/).filter(Boolean);
}

function invertFmcMoveToken(token) {
  const value = String(token || "").trim();
  if (!value || value.endsWith("2")) return value;
  return value.endsWith("'") ? value.slice(0, -1) : value + "'";
}

function invertFmcMoveSequence(tokens) {
  return normalizeFmcMoveTokens(tokens).reverse().map(invertFmcMoveToken);
}

function simplifyFmcMoveSequence(tokens) {
  const output = [];
  for (const rawToken of normalizeFmcMoveTokens(tokens)) {
    const match = /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(rawToken);
    if (!match) {
      output.push(rawToken);
      continue;
    }
    const face = match[1];
    const amount = match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1;
    const previous = output[output.length - 1];
    const previousMatch = previous ? /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(previous) : null;
    if (!previousMatch || previousMatch[1] !== face) {
      output.push(rawToken);
      continue;
    }
    const previousAmount = previousMatch[2] === "2" ? 2 : previousMatch[2] === "'" ? 3 : 1;
    const combined = (previousAmount + amount) % 4;
    output.pop();
    if (combined === 1) output.push(face);
    else if (combined === 2) output.push(face + "2");
    else if (combined === 3) output.push(face + "'");
  }
  return output;
}

function buildVerifiedPremoveNissAlternates(candidate) {
  const sourceTag = String(candidate?.source || "");
  if (!/^FMC_(?:HTR_)?PREMOVE_NISS_/.test(sourceTag)) return [];

  const pipeline = [
    ...normalizeFmcMoveTokens(candidate?.eoMoves),
    ...normalizeFmcMoveTokens(candidate?.drMoves),
    ...normalizeFmcMoveTokens(candidate?.finishMoves),
  ];
  const premoves = normalizeFmcMoveTokens(candidate?.premoves);
  if (pipeline.length === 0 || premoves.length === 0) return [];

  const inversePipeline = invertFmcMoveSequence(pipeline);
  const inversePremoves = invertFmcMoveSequence(premoves);
  const current = String(candidate?.solution || "").trim();
  const seen = new Set(current ? [current] : []);
  const alternatives = [];
  for (const tokens of [
    [...inversePremoves, ...inversePipeline],
    [...inversePipeline, ...inversePremoves],
  ]) {
    const simplified = simplifyFmcMoveSequence(tokens);
    const solution = simplified.join(" ");
    if (!solution || seen.has(solution)) continue;
    seen.add(solution);
    alternatives.push({ solution, moves: simplified, moveCount: simplified.length });
  }
  return alternatives;
}

/**
 * Run the full FMC pipeline (EO→DR→P2, 3 axes, NISS, premove sweep) entirely in WASM.
 * No alternate solver or coverage fallback is permitted.
 * Returns { ok, solution, moveCount, candidates } or null.
 */
export async function solveFmcWasm(scramble, options = {}) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.solveFmcWasm !== "function") return null;
  try {
    const explicitSearchLevel = Number.isFinite(options.searchLevel);
    const normalizedOptions = {
      maxPremoveSets: options.maxPremoveSets ?? 120,
      forceRzp: options.forceRzp ?? false,
      enableMultiInsertion: options.enableMultiInsertion === true,
      enableHtrSkeletons: options.enableHtrSkeletons === true,
      enableSliceInsertion: options.enableSliceInsertion === true,
      enableMultiSwitchNiss: options.enableMultiSwitchNiss === true,
      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      deepComponentMask: Number.isFinite(options.deepComponentMask)
        ? Math.max(0, Math.min(15, Math.floor(options.deepComponentMask)))
        : 15,
      searchLevel: explicitSearchLevel ? Math.max(0, Math.min(3, Math.floor(options.searchLevel))) : 0,
      searchVariant: Number.isFinite(options.searchVariant) ? Math.max(0, Math.floor(options.searchVariant)) : 0,
      incumbentMoveCount: Number.isFinite(options.incumbentMoveCount)
        ? Math.max(1, Math.min(40, Math.floor(options.incumbentMoveCount)))
        : 40,
    };
    const invokeFmc = (requestOptions) => {
      const raw = api.solveFmcWasm(scramble, JSON.stringify(requestOptions));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    };

    let parsed = invokeFmc(normalizedOptions);
    if (!parsed || parsed.ok === undefined) return null;
    let levelEscalationUsed = false;
    let initialReason = null;
    // Unspecified raw callers use a very cheap L0 probe first. If that probe has
    // no frontier, run one bounded L3 portfolio with the same premove budget.
    // Explicit site quality stages retain their requested level unchanged.
    if (parsed.ok !== true && !explicitSearchLevel) {
      initialReason = String(parsed.reason || "FMC_NO_SOLUTION");
      const escalated = invokeFmc({
        ...normalizedOptions,
        maxPremoveSets: Math.max(20, Number(normalizedOptions.maxPremoveSets) || 0),
        searchLevel: 3,
      });
      if (escalated && escalated.ok !== undefined) {
        parsed = escalated;
        levelEscalationUsed = true;
      }
    }
    if (parsed.ok !== true) {
      return {
        ...parsed,
        levelEscalationUsed,
        initialReason,
      };
    }

    // The public FMC verifier is the source of truth for the exact solution
    // string returned to callers. The Rust search uses internal state frames,
    // so final validity and premove-NISS order repair remain at this boundary.
    if (
      typeof api.verifyFmcSolutionWasm !== "function" ||
      !Array.isArray(parsed.candidates)
    ) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_CANDIDATE_VERIFIER_UNAVAILABLE",
        solution: "",
        moveCount: 0,
        candidates: [],
      };
    }

    const verifyCandidateSolution = (solution) => {
      if (!solution) return false;
      try {
        const verifyRaw = api.verifyFmcSolutionWasm(String(scramble), String(solution));
        const verification = typeof verifyRaw === "string" ? JSON.parse(verifyRaw) : verifyRaw;
        return verification?.ok === true && verification.solved === true;
      } catch (_) {
        return false;
      }
    };

    const validCandidates = [];
    const seenSolutions = new Set();
    let invalidCandidateCount = 0;
    let repairedPremoveNissCandidateCount = 0;
    for (const candidate of parsed.candidates) {
      const originalSolution = String(candidate?.solution || "").trim();
      let accepted = null;
      if (verifyCandidateSolution(originalSolution)) {
        accepted = candidate;
      } else {
        invalidCandidateCount += 1;
        for (const alternate of buildVerifiedPremoveNissAlternates(candidate)) {
          if (!verifyCandidateSolution(alternate.solution)) continue;
          accepted = {
            ...candidate,
            solution: alternate.solution,
            moves: alternate.moves,
            moveCount: alternate.moveCount,
            repairedPremoveNissOrder: true,
          };
          repairedPremoveNissCandidateCount += 1;
          break;
        }
      }
      if (!accepted) continue;
      const solution = String(accepted.solution || "").trim();
      if (!solution || seenSolutions.has(solution)) continue;
      seenSolutions.add(solution);
      validCandidates.push(accepted);
    }

    validCandidates.sort((left, right) =>
      Number(left?.moveCount || 0) - Number(right?.moveCount || 0),
    );
    if (validCandidates.length === 0) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_NO_VERIFIED_SOLUTION",
        solution: "",
        moveCount: 0,
        candidates: [],
        invalidCandidateCount,
        repairedPremoveNissCandidateCount,
      };
    }

    const best = validCandidates[0];
    return {
      ...parsed,
      solution: String(best.solution),
      moveCount: Number(best.moveCount || 0),
      candidates: validCandidates,
      invalidCandidateCount,
      repairedPremoveNissCandidateCount,
      levelEscalationUsed,
      initialReason,
    };
  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);
    return null;
  }
}

/**
 * Optimize a solution with insertion-style MITM search entirely in WASM.
 * Returns { ok, solution, moveCount } or null.
 */
export async function optimizeInsertionWasm(scramble, movesStr, options = {}) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.optimizeInsertionWasm !== "function") return null;
  try {
    const optionsJson = JSON.stringify({
      maxPasses: options.maxPasses ?? 3,
      minWindow: options.minWindow ?? 3,
      maxWindow: options.maxWindow ?? 7,
      maxDepth: options.maxDepth ?? 6,
    });
    const raw = api.optimizeInsertionWasm(scramble, movesStr, optionsJson);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && parsed.ok !== undefined ? parsed : null;
  } catch (err) {
    console.warn("[optimizeInsertionWasm] error:", err);
    return null;
  }
}

/**
 * Verify that scramble + solution returns to the solved state (pure WASM, no cubing.js).
 * Returns { ok: true, solved: bool } or null.
 */
export async function verifyFmcSolutionWasm(scramble, solution) {
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (_) {
    return null;
  }
  if (!api || typeof api.verifyFmcSolutionWasm !== "function") return null;
  try {
    const raw = api.verifyFmcSolutionWasm(String(scramble), String(solution));
    if (!raw) return null;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

export async function dropMinmove333Search(searchId) {
  const api = await ensureMinmove333Ready();
  if (!api || typeof api.dropMinmoveSearch !== "function") return false;
  try {
    return api.dropMinmoveSearch(searchId) !== false;
  } catch (_) {
    return false;
  }
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
