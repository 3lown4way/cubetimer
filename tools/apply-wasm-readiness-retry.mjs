import fs from "node:fs";

function replaceUnique(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

const loaderPath = "solver/wasmSolver.js";
const loaderBefore = fs.readFileSync(loaderPath, "utf8");
let loader = loaderBefore;

loader = replaceUnique(
  loader,
  `const WASM_MODULE_CANDIDATES = [
  new URL("../public/solver-wasm/solver_wasm.js", import.meta.url).href,
  new URL("../solver-wasm/pkg/solver_wasm.js", import.meta.url).href,
];`,
  `const WASM_MODULE_CANDIDATES = [
  new URL("../public/solver-wasm/solver_wasm.js", import.meta.url).href,
  // Some static hosts publish the public directory as the site root.
  new URL("../solver-wasm/solver_wasm.js", import.meta.url).href,
  new URL("../solver-wasm/pkg/solver_wasm.js", import.meta.url).href,
];`,
  "WASM module candidates",
);

loader = replaceUnique(
  loader,
  `const TWOPHASE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/twophase/twophase-333-v2.bin", import.meta.url).href,
  new URL("../public/solver-wasm/twophase/twophase-333-v1.bin", import.meta.url).href,
];`,
  `const TWOPHASE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/twophase/twophase-333-v2.bin", import.meta.url).href,
  new URL("../solver-wasm/twophase/twophase-333-v2.bin", import.meta.url).href,
  new URL("../public/solver-wasm/twophase/twophase-333-v1.bin", import.meta.url).href,
  new URL("../solver-wasm/twophase/twophase-333-v1.bin", import.meta.url).href,
];`,
  "two-phase bundle candidates",
);

loader = replaceUnique(
  loader,
  `let wasmApiPromise = null;
let wasmApi = null;
let minmove333ReadyPromise = null;
let twophase333ReadyPromise = null;`,
  `let wasmApiPromise = null;
let wasmApi = null;
let minmove333ReadyPromise = null;
let twophase333ReadyPromise = null;
let twophase333Ready = false;
let wasmLastFailure = null;

function recordWasmFailure(stage, target, error) {
  const message = String(error?.message || error || "UNKNOWN_WASM_ERROR");
  wasmLastFailure = {
    stage: String(stage || "unknown"),
    target: target ? String(target) : null,
    message,
    timestamp: Date.now(),
  };
  console.warn(
    `[WASM] ${wasmLastFailure.stage} failed${wasmLastFailure.target ? `: ${wasmLastFailure.target}` : ""}: ${message}`,
  );
}

export function getWasmSolverReadinessStatus() {
  return {
    wasmModuleReady: wasmApi !== null,
    wasmModuleLoading: wasmApi === null && wasmApiPromise !== null,
    twophaseReady: twophase333Ready,
    twophaseLoading: !twophase333Ready && twophase333ReadyPromise !== null,
    fmcTablesBuilt: typeof fmcTablesBuilt === "boolean" ? fmcTablesBuilt : false,
    lastFailure: wasmLastFailure ? { ...wasmLastFailure } : null,
  };
}`,
  "WASM readiness state",
);

const candidateStart = loader.indexOf("async function loadWasmCandidate(specifier) {");
const candidateEnd = loader.indexOf("async function loadBinaryCandidate(url) {", candidateStart);
if (candidateStart < 0 || candidateEnd < 0) throw new Error("Missing WASM candidate loader");
let candidateBlock = loader.slice(candidateStart, candidateEnd);
candidateBlock = candidateBlock.replace(
  `  } catch (_) {
    return null;
  }
  if (!mod) return null;`,
  `  } catch (error) {
    recordWasmFailure("module-import", specifier, error);
    return null;
  }
  if (!mod) {
    recordWasmFailure("module-import", specifier, new Error("EMPTY_WASM_MODULE"));
    return null;
  }`,
);
candidateBlock = candidateBlock.replace(
  `    } catch (_) {
      return null;
    }
  } else {`,
  `    } catch (error) {
      recordWasmFailure("module-init-sync", specifier, error);
      return null;
    }
  } else {`,
);
candidateBlock = candidateBlock.replace(
  `      } catch (_) {
        return null;
      }
    }
  }
  if (typeof mod.solve_json !== "function") return null;`,
  `      } catch (error) {
        recordWasmFailure("module-init", specifier, error);
        return null;
      }
    }
  }
  if (typeof mod.solve_json !== "function") {
    recordWasmFailure("module-api", specifier, new Error("SOLVE_JSON_EXPORT_MISSING"));
    return null;
  }`,
);
loader = loader.slice(0, candidateStart) + candidateBlock + loader.slice(candidateEnd);

const binaryStart = loader.indexOf("async function loadBinaryCandidate(url) {");
const binaryEnd = loader.indexOf("async function loadMinmove333BundleBytes() {", binaryStart);
if (binaryStart < 0 || binaryEnd < 0) throw new Error("Missing binary candidate loader");
const binaryBlock = `async function loadBinaryCandidate(url) {
  if (url.startsWith("file://")) {
    try {
      const { fileURLToPath } = await import("url");
      const fs = await import("fs");
      const filePath = fileURLToPath(url);
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      if (bytes.byteLength > 0) return bytes;
      recordWasmFailure("binary-read", url, new Error("EMPTY_BINARY"));
      return null;
    } catch (error) {
      recordWasmFailure("binary-read", url, error);
      return null;
    }
  }

  for (const cacheMode of ["force-cache", "reload"]) {
    let response;
    try {
      response = await fetch(url, { cache: cacheMode });
    } catch (error) {
      recordWasmFailure("binary-fetch", url, error);
      continue;
    }
    if (!response.ok) {
      recordWasmFailure("binary-fetch", url, new Error(`HTTP_${response.status}`));
      continue;
    }
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 0) return bytes;
      recordWasmFailure("binary-fetch", url, new Error("EMPTY_BINARY"));
    } catch (error) {
      recordWasmFailure("binary-decode", url, error);
    }
  }
  return null;
}

`;
loader = loader.slice(0, binaryStart) + binaryBlock + loader.slice(binaryEnd);

const wasmReadyStart = loader.indexOf("export async function ensureWasmSolverReady() {");
const wasmReadyEnd = loader.indexOf("export async function ensureMinmove333Ready", wasmReadyStart);
if (wasmReadyStart < 0 || wasmReadyEnd < 0) throw new Error("Missing WASM readiness function");
const wasmReadyBlock = `export async function ensureWasmSolverReady() {
  if (wasmApi) return wasmApi;
  if (wasmApiPromise) return wasmApiPromise;

  const readyPromise = (async () => {
    for (let i = 0; i < WASM_MODULE_CANDIDATES.length; i += 1) {
      const api = await loadWasmCandidate(WASM_MODULE_CANDIDATES[i]);
      if (!api) continue;
      wasmApi = api;
      wasmLastFailure = null;
      return wasmApi;
    }
    return null;
  })();

  wasmApiPromise = readyPromise;
  const ready = await readyPromise;
  if (!ready && wasmApiPromise === readyPromise) {
    // A transient import/deployment failure must not poison the page forever.
    wasmApiPromise = null;
  }
  return ready;
}

`;
loader = loader.slice(0, wasmReadyStart) + wasmReadyBlock + loader.slice(wasmReadyEnd);

const twophaseStart = loader.indexOf("export async function ensureTwophase333Ready() {");
const twophaseEnd = loader.indexOf("export async function prepareMinmove333", twophaseStart);
if (twophaseStart < 0 || twophaseEnd < 0) throw new Error("Missing two-phase readiness function");
const twophaseBlock = `export async function ensureTwophase333Ready() {
  const api = await ensureWasmSolverReady();
  if (!api) return null;
  if (twophase333Ready) return api;
  if (twophase333ReadyPromise) return twophase333ReadyPromise;

  const readyPromise = (async () => {
    if (typeof api.loadTwophase333Bundle !== "function") {
      recordWasmFailure("twophase-api", null, new Error("LOAD_TWOPHASE_EXPORT_MISSING"));
      return null;
    }
    const bytes = await loadTwophase333BundleBytes();
    if (!bytes) {
      recordWasmFailure("twophase-bundle", null, new Error("TWOPHASE_BUNDLE_UNAVAILABLE"));
      return null;
    }
    try {
      const loaded = api.loadTwophase333Bundle(bytes);
      if (!loaded) {
        recordWasmFailure("twophase-load", null, new Error("TWOPHASE_BUNDLE_REJECTED"));
        return null;
      }
      if (typeof api.warmTwophase333 === "function") {
        api.warmTwophase333();
      }
      twophase333Ready = true;
      wasmLastFailure = null;
      return api;
    } catch (error) {
      recordWasmFailure("twophase-load", null, error);
      return null;
    }
  })();

  twophase333ReadyPromise = readyPromise;
  const ready = await readyPromise;
  if (!ready && twophase333ReadyPromise === readyPromise) {
    // Permit the next solve/warm request to retry after a transient asset failure.
    twophase333ReadyPromise = null;
  }
  return ready;
}

`;
loader = loader.slice(0, twophaseStart) + twophaseBlock + loader.slice(twophaseEnd);

const fmcBuildStart = loader.indexOf("let fmcTablesBuilt = false;");
const fmcBuildEnd = loader.indexOf("/**\n * Run the full FMC pipeline", fmcBuildStart);
if (fmcBuildStart < 0 || fmcBuildEnd < 0) throw new Error("Missing FMC table builder");
const fmcBuildBlock = `let fmcTablesBuilt = false;
export async function buildFmcTablesWasm() {
  if (fmcTablesBuilt) return true;
  let api;
  try {
    api = await ensureTwophase333Ready();
  } catch (error) {
    recordWasmFailure("fmc-readiness", null, error);
    return false;
  }
  if (!api || typeof api.buildFmcTablesWasm !== "function") {
    recordWasmFailure("fmc-api", null, new Error("BUILD_FMC_TABLES_EXPORT_MISSING"));
    return false;
  }
  try {
    const raw = api.buildFmcTablesWasm();
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    fmcTablesBuilt = !!(parsed && parsed.ok);
    if (!fmcTablesBuilt) {
      recordWasmFailure("fmc-table-build", null, new Error(parsed?.reason || "FMC_TABLE_BUILD_REJECTED"));
    } else {
      wasmLastFailure = null;
    }
    return fmcTablesBuilt;
  } catch (error) {
    recordWasmFailure("fmc-table-build", null, error);
    return false;
  }
}

`;
loader = loader.slice(0, fmcBuildStart) + fmcBuildBlock + loader.slice(fmcBuildEnd);

if (!loader.includes('for (const cacheMode of ["force-cache", "reload"])')) {
  throw new Error("Binary reload retry was not applied");
}
if (!loader.includes("twophase333ReadyPromise = null;")) {
  throw new Error("Two-phase failed promise reset was not applied");
}
if (!loader.includes("export function getWasmSolverReadinessStatus()")) {
  throw new Error("WASM readiness diagnostics were not applied");
}
fs.writeFileSync(loaderPath, loader);

const fmcPath = "solver/fmcSolver.js";
const fmcBefore = fs.readFileSync(fmcPath, "utf8");
let fmc = fmcBefore;
fmc = replaceUnique(
  fmc,
  `  buildFmcTablesWasm,
  solveFmcWasm,`,
  `  buildFmcTablesWasm,
  getWasmSolverReadinessStatus,
  solveFmcWasm,`,
  "FMC readiness status import",
);
fmc = replaceUnique(
  fmc,
  `      reason: "FMC_WASM_NOT_READY",
      attempts,
      performanceDiagnostics: finalizeDiagnostics(),`,
  `      reason: "FMC_WASM_NOT_READY",
      attempts,
      wasmReadiness: getWasmSolverReadinessStatus(),
      performanceDiagnostics: finalizeDiagnostics(),`,
  "FMC not-ready diagnostic",
);
fs.writeFileSync(fmcPath, fmc);

const workflowPath = ".github/workflows/cfop-speedup-benchmark.yml";
const workflowBefore = fs.readFileSync(workflowPath, "utf8");
let workflow = workflowBefore;
workflow = replaceUnique(
  workflow,
  `          node --check benchmark-fmc-premove-niss-root.mjs`,
  `          node --check benchmark-fmc-premove-niss-root.mjs
          node --check benchmark-wasm-readiness-contract.mjs`,
  "WASM readiness contract syntax check",
);
workflow = replaceUnique(
  workflow,
  `      - name: Verify generated ZBLL index
        run: node tools/generate-zbll-case-index.mjs --check`,
  `      - name: Verify WASM readiness retry contract
        run: node benchmark-wasm-readiness-contract.mjs

      - name: Verify generated ZBLL index
        run: node tools/generate-zbll-case-index.mjs --check`,
  "WASM readiness contract step",
);
fs.writeFileSync(workflowPath, workflow);

console.log("Applied retryable WASM readiness loading and diagnostics");
