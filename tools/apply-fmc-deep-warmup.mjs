import fs from "node:fs";

function replaceOnce(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

// Rust FMC search: use a collision-free compact coordinate key for pre-EO tails
// and expose one explicit deep-table warmup entry point.
const searchPath = "solver-wasm/src/fmc_search.rs";
let search = fs.readFileSync(searchPath, "utf8");
if (!search.includes("FMC_PRE_EO_TAIL_STATE_LIMIT")) {
  search = replaceOnce(
    search,
    "const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;",
    "const FMC_PRE_EO_NISS_FORWARD_NODE_LIMIT: usize = 350_000;\n/// Bound the reverse pre-EO table so malformed or unexpectedly broad frontiers\n/// cannot exhaust browser WASM memory.\nconst FMC_PRE_EO_TAIL_STATE_LIMIT: usize = 1_200_000;",
    "pre-EO state ceiling",
  );
  search = replaceOnce(
    search,
    "pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u128, FmcPreEoTail>>",
    "pre_eo_short_p2_tails: OnceCell<std::collections::HashMap<u64, FmcPreEoTail>>",
    "pre-EO table key type",
  );

  const retainStart = search.indexOf("fn retain_pre_eo_tail(");
  const buildStart = search.indexOf("fn build_pre_eo_short_p2_tails(", retainStart);
  if (retainStart < 0 || buildStart < 0) throw new Error("Missing pre-EO retain/build functions");
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

/// EO is guaranteed solved throughout the pre-EO reverse and forward DR trees.
/// CP (16 bits), CO (12 bits) and the full EP permutation (29 bits) therefore
/// form a collision-free 57-bit coordinate.
fn pre_eo_compact_state_key(state: &CubeState) -> u64 {
    let cp = encode_perm8(&state.cp) as u64;
    let co = encode_co(&state.co) as u64;
    let ep = encode_edge_permutation_12(&state.ep) as u64;
    cp | (co << 16) | (ep << 28)
}

`;
  search = search.slice(0, retainStart) + compactHelpers + search.slice(retainStart);
  search = search.replace(
    "tails: &mut std::collections::HashMap<u128, FmcPreEoTail>,\n    state: &CubeState,",
    "tails: &mut std::collections::HashMap<u64, FmcPreEoTail>,\n    state: &CubeState,",
  );
  search = search.replace(
    "    let key = complementary_compact_state_key(state);\n    match tails.get(&key) {\n        None => {\n            tails.insert(key, candidate);",
    "    let key = pre_eo_compact_state_key(state);\n    match tails.get(&key) {\n        None => {\n            if tails.len() >= FMC_PRE_EO_TAIL_STATE_LIMIT {\n                return false;\n            }\n            tails.insert(key, candidate);",
  );
  search = search.replace(
    "fn build_pre_eo_short_p2_tails(\n    tables: &TwophaseTables,\n) -> std::collections::HashMap<u128, FmcPreEoTail> {",
    "fn build_pre_eo_short_p2_tails(\n    tables: &TwophaseTables,\n) -> std::collections::HashMap<u64, FmcPreEoTail> {",
  );
  search = search.replace(
    "let mut tails = std::collections::HashMap::<u128, FmcPreEoTail>::new();",
    "let mut tails = std::collections::HashMap::<u64, FmcPreEoTail>::new();",
  );
  search = search.replace(
    "tails: &std::collections::HashMap<u128, FmcPreEoTail>,",
    "tails: &std::collections::HashMap<u64, FmcPreEoTail>,",
  );
  search = search.replace(
    "let mut seen = std::collections::HashMap::<(u128, u8), u8>::new();",
    "let mut seen = std::collections::HashMap::<(u64, u8), u8>::new();",
  );
  search = search.replaceAll(
    "complementary_compact_state_key(&node.state)",
    "pre_eo_compact_state_key(&node.state)",
  );
  search = search.replaceAll(
    "complementary_compact_state_key(&next_state)",
    "pre_eo_compact_state_key(&next_state)",
  );
  search = search.replace(
    "(complementary_compact_state_key(start), last_face_before_dr)",
    "(pre_eo_compact_state_key(start), last_face_before_dr)",
  );
  // The second signature occurrence belongs to solve_pre_eo_niss_single_axis.
  search = search.replace(
    "tails: &std::collections::HashMap<u128, FmcPreEoTail>,",
    "tails: &std::collections::HashMap<u64, FmcPreEoTail>,",
  );

  const implMarker = "impl FmcTables {\n    pub fn multi_relocation_plan_count(&self) -> usize {";
  const warmImpl = `impl FmcTables {
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
  search = replaceOnce(search, implMarker, warmImpl, "FMC deep warm method");
  fs.writeFileSync(searchPath, search);
}

// Rust WASM export.
const libPath = "solver-wasm/src/lib.rs";
let lib = fs.readFileSync(libPath, "utf8");
if (!lib.includes("warm_fmc_deep_tables_wasm")) {
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
    let (htr_count, complementary_count, pre_eo_count) = fmc_tables.warm_deep_tables(tables);
    serde_json::json!({
        "ok": true,
        "htrStateCount": htr_count,
        "complementaryTailCount": complementary_count,
        "preEoTailCount": pre_eo_count,
    })
    .to_string()
}

`;
  lib = replaceOnce(lib, marker, exportFn + marker, "deep warm WASM export");
  fs.writeFileSync(libPath, lib);
}

// Browser wrapper.
const wasmPath = "solver/wasmSolver.js";
let wasm = fs.readFileSync(wasmPath, "utf8");
if (!wasm.includes("warmFmcDeepTablesWasm")) {
  const marker = "/**\n * Solve FMC using the WASM pipeline.";
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
  wasm = replaceOnce(wasm, marker, wrapper + marker, "browser deep warm wrapper");
  fs.writeFileSync(wasmPath, wasm);
}

// Worker profile warmup: FMC does not require a selected player profile.
const workerPath = "solver/solverWorker.js";
let worker = fs.readFileSync(workerPath, "utf8");
if (!worker.includes("fmcDeepTablesWarmed")) {
  worker = replaceOnce(
    worker,
    "    const styleProfile = options.styleProfile && typeof options.styleProfile === \"object\"\n      ? options.styleProfile\n      : undefined;\n\n    const [{ getDefaultPattern }",
    "    const styleProfile = options.styleProfile && typeof options.styleProfile === \"object\"\n      ? options.styleProfile\n      : undefined;\n\n    if (mode === \"fmc\") {\n      const { buildFmcTablesWasm, warmFmcDeepTablesWasm } = await getWasmSolverModule();\n      const fmcTablesBuilt = await buildFmcTablesWasm();\n      const quality = String(options.fmcQualityMode || \"sweetSpot\").toLowerCase();\n      const deepResult = quality === \"extreme\" ? await warmFmcDeepTablesWasm() : null;\n      return {\n        ok: fmcTablesBuilt === true,\n        warmed: fmcTablesBuilt === true,\n        mode,\n        fmcQualityMode: quality,\n        fmcDeepTablesWarmed: deepResult?.ok === true,\n        fmcDeepTableMetrics: deepResult || null,\n      };\n    }\n\n    const [{ getDefaultPattern }",
    "worker FMC warm path",
  );
  fs.writeFileSync(workerPath, worker);
}

// Main UI: allow FMC warmup without a player profile and reschedule when quality changes.
const mainPath = "main.js";
let main = fs.readFileSync(mainPath, "utf8");
if (!main.includes("fmcQualityMode: appState.settings.fmcQualityMode")) {
  main = replaceOnce(
    main,
    "  const solverMode = appState.settings.solverMode || \"strict\";\n  if (solverMode === \"minmove\" || solverMode === \"twophase\") return null;\n  const playerName",
    "  const solverMode = appState.settings.solverMode || \"strict\";\n  if (solverMode === \"minmove\" || solverMode === \"twophase\") return null;\n  if (solverMode === \"fmc\") {\n    return {\n      mode: \"fmc\",\n      fmcQualityMode: appState.settings.fmcQualityMode || \"sweetSpot\",\n    };\n  }\n  const playerName",
    "FMC warm payload",
  );
  main = replaceOnce(
    main,
    "  saveState();\n  resetSolverState();\n});",
    "  saveState();\n  resetSolverState();\n  scheduleSelectedPlayerProfileWarmup();\n});",
    "FMC quality warm scheduling",
  );
  fs.writeFileSync(mainPath, main);
}

console.log("Applied compact pre-EO coordinates and FMC deep-table warmup");
