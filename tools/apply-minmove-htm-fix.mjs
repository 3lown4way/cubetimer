import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  let source = read(path);
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`${path}: expected text not found`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
  write(path, source);
}

function replaceBetween(path, startMarker, endMarker, replacement) {
  let source = read(path);
  if (source.includes(replacement)) return;
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${path}: start marker not found`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${path}: end marker not found`);
  source = source.slice(0, start) + replacement + source.slice(end);
  write(path, source);
}

const packedTableBefore = `#[derive(Clone, Debug)]
pub struct PackedTable {
    pub count: usize,
    pub max_distance: u8,
    pub nibble_packed: bool,
    pub payload: Vec<u8>,
}

impl PackedTable {
    pub fn get(&self, index: usize) -> u8 {
        if !self.nibble_packed {
            return self.payload[index];
        }
        let byte = self.payload[index / 2];
        if index % 2 == 0 {
            byte & 0x0f
        } else {
            byte >> 4
        }
    }
}
`;

const packedTableAfter = `#[derive(Clone, Debug)]
pub enum PackedPayload {
    Owned(Vec<u8>),
    Shared {
        bytes: Arc<[u8]>,
        offset: usize,
        len: usize,
    },
}

impl PackedPayload {
    #[inline(always)]
    fn byte(&self, index: usize) -> u8 {
        match self {
            Self::Owned(payload) => payload[index],
            Self::Shared { bytes, offset, len } => {
                debug_assert!(index < *len);
                bytes[*offset + index]
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct PackedTable {
    pub count: usize,
    pub max_distance: u8,
    pub nibble_packed: bool,
    pub payload: PackedPayload,
}

impl PackedTable {
    #[inline(always)]
    pub fn get(&self, index: usize) -> u8 {
        if !self.nibble_packed {
            return self.payload.byte(index);
        }
        let byte = self.payload.byte(index / 2);
        if index % 2 == 0 {
            byte & 0x0f
        } else {
            byte >> 4
        }
    }
}
`;

replaceOnce(
  "solver-wasm/Cargo.toml",
  'rustc-hash = "2"\n',
  'rustc-hash = "2"\nflate2 = { version = "1", default-features = false, features = ["rust_backend"] }\n',
);

replaceOnce(
  "solver-wasm/src/minmove_bundle.rs",
  "};\n\nconst BUNDLE_MAGIC",
  "};\nuse std::sync::Arc;\n\nconst BUNDLE_MAGIC",
);
replaceOnce("solver-wasm/src/minmove_bundle.rs", packedTableBefore, packedTableAfter);
replaceOnce(
  "solver-wasm/src/minmove_bundle.rs",
  "pub fn load_bundle(bytes: &[u8]) -> Result<MinmoveTables, String> {\n    if bytes.len() < BUNDLE_MAGIC.len()",
  `pub fn load_bundle(bytes: &[u8]) -> Result<MinmoveTables, String> {
    load_bundle_owned(bytes.to_vec())
}

pub fn load_bundle_owned(bytes: Vec<u8>) -> Result<MinmoveTables, String> {
    load_bundle_shared(Arc::<[u8]>::from(bytes))
}

fn load_bundle_shared(shared_bytes: Arc<[u8]>) -> Result<MinmoveTables, String> {
    let bytes = shared_bytes.as_ref();
    if bytes.len() < BUNDLE_MAGIC.len()`,
);
replaceOnce(
  "solver-wasm/src/minmove_bundle.rs",
  "payload: bytes[offset..offset + payload_len].to_vec(),",
  `payload: PackedPayload::Shared {
                    bytes: shared_bytes.clone(),
                    offset,
                    len: payload_len,
                },`,
);
{
  const path = "solver-wasm/src/minmove_bundle.rs";
  let source = read(path);
  source = source.replaceAll("payload: vec![0],", "payload: PackedPayload::Owned(vec![0]),");
  write(path, source);
}

replaceOnce(
  "solver-wasm/src/twophase_bundle.rs",
  "use crate::minmove_bundle::{MoveTable, PackedTable};",
  "use crate::minmove_bundle::{MoveTable, PackedPayload, PackedTable};",
);
replaceOnce(
  "solver-wasm/src/twophase_bundle.rs",
  "payload: bytes[offset..offset + payload_len].to_vec(),",
  "payload: PackedPayload::Owned(bytes[offset..offset + payload_len].to_vec()),",
);

replaceOnce(
  "solver-wasm/src/lib.rs",
  "use minmove_bundle::{load_bundle, MinmoveTables};",
  "use minmove_bundle::{load_bundle, load_bundle_owned, MinmoveTables};",
);
replaceOnce(
  "solver-wasm/src/lib.rs",
  "use wasm_bindgen::prelude::*;",
  `use flate2::read::GzDecoder;
use std::io::Read;
use wasm_bindgen::prelude::*;`,
);
replaceOnce(
  "solver-wasm/src/lib.rs",
  `#[derive(Default)]
struct MinmoveSearchStore {`,
  `#[derive(Default)]
struct MinmoveBundleStaging {
    expected_bytes: usize,
    bytes: Vec<u8>,
}

static MINMOVE_BUNDLE_STAGING: Lazy<Mutex<Option<MinmoveBundleStaging>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Default)]
struct MinmoveSearchStore {`,
);

const minmoveLoadReplacement = `fn install_minmove_tables(tables: MinmoveTables) -> Result<(), String> {
    let bidirectional = build_bidirectional_context(&tables)?;
    {
        let mut guard = MINMOVE_TABLES.lock().unwrap();
        *guard = Some(tables);
    }
    {
        let mut guard = MINMOVE_BIDIRECTIONAL_CONTEXT.lock().unwrap();
        *guard = Some(bidirectional);
    }
    MINMOVE_SEARCHES.lock().unwrap().sessions.clear();
    Ok(())
}

#[wasm_bindgen]
pub fn load_minmove_333_bundle(bytes: &[u8]) -> Result<(), JsValue> {
    utils::set_panic_hook();
    *MINMOVE_BUNDLE_STAGING.lock().unwrap() = None;
    let tables = load_bundle(bytes).map_err(|error| JsValue::from_str(&error))?;
    install_minmove_tables(tables).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn begin_minmove_333_bundle(total_bytes: u32) -> Result<(), JsValue> {
    utils::set_panic_hook();
    if total_bytes == 0 {
        return Err(JsValue::from_str("MINMOVE_BUNDLE_SIZE_INVALID"));
    }
    let expected_bytes = total_bytes as usize;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(expected_bytes)
        .map_err(|_| JsValue::from_str("MINMOVE_BUNDLE_ALLOCATION_FAILED"))?;
    *MINMOVE_BUNDLE_STAGING.lock().unwrap() = Some(MinmoveBundleStaging {
        expected_bytes,
        bytes,
    });
    Ok(())
}

#[wasm_bindgen]
pub fn append_minmove_333_bundle_gzip_chunk(bytes: &[u8]) -> Result<u32, JsValue> {
    utils::set_panic_hook();
    let mut guard = MINMOVE_BUNDLE_STAGING.lock().unwrap();
    let staging = guard
        .as_mut()
        .ok_or_else(|| JsValue::from_str("MINMOVE_BUNDLE_STAGING_NOT_STARTED"))?;
    let before = staging.bytes.len();
    let mut decoder = GzDecoder::new(bytes);
    if let Err(error) = decoder.read_to_end(&mut staging.bytes) {
        staging.bytes.truncate(before);
        return Err(JsValue::from_str(&format!(
            "MINMOVE_BUNDLE_CHUNK_DECODE_FAILED:{error}"
        )));
    }
    if staging.bytes.len() > staging.expected_bytes {
        staging.bytes.truncate(before);
        return Err(JsValue::from_str("MINMOVE_BUNDLE_CHUNK_OVERFLOW"));
    }
    Ok(staging.bytes.len() as u32)
}

#[wasm_bindgen]
pub fn finish_minmove_333_bundle(expected_bytes: u32) -> Result<(), JsValue> {
    utils::set_panic_hook();
    let staging = MINMOVE_BUNDLE_STAGING
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| JsValue::from_str("MINMOVE_BUNDLE_STAGING_NOT_STARTED"))?;
    if staging.expected_bytes != expected_bytes as usize || staging.bytes.len() != staging.expected_bytes {
        return Err(JsValue::from_str("MINMOVE_BUNDLE_SIZE_MISMATCH"));
    }
    let tables = load_bundle_owned(staging.bytes).map_err(|error| JsValue::from_str(&error))?;
    install_minmove_tables(tables).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn abort_minmove_333_bundle() {
    *MINMOVE_BUNDLE_STAGING.lock().unwrap() = None;
}

`;
replaceBetween(
  "solver-wasm/src/lib.rs",
  "#[wasm_bindgen]\npub fn load_minmove_333_bundle",
  "#[wasm_bindgen]\npub fn load_twophase_333_bundle",
  minmoveLoadReplacement,
);

replaceOnce(
  "solver/wasmSolver.js",
  "const WASM_MODULE_CANDIDATES = [",
  `import { loadChunkedMinmove333Bundle } from "./minmoveBundleLoader.js";

const WASM_MODULE_CANDIDATES = [`,
);
replaceOnce(
  "solver/wasmSolver.js",
  `const MINMOVE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/minmove/minmove-333-v8.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v7.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v6.bin", import.meta.url).href,
];`,
  `const MINMOVE_333_BUNDLE_CANDIDATES = [
  new URL("../public/solver-wasm/minmove/minmove-333-v8.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v7.bin", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v6.bin", import.meta.url).href,
];
const MINMOVE_333_MANIFEST_CANDIDATES = [
  new URL("../public/solver-wasm/minmove/minmove-333-v8.manifest.json", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v7.manifest.json", import.meta.url).href,
  new URL("../public/solver-wasm/minmove/minmove-333-v6.manifest.json", import.meta.url).href,
];`,
);
replaceOnce(
  "solver/wasmSolver.js",
  `    loadMinmove333Bundle(bytes) {
      if (typeof mod.load_minmove_333_bundle !== "function") return false;
      mod.load_minmove_333_bundle(bytes);
      return true;
    },`,
  `    loadMinmove333Bundle(bytes) {
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
    },`,
);

const ensureMinmoveReplacement = `export async function ensureMinmove333Ready(onProgress = null) {
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

`;
replaceBetween(
  "solver/wasmSolver.js",
  "export async function ensureMinmove333Ready()",
  "export async function ensureTwophase333Ready()",
  ensureMinmoveReplacement,
);

replaceOnce(
  "solver/solverWorker.js",
  `async function ensureMinmove333ReadyLazy() {
  const { ensureMinmove333Ready } = await getWasmSolverModule();
  return ensureMinmove333Ready();
}`,
  `async function ensureMinmove333ReadyLazy(onProgress = null) {
  const { ensureMinmove333Ready } = await getWasmSolverModule();
  return ensureMinmove333Ready(onProgress);
}`,
);
replaceOnce(
  "solver/solverWorker.js",
  `async function solveWithInternal3x3Minmove(scramble, onProgress) {
  const inverseSolution = invertAlgorithmString(scramble);`,
  `async function solveWithInternal3x3Minmove(scramble, onProgress) {
  const inverseSolution = invertAlgorithmString(scramble);`,
);
replaceOnce(
  "solver/solverWorker.js",
  `  if (splitAlgorithmTokens(scramble).length > 0 && !inverseSolution) {
    return { ok: false, reason: "MINMOVE_BAD_SCRAMBLE" };
  }

  let incumbentSolution = inverseSolution;`,
  `  if (splitAlgorithmTokens(scramble).length > 0 && !inverseSolution) {
    return { ok: false, reason: "MINMOVE_BAD_SCRAMBLE" };
  }

  const minmoveReadyPromise = ensureMinmove333ReadyLazy(onProgress);
  let incumbentSolution = inverseSolution;`,
);
replaceOnce(
  "solver/solverWorker.js",
  "  const ready = await ensureMinmove333ReadyLazy();\n  if (!ready) {",
  "  const ready = await minmoveReadyPromise;\n  if (!ready) {",
);

for (const path of ["benchmark/benchmark-enhanced.js", "benchmark/benchmark.js"]) {
  replaceOnce(
    path,
    `  if (progress.type === "bound_update") {`,
    `  if (progress.type === "asset_load_progress") {
    const loaded = Number(progress.loadedBytes);
    const totalBytes = Number(progress.totalBytes);
    const percent = Number.isFinite(loaded) && Number.isFinite(totalBytes) && totalBytes > 0
      ? Math.min(100, Math.max(0, Math.round((loaded / totalBytes) * 100)))
      : null;
    return (name || "minmove HTM tables") + (percent === null ? "" : " " + percent + "%");
  }
  if (progress.type === "bound_update") {`,
  );
}

replaceOnce(
  ".github/workflows/cfop-speedup-benchmark.yml",
  "          node --check solver/wasmSolver.js\n",
  "          node --check solver/wasmSolver.js\n          node --check solver/minmoveBundleLoader.js\n          node --check benchmark-minmove-bundle-loader.mjs\n          node --check benchmark-minmove-htm-smoke.mjs\n",
);
replaceOnce(
  ".github/workflows/cfop-speedup-benchmark.yml",
  "      - name: Verify generated ZBLL index\n",
  "      - name: Verify chunked minmove loader\n        run: node benchmark-minmove-bundle-loader.mjs\n\n      - name: Verify generated ZBLL index\n",
);

for (const path of ["solver-wasm/README.md", "public/solver-wasm/README.md"]) {
  let source = read(path);
  source = source.replace(
    /The minmove bundle step writes `public\/solver-wasm\/minmove\/minmove-333-v\d+\.bin`\./,
    "The minmove bundle step writes the current raw bundle, which the deployment workflow splits into lazily loaded gzip chunks plus a versioned manifest.",
  );
  source = source.replace(
    /For `minmove`, fetch `public\/solver-wasm\/minmove\/minmove-333-v\d+\.bin`, pass it to `load_minmove_333_bundle\(\.\.\.\)`, then call/,
    "For `minmove`, load the versioned manifest and append each gzip chunk through the incremental bundle API, then call",
  );
  write(path, source);
}

console.log("Applied minmove HTM deployment fix.");
