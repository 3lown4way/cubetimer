import fs from "node:fs";

function replaceOnce(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

function replaceFirst(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing ${label}`);
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

function writeIfChanged(path, before, after) {
  if (before !== after) fs.writeFileSync(path, after);
}

const searchPath = "solver-wasm/src/fmc_search.rs";
const searchBefore = fs.readFileSync(searchPath, "utf8");
let search = searchBefore;

if (!search.includes("FMC_DEEP_COMPONENT_ALL")) {
  search = replaceOnce(
    search,
    "const FMC_HTR_STATE_LIMIT: usize = 1_000_000;",
    `const FMC_HTR_STATE_LIMIT: usize = 1_000_000;

/// Diagnostic selection mask for the four expensive Deep-Extreme subpaths.
/// Production callers use ALL, preserving the existing search portfolio.
const FMC_DEEP_COMPONENT_STAGE_BOUNDARY: u8 = 1 << 0;
const FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM: u8 = 1 << 1;
const FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL: u8 = 1 << 2;
const FMC_DEEP_COMPONENT_PRE_EO: u8 = 1 << 3;
pub const FMC_DEEP_COMPONENT_ALL: u8 = FMC_DEEP_COMPONENT_STAGE_BOUNDARY
    | FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM
    | FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL
    | FMC_DEEP_COMPONENT_PRE_EO;`,
    "deep component constants",
  );

  search = replaceOnce(
    search,
    `    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    search_level: u8,`,
    `    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    deep_component_mask: u8,
    search_level: u8,`,
    "inner solver signature",
  );

  search = replaceOnce(
    search,
    `    let search_level = search_level.min(3) as usize;
    let direct_eo_limit`,
    `    let search_level = search_level.min(3) as usize;
    let deep_component_mask = deep_component_mask & FMC_DEEP_COMPONENT_ALL;
    let deep_stage_boundary_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_STAGE_BOUNDARY != 0;
    let deep_complementary_mitm_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_COMPLEMENTARY_MITM != 0;
    let deep_complementary_normal_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_COMPLEMENTARY_NORMAL != 0;
    let deep_pre_eo_enabled = enable_deep_multi_switch_niss
        && deep_component_mask & FMC_DEEP_COMPONENT_PRE_EO != 0;
    let direct_eo_limit`,
    "deep component booleans",
  );

  const bodyStart = search.indexOf("fn solve_fmc_with_eo_depth(");
  const bodyEnd = search.indexOf("fn fmc_result_best_move_count", bodyStart);
  if (bodyStart < 0 || bodyEnd < 0) throw new Error("Missing FMC inner solver body");
  let body = search.slice(bodyStart, bodyEnd);

  body = replaceOnce(
    body,
    "if enable_multi_switch_niss || enable_deep_multi_switch_niss {",
    "if enable_multi_switch_niss || deep_stage_boundary_enabled {",
    "stage-boundary condition",
  );
  const deepArg = `                enable_deep_multi_switch_niss,
            );`;
  const stageArg = `                deep_stage_boundary_enabled,
            );`;
  body = replaceFirst(body, deepArg, stageArg, "direct stage-boundary argument");
  body = replaceFirst(body, deepArg, stageArg, "inverse stage-boundary argument");

  const deepCondition = `if enable_deep_multi_switch_niss
        && search_level >= 3`;
  body = replaceFirst(
    body,
    deepCondition,
    `if deep_complementary_mitm_enabled
        && search_level >= 3`,
    "complementary MITM condition",
  );
  body = replaceFirst(
    body,
    deepCondition,
    `if deep_complementary_normal_enabled
        && search_level >= 3`,
    "complementary normal condition",
  );
  body = replaceFirst(
    body,
    deepCondition,
    `if deep_pre_eo_enabled
        && search_level >= 3`,
    "pre-EO condition",
  );
  if (body.includes(deepCondition)) {
    throw new Error("Unexpected extra deep component condition");
  }
  search = search.slice(0, bodyStart) + body + search.slice(bodyEnd);

  search = replaceOnce(
    search,
    `    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
) -> FmcResult {
    let requested_eo_depth`,
    `    enable_multi_switch_niss: bool,
    enable_deep_multi_switch_niss: bool,
    deep_component_mask: u8,
    search_level: u8,
    search_variant: u32,
    incumbent_move_count: usize,
) -> FmcResult {
    let requested_eo_depth`,
    "public solver signature",
  );

  const callNeedle = `        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        search_level,`;
  const callReplacement = `        enable_multi_switch_niss,
        enable_deep_multi_switch_niss,
        deep_component_mask,
        search_level,`;
  let callCount = 0;
  while (search.includes(callNeedle)) {
    search = replaceFirst(search, callNeedle, callReplacement, `inner solver call ${callCount + 1}`);
    callCount += 1;
  }
  if (callCount !== 3) throw new Error(`Expected 3 inner solver calls, found ${callCount}`);
}
writeIfChanged(searchPath, searchBefore, search);

const libPath = "solver-wasm/src/lib.rs";
const libBefore = fs.readFileSync(libPath, "utf8");
let lib = libBefore;
if (!lib.includes("deep_component_mask")) {
  lib = replaceOnce(
    lib,
    `use fmc_search::{build_fmc_tables, candidate_to_json, skeleton_to_json, solve_fmc, FmcTables};`,
    `use fmc_search::{
    build_fmc_tables, candidate_to_json, skeleton_to_json, solve_fmc, FmcTables,
    FMC_DEEP_COMPONENT_ALL,
};`,
    "FMC deep mask import",
  );
  lib = replaceOnce(
    lib,
    `    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
    #[serde(rename = "searchLevel", default)]`,
    `    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
    #[serde(rename = "deepComponentMask", default = "default_fmc_deep_component_mask")]
    deep_component_mask: u8,
    #[serde(rename = "searchLevel", default)]`,
    "FMC options deep mask",
  );
  lib = replaceOnce(
    lib,
    `fn default_fmc_incumbent_move_count() -> usize {
    40
}`,
    `fn default_fmc_deep_component_mask() -> u8 {
    FMC_DEEP_COMPONENT_ALL
}
fn default_fmc_incumbent_move_count() -> usize {
    40
}`,
    "FMC deep mask default",
  );
  lib = replaceOnce(
    lib,
    `        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.search_level,`,
    `        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.deep_component_mask,
        options.search_level,`,
    "FMC solve deep mask argument",
  );
}
writeIfChanged(libPath, libBefore, lib);

const wasmPath = "solver/wasmSolver.js";
const wasmBefore = fs.readFileSync(wasmPath, "utf8");
let wasm = wasmBefore;
if (!wasm.includes("deepComponentMask:")) {
  wasm = replaceOnce(
    wasm,
    `      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      searchLevel:`,
    `      enableDeepMultiSwitchNiss: options.enableDeepMultiSwitchNiss === true,
      deepComponentMask: Number.isFinite(options.deepComponentMask)
        ? Math.max(0, Math.min(15, Math.floor(options.deepComponentMask)))
        : 15,
      searchLevel:`,
    "browser deep component mask",
  );
}
writeIfChanged(wasmPath, wasmBefore, wasm);

console.log("Applied FMC deep component mask diagnostics");
