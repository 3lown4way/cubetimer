import fs from "node:fs";

function replaceUnique(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

function writeIfChanged(path, before, after) {
  if (before !== after) fs.writeFileSync(path, after);
}

// 1. Compact and bound the deep pre-EO reverse table.
const searchPath = "solver-wasm/src/fmc_search.rs";
const searchBefore = fs.readFileSync(searchPath, "utf8");
let search = searchBefore;

if (!search.includes("FMC_PRE_EO_TAIL_STATE_LIMIT")) {
  search = replaceUnique(
    search,
    "const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;",
    "const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;\n/// Bound the reverse pre-EO table so an unexpectedly broad frontier cannot\n/// exhaust browser WASM memory.\nconst FMC_PRE_EO_TAIL_STATE_LIMIT: usize = 1_200_000;",
    "pre-EO state ceiling",
  );

  search = replaceUnique(
    search,
    "pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcPreEoTail>>",
    "pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u64, FmcPreEoTail>>",
    "pre-EO table field type",
  );

  const preEoStart = search.indexOf("fn retain_pre_eo_tail(");
  const preEoEnd = search.indexOf("fn solve_complementary_short_p2_mitm(", preEoStart);
  if (preEoStart < 0 || preEoEnd < 0) {
    throw new Error("Missing bounded pre-EO section");
  }

  const compactHelpers = `fn encode_edge_permutation_12(ep: &[u8; EDGE_COUNT]) -> u32 {
    let mut rank = 0u32;
    for i in 0..EDGE_COUNT {
        let mut smaller = 0u32;
        for j in (i + 1)..EDGE_COUNT {
            if ep[j] < ep[i] {
                smaller += 1;
            }
        }
        rank = rank * (EDGE_COUNT - i) as u32 + smaller;
    }
    rank
}

/// EO remains solved throughout the reverse P2/DR table and the matching
/// forward DR search. CP (16 bits), CO (12 bits), and full EP (29 bits)
/// therefore form a collision-free 57-bit coordinate.
fn pre_eo_compact_state_key(state: &CubeState) -> u64 {
    let cp = encode_perm8(&state.cp) as u64;
    let co = encode_co(&state.co) as u64;
    let ep = encode_edge_permutation_12(&state.ep) as u64;
    cp | (co << 16) | (ep << 28)
}

`;

  let preEo = search.slice(preEoStart, preEoEnd);
  preEo = compactHelpers + preEo;
  preEo = preEo.replaceAll(
    "std::collections::HashMap<u128, FmcPreEoTail>",
    "std::collections::HashMap<u64, FmcPreEoTail>",
  );
  preEo = preEo.replace(
    "let mut tails = std::collections::HashMap::<u128, FmcPreEoTail>::new();",
    "let mut tails = std::collections::HashMap::<u64, FmcPreEoTail>::new();",
  );
  preEo = preEo.replace(
    "let mut seen = std::collections::HashMap::<(u128, u8), u8>::new();",
    "let mut seen = std::collections::HashMap::<(u64, u8), u8>::new();",
  );
  preEo = preEo.replace(
    "    let key = complementary_compact_state_key(state);\n    match tails.get(&key) {\n        None => {\n            tails.insert(key, candidate);",
    "    let key = pre_eo_compact_state_key(state);\n    match tails.get(&key) {\n        None => {\n            if tails.len() >= FMC_PRE_EO_TAIL_STATE_LIMIT {\n                return false;\n            }\n            tails.insert(key, candidate);",
  );
  preEo = preEo.replaceAll(
    "complementary_compact_state_key(&node.state)",
    "pre_eo_compact_state_key(&node.state)",
  );
  preEo = preEo.replaceAll(
    "complementary_compact_state_key(&next_state)",
    "pre_eo_compact_state_key(&next_state)",
  );
  preEo = preEo.replace(
    "(complementary_compact_state_key(start), last_face_before_dr)",
    "(pre_eo_compact_state_key(start), last_face_before_dr)",
  );

  if (preEo.includes("HashMap<u128, FmcPreEoTail>")) {
    throw new Error("Unconverted pre-EO u128 table type");
  }
  if (!preEo.includes("FMC_PRE_EO_TAIL_STATE_LIMIT")) {
    throw new Error("Missing pre-EO table bound");
  }
  search = search.slice(0, preEoStart) + preEo + search.slice(preEoEnd);
}

if (!search.includes("pub fn warm_deep_tables")) {
  const marker = "impl FmcTables {\n    pub fn multi_relocation_plan_count(&self) -> usize {";
  const replacement = `impl FmcTables {
    pub fn warm_deep_tables(&self, tables: &TwophaseTables) -> (usize, usize, usize) {
        let htr = self
            .htr_first_move
            .get_or_init(|| build_htr_first_move_table(tables));
        let complementary = self
            .complementary_short_p2_tails
            .get_or_init(|| build_complementary_short_p2_tails(tables));
        let pre_eo = self
            .pre_eo_short_p2_tails
            .get_or_init(|| build_pre_eo_short_p2_tails(tables));
        (htr.len(), complementary.len(), pre_eo.len())
    }

    pub fn multi_relocation_plan_count(&self) -> usize {`;
  search = replaceUnique(search, marker, replacement, "FMC deep-table warm method");
}
writeIfChanged(searchPath, searchBefore, search);

// 2. Export explicit table warmup from WASM.
const libPath = "solver-wasm/src/lib.rs";
const libBefore = fs.readFileSync(libPath, "utf8");
let lib = libBefore;
if (!lib.includes("pub fn warm_fmc_deep_tables_wasm")) {
  const marker = "#[derive(Deserialize)]\nstruct FmcOptionsJson";
  const exportFn = `#[wasm_bindgen]
pub fn warm_fmc_deep_tables_wasm() -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    let fmc_guard = FMC_TABLES.lock().unwrap();
    let Some(fmc_tables) = fmc_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "FMC_TABLES_NOT_BUILT"})
            .to_string();
    };
    let (htr_count, complementary_count, pre_eo_count) =
        fmc_tables.warm_deep_tables(tables);
    serde_json::json!({
        "ok": true,
        "htrStateCount": htr_count,
        "complementaryTailCount": complementary_count,
        "preEoTailCount": pre_eo_count,
    })
    .to_string()
}

`;
  lib = replaceUnique(lib, marker, exportFn + marker, "deep warm WASM export");
}
writeIfChanged(libPath, libBefore, lib);

// 3. Wire the generated export through the browser adapter.
const wasmPath = "solver/wasmSolver.js";
const wasmBefore = fs.readFileSync(wasmPath, "utf8");
let wasm = wasmBefore;
if (!wasm.includes("    warmFmcDeepTablesWasm() {")) {
  const oldText = `    buildFmcTablesWasm() {
      if (typeof mod.build_fmc_tables_wasm !== "function") return "";
      return mod.build_fmc_tables_wasm();
    },
    solveFmcWasm(scramble, optionsJson) {`;
  const newText = `    buildFmcTablesWasm() {
      if (typeof mod.build_fmc_tables_wasm !== "function") return "";
      return mod.build_fmc_tables_wasm();
    },
    warmFmcDeepTablesWasm() {
      if (typeof mod.warm_fmc_deep_tables_wasm !== "function") return "";
      return mod.warm_fmc_deep_tables_wasm();
    },
    solveFmcWasm(scramble, optionsJson) {`;
  wasm = replaceUnique(wasm, oldText, newText, "browser deep warm API adapter");
}

if (!wasm.includes("export async function warmFmcDeepTablesWasm")) {
  const marker = "/**\n * Run the full FMC pipeline";
  const wrapper = `let fmcDeepTablesWarmPromise = null;
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

`;
  wasm = replaceUnique(wasm, marker, wrapper + marker, "browser deep warm wrapper");
}
writeIfChanged(wasmPath, wasmBefore, wasm);

// 4. Let the worker warm FMC without requiring a player profile.
const workerPath = "solver/solverWorker.js";
const workerBefore = fs.readFileSync(workerPath, "utf8");
let worker = workerBefore;
if (!worker.includes("fmcDeepTablesWarmed")) {
  const oldText = `    const styleProfile = options.styleProfile && typeof options.styleProfile === "object"
      ? options.styleProfile
      : undefined;

    const [{ getDefaultPattern }`;
  const newText = `    const styleProfile = options.styleProfile && typeof options.styleProfile === "object"
      ? options.styleProfile
      : undefined;

    if (mode === "fmc") {
      const { buildFmcTablesWasm, warmFmcDeepTablesWasm } = await getWasmSolverModule();
      const fmcTablesBuilt = await buildFmcTablesWasm();
      const quality = String(options.fmcQualityMode || "sweetSpot").toLowerCase();
      const deepResult = quality === "extreme" ? await warmFmcDeepTablesWasm() : null;
      return {
        ok: fmcTablesBuilt === true,
        warmed: fmcTablesBuilt === true,
        mode,
        fmcQualityMode: quality,
        fmcDeepTablesWarmed: deepResult?.ok === true,
        fmcDeepTableMetrics: deepResult || null,
      };
    }

    const [{ getDefaultPattern }`;
  worker = replaceUnique(worker, oldText, newText, "worker FMC warm path");
}
writeIfChanged(workerPath, workerBefore, worker);

// 5. Trigger that warm path when FMC or its quality preset is selected.
const mainPath = "main.js";
const mainBefore = fs.readFileSync(mainPath, "utf8");
let main = mainBefore;
if (!main.includes("fmcQualityMode: appState.settings.fmcQualityMode")) {
  const oldText = `  const solverMode = appState.settings.solverMode || "strict";
  if (solverMode === "minmove" || solverMode === "twophase") return null;
  const playerName`;
  const newText = `  const solverMode = appState.settings.solverMode || "strict";
  if (solverMode === "minmove" || solverMode === "twophase") return null;
  if (solverMode === "fmc") {
    return {
      mode: "fmc",
      fmcQualityMode: appState.settings.fmcQualityMode || "sweetSpot",
    };
  }
  const playerName`;
  main = replaceUnique(main, oldText, newText, "FMC warm payload");
}

function ensureListenerWarmup(source, listenerStart, label) {
  const start = source.indexOf(listenerStart);
  if (start < 0) throw new Error(`Missing ${label}`);
  const end = source.indexOf("\n});", start);
  if (end < 0) throw new Error(`Missing ${label} end`);
  const block = source.slice(start, end);
  if (block.includes("scheduleSelectedPlayerProfileWarmup();")) return source;
  return source.slice(0, end) + "\n  scheduleSelectedPlayerProfileWarmup();" + source.slice(end);
}

main = ensureListenerWarmup(
  main,
  'solverModeSelect?.addEventListener("change", () => {',
  "solver mode warm listener",
);
main = ensureListenerWarmup(
  main,
  'fmcQualitySelect?.addEventListener("change", () => {',
  "FMC quality warm listener",
);
writeIfChanged(mainPath, mainBefore, main);

console.log("Applied bounded compact FMC deep-table warmup v2");
