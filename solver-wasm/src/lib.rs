pub mod fmc_insertion;
pub mod fmc_search;
mod ida;
pub mod minmove_builder;
pub mod minmove_bundle;
pub mod minmove_core;
pub mod minmove_search;
mod parser;
mod permutation;
mod state;
mod tables;
pub mod twophase_builder;
pub mod twophase_bundle;
pub mod twophase_search;
mod utils;

use flate2::read::GzDecoder;
use fmc_insertion::optimize_insertion_wasm_impl;
use fmc_search::{build_fmc_tables, candidate_to_json, skeleton_to_json, solve_fmc, FmcTables};
use ida::{build_prune_tables, ida_solve};
use minmove_bundle::{load_bundle, load_bundle_owned, MinmoveTables};
use minmove_search::{
    build_bidirectional_context, search_to_string, MinmoveBidirectionalContext, SearchSession,
};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use std::sync::Mutex;
use twophase_bundle::{load_bundle as load_twophase_bundle, TwophaseTables};
use twophase_search::{
    search_twophase_exact_bound, solve_phase2, Phase2Input, TwophaseExactOptions,
    TwophasePrepareOptions, TwophaseSearchOptions, TwophaseSession,
};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct SolveRequest {
    pub scramble: String,
    pub event_id: String,
}

#[derive(Serialize, Deserialize)]
pub struct SolveResponse {
    pub ok: bool,
    pub solution: String,
    pub move_count: u32,
    pub reason: Option<String>,
}

static mut PRUNE: Option<ida::PruneTables> = None;
static MINMOVE_TABLES: Lazy<Mutex<Option<MinmoveTables>>> = Lazy::new(|| Mutex::new(None));
static MINMOVE_BIDIRECTIONAL_CONTEXT: Lazy<Mutex<Option<Arc<MinmoveBidirectionalContext>>>> =
    Lazy::new(|| Mutex::new(None));
static MINMOVE_SEARCHES: Lazy<Mutex<MinmoveSearchStore>> =
    Lazy::new(|| Mutex::new(MinmoveSearchStore::default()));
static TWOPHASE_TABLES: Lazy<Mutex<Option<TwophaseTables>>> = Lazy::new(|| Mutex::new(None));
static TWOPHASE_SEARCHES: Lazy<Mutex<TwophaseSearchStore>> =
    Lazy::new(|| Mutex::new(TwophaseSearchStore::default()));
static FMC_TABLES: Lazy<Mutex<Option<FmcTables>>> = Lazy::new(|| Mutex::new(None));

#[derive(Default)]
struct MinmoveBundleStaging {
    expected_bytes: usize,
    bytes: Vec<u8>,
}

static MINMOVE_BUNDLE_STAGING: Lazy<Mutex<Option<MinmoveBundleStaging>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Default)]
struct MinmoveSearchStore {
    next_id: u32,
    sessions: HashMap<u32, SearchSession>,
}

#[derive(Default)]
struct TwophaseSearchStore {
    next_id: u32,
    sessions: HashMap<u32, TwophaseSession>,
}

#[derive(Serialize)]
struct MinmovePrepareResponse {
    ok: bool,
    #[serde(rename = "searchId")]
    search_id: Option<u32>,
    #[serde(rename = "lowerBound")]
    lower_bound: Option<u8>,
    #[serde(rename = "reverseDepth")]
    reverse_depth: Option<u8>,
    #[serde(rename = "reverseStates")]
    reverse_states: Option<u32>,
    reason: Option<String>,
}

#[derive(Serialize)]
struct MinmoveSearchResponse {
    ok: bool,
    status: String,
    bound: u32,
    nodes: u64,
    solution: String,
    #[serde(rename = "moveCount")]
    move_count: u32,
    reason: Option<String>,
}

#[derive(Serialize)]
struct TwophasePrepareResponse {
    ok: bool,
    #[serde(rename = "searchId")]
    search_id: Option<u32>,
    #[serde(rename = "phase1Depth")]
    phase1_depth: Option<u8>,
    #[serde(rename = "phase1Nodes")]
    phase1_nodes: Option<u64>,
    #[serde(rename = "candidateCount")]
    candidate_count: Option<usize>,
    reason: Option<String>,
}

#[derive(Serialize)]
struct TwophaseSearchResponse {
    ok: bool,
    solution: String,
    #[serde(rename = "moveCount")]
    move_count: u32,
    nodes: u64,
    #[serde(rename = "phase1Nodes")]
    phase1_nodes: u64,
    #[serde(rename = "phase2Nodes")]
    phase2_nodes: u64,
    #[serde(rename = "phase1Depth")]
    phase1_depth: u8,
    #[serde(rename = "phase2Depth")]
    phase2_depth: u8,
    #[serde(rename = "candidateCount")]
    candidate_count: usize,
    reason: Option<String>,
}

#[derive(Serialize)]
struct TwophaseExactResponse {
    ok: bool,
    status: String,
    solution: String,
    #[serde(rename = "moveCount")]
    move_count: u32,
    bound: u32,
    nodes: u64,
    #[serde(rename = "phase1Nodes")]
    phase1_nodes: u64,
    #[serde(rename = "phase2Nodes")]
    phase2_nodes: u64,
    reason: Option<String>,
}

#[wasm_bindgen]
pub fn solve_json(req_json: &str) -> String {
    utils::set_panic_hook();
    let parsed: Result<SolveRequest, _> = serde_json::from_str(req_json);
    if let Err(err) = parsed {
        return error_resp(format!("invalid request: {err}"));
    }
    let req = parsed.unwrap();
    if req.scramble.trim().is_empty() {
        return error_resp("NO_SCRAMBLE".into());
    }
    match req.event_id.as_str() {
        "222" => solve_2x2(req.scramble),
        _ => error_resp("UNSUPPORTED_EVENT".into()),
    }
}

fn install_minmove_tables(tables: MinmoveTables) -> Result<(), String> {
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
    if staging.expected_bytes != expected_bytes as usize
        || staging.bytes.len() != staging.expected_bytes
    {
        return Err(JsValue::from_str("MINMOVE_BUNDLE_SIZE_MISMATCH"));
    }
    let tables = load_bundle_owned(staging.bytes).map_err(|error| JsValue::from_str(&error))?;
    install_minmove_tables(tables).map_err(|error| JsValue::from_str(&error))
}

#[wasm_bindgen]
pub fn abort_minmove_333_bundle() {
    *MINMOVE_BUNDLE_STAGING.lock().unwrap() = None;
}

#[wasm_bindgen]
pub fn load_twophase_333_bundle(bytes: &[u8]) -> Result<(), JsValue> {
    utils::set_panic_hook();
    let tables = load_twophase_bundle(bytes).map_err(|error| JsValue::from_str(&error))?;
    {
        let mut guard = TWOPHASE_TABLES.lock().unwrap();
        *guard = Some(tables);
    }
    TWOPHASE_SEARCHES.lock().unwrap().sessions.clear();
    Ok(())
}

#[wasm_bindgen]
pub fn warm_minmove_333() -> Result<(), JsValue> {
    utils::set_panic_hook();
    let tables_guard = MINMOVE_TABLES.lock().unwrap();
    let bidirectional_guard = MINMOVE_BIDIRECTIONAL_CONTEXT.lock().unwrap();
    if tables_guard.is_some() && bidirectional_guard.is_some() {
        Ok(())
    } else {
        Err(JsValue::from_str("MINMOVE_TABLES_NOT_LOADED"))
    }
}

#[wasm_bindgen]
pub fn warm_twophase_333() -> Result<(), JsValue> {
    utils::set_panic_hook();
    let guard = TWOPHASE_TABLES.lock().unwrap();
    if guard.is_some() {
        Ok(())
    } else {
        Err(JsValue::from_str("TWOPHASE_TABLES_NOT_LOADED"))
    }
}

#[wasm_bindgen]
pub fn prepare_minmove_333(scramble: &str) -> String {
    utils::set_panic_hook();
    let tables_guard = MINMOVE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::to_string(&MinmovePrepareResponse {
            ok: false,
            search_id: None,
            lower_bound: None,
            reverse_depth: None,
            reverse_states: None,
            reason: Some("MINMOVE_TABLES_NOT_LOADED".into()),
        })
        .unwrap();
    };
    let bidirectional_guard = MINMOVE_BIDIRECTIONAL_CONTEXT.lock().unwrap();
    let Some(bidirectional) = bidirectional_guard.as_ref().cloned() else {
        return serde_json::to_string(&MinmovePrepareResponse {
            ok: false,
            search_id: None,
            lower_bound: None,
            reverse_depth: None,
            reverse_states: None,
            reason: Some("MINMOVE_BIDIRECTIONAL_NOT_READY".into()),
        })
        .unwrap();
    };

    match SearchSession::prepare(scramble, tables, bidirectional) {
        Ok(session) => {
            let lower_bound = session.lower_bound;
            let reverse_depth = session.reverse_depth;
            let reverse_states = session.reverse_states.min(u32::MAX as usize) as u32;
            let mut store = MINMOVE_SEARCHES.lock().unwrap();
            let search_id = store.next_id;
            store.next_id = store.next_id.wrapping_add(1).max(1);
            store.sessions.insert(search_id, session);
            serde_json::to_string(&MinmovePrepareResponse {
                ok: true,
                search_id: Some(search_id),
                lower_bound: Some(lower_bound),
                reverse_depth: Some(reverse_depth),
                reverse_states: Some(reverse_states),
                reason: None,
            })
            .unwrap()
        }
        Err(reason) => serde_json::to_string(&MinmovePrepareResponse {
            ok: false,
            search_id: None,
            lower_bound: None,
            reverse_depth: None,
            reverse_states: None,
            reason: Some(reason),
        })
        .unwrap(),
    }
}

#[wasm_bindgen]
pub fn prepare_twophase_333(scramble: &str, options_json: &str) -> String {
    utils::set_panic_hook();
    let guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = guard.as_ref() else {
        return serde_json::to_string(&TwophasePrepareResponse {
            ok: false,
            search_id: None,
            phase1_depth: None,
            phase1_nodes: None,
            candidate_count: None,
            reason: Some("TWOPHASE_TABLES_NOT_LOADED".into()),
        })
        .unwrap();
    };

    let options = serde_json::from_str::<TwophasePrepareOptions>(options_json).unwrap_or(
        TwophasePrepareOptions {
            max_phase1_solutions: 12,
            phase1_max_depth: 13,
            phase1_node_limit: 0,
        },
    );

    match TwophaseSession::prepare(scramble, tables, &options) {
        Ok(session) => {
            let mut store = TWOPHASE_SEARCHES.lock().unwrap();
            let search_id = store.next_id;
            store.next_id = store.next_id.wrapping_add(1).max(1);
            let phase1_depth = session.phase1_min_depth();
            let phase1_nodes = session.phase1_nodes();
            let candidate_count = session.candidate_count();
            store.sessions.insert(search_id, session);
            serde_json::to_string(&TwophasePrepareResponse {
                ok: true,
                search_id: Some(search_id),
                phase1_depth: Some(phase1_depth),
                phase1_nodes: Some(phase1_nodes),
                candidate_count: Some(candidate_count),
                reason: None,
            })
            .unwrap()
        }
        Err(reason) => serde_json::to_string(&TwophasePrepareResponse {
            ok: false,
            search_id: None,
            phase1_depth: None,
            phase1_nodes: None,
            candidate_count: None,
            reason: Some(reason),
        })
        .unwrap(),
    }
}

#[wasm_bindgen]
pub fn search_minmove_bound(search_id: u32, bound: u32, max_nodes: u32) -> String {
    utils::set_panic_hook();
    let guard = MINMOVE_TABLES.lock().unwrap();
    let Some(tables) = guard.as_ref() else {
        return serde_json::to_string(&MinmoveSearchResponse {
            ok: false,
            status: "error".into(),
            bound,
            nodes: 0,
            solution: String::new(),
            move_count: 0,
            reason: Some("MINMOVE_TABLES_NOT_LOADED".into()),
        })
        .unwrap();
    };
    let mut store = MINMOVE_SEARCHES.lock().unwrap();
    let Some(session) = store.sessions.get_mut(&search_id) else {
        return serde_json::to_string(&MinmoveSearchResponse {
            ok: false,
            status: "error".into(),
            bound,
            nodes: 0,
            solution: String::new(),
            move_count: 0,
            reason: Some("MINMOVE_UNKNOWN_SEARCH".into()),
        })
        .unwrap();
    };

    // 0 means unlimited; otherwise use the caller-supplied budget.
    let node_budget: u64 = if max_nodes == 0 {
        u64::MAX
    } else {
        max_nodes as u64
    };
    let result = session.search_bound(tables, bound.min(u8::MAX as u32) as u8, node_budget);
    let solution = if result.found {
        search_to_string(&result, tables)
    } else {
        String::new()
    };
    let status = if result.found {
        "found"
    } else if result.interrupted {
        "interrupted"
    } else {
        "exhausted"
    };
    serde_json::to_string(&MinmoveSearchResponse {
        ok: true,
        status: status.into(),
        bound: result.bound as u32,
        nodes: result.nodes,
        move_count: result.path.len() as u32,
        solution,
        reason: None,
    })
    .unwrap()
}

#[wasm_bindgen]
pub fn search_twophase_333(search_id: u32, options_json: &str) -> String {
    utils::set_panic_hook();
    let guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = guard.as_ref() else {
        return serde_json::to_string(&TwophaseSearchResponse {
            ok: false,
            solution: String::new(),
            move_count: 0,
            nodes: 0,
            phase1_nodes: 0,
            phase2_nodes: 0,
            phase1_depth: 0,
            phase2_depth: 0,
            candidate_count: 0,
            reason: Some("TWOPHASE_TABLES_NOT_LOADED".into()),
        })
        .unwrap();
    };
    let options = serde_json::from_str::<TwophaseSearchOptions>(options_json).unwrap_or(
        TwophaseSearchOptions {
            incumbent_length: None,
            excluded_solution: None,
            strict_incumbent: false,
            phase2_max_depth: 20,
            phase2_node_limit: 0,
        },
    );
    let store = TWOPHASE_SEARCHES.lock().unwrap();
    let Some(session) = store.sessions.get(&search_id) else {
        return serde_json::to_string(&TwophaseSearchResponse {
            ok: false,
            solution: String::new(),
            move_count: 0,
            nodes: 0,
            phase1_nodes: 0,
            phase2_nodes: 0,
            phase1_depth: 0,
            phase2_depth: 0,
            candidate_count: 0,
            reason: Some("TWOPHASE_UNKNOWN_SEARCH".into()),
        })
        .unwrap();
    };
    let result = session.search(tables, &options);
    serde_json::to_string(&TwophaseSearchResponse {
        ok: result.ok,
        solution: result.solution,
        move_count: result.move_count,
        nodes: result.nodes,
        phase1_nodes: result.phase1_nodes,
        phase2_nodes: result.phase2_nodes,
        phase1_depth: result.phase1_depth,
        phase2_depth: result.phase2_depth,
        candidate_count: result.candidate_count,
        reason: if result.reason.is_empty() {
            None
        } else {
            Some(result.reason)
        },
    })
    .unwrap()
}

#[wasm_bindgen]
pub fn search_twophase_exact_333(scramble: &str, options_json: &str) -> String {
    utils::set_panic_hook();
    let guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = guard.as_ref() else {
        return serde_json::to_string(&TwophaseExactResponse {
            ok: false,
            status: "error".into(),
            solution: String::new(),
            move_count: 0,
            bound: 0,
            nodes: 0,
            phase1_nodes: 0,
            phase2_nodes: 0,
            reason: Some("TWOPHASE_TABLES_NOT_LOADED".into()),
        })
        .unwrap();
    };

    let options = match serde_json::from_str::<TwophaseExactOptions>(options_json) {
        Ok(options) => options,
        Err(_) => {
            return serde_json::to_string(&TwophaseExactResponse {
                ok: false,
                status: "error".into(),
                solution: String::new(),
                move_count: 0,
                bound: 0,
                nodes: 0,
                phase1_nodes: 0,
                phase2_nodes: 0,
                reason: Some("TWOPHASE_EXACT_BAD_OPTIONS".into()),
            })
            .unwrap();
        }
    };

    let result = search_twophase_exact_bound(scramble, tables, &options);
    let status = if !result.ok {
        "error"
    } else if result.found {
        "found"
    } else if result.interrupted {
        "interrupted"
    } else {
        "exhausted"
    };
    serde_json::to_string(&TwophaseExactResponse {
        ok: result.ok,
        status: status.into(),
        solution: result.solution,
        move_count: result.move_count,
        bound: result.bound as u32,
        nodes: result.nodes,
        phase1_nodes: result.phase1_nodes,
        phase2_nodes: result.phase2_nodes,
        reason: if result.reason.is_empty() {
            None
        } else {
            Some(result.reason)
        },
    })
    .unwrap()
}

#[wasm_bindgen]
pub fn drop_minmove_search(search_id: u32) {
    utils::set_panic_hook();
    MINMOVE_SEARCHES.lock().unwrap().sessions.remove(&search_id);
}

#[wasm_bindgen]
pub fn drop_twophase_search(search_id: u32) {
    utils::set_panic_hook();
    TWOPHASE_SEARCHES
        .lock()
        .unwrap()
        .sessions
        .remove(&search_id);
}

#[wasm_bindgen]
pub fn solve_phase2_direct(
    cp_idx: u32,
    ep_idx: u32,
    sep_idx: u32,
    max_depth: u8,
    node_limit: u32,
) -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    let input = Phase2Input {
        cp_idx: cp_idx as usize,
        ep_idx: ep_idx as usize,
        sep_idx: sep_idx as usize,
    };
    let result = solve_phase2(&input, tables, max_depth, node_limit as u64);
    if result.ok {
        let move_names: Vec<String> = result
            .moves
            .iter()
            .map(|&local_idx| {
                let global_idx = tables.phase2_move_indices[local_idx as usize];
                tables.move_data.move_names[global_idx as usize].clone()
            })
            .collect();
        serde_json::json!({
            "ok": true,
            "moves": move_names,
            "depth": result.depth,
            "nodes": result.nodes,
        })
        .to_string()
    } else {
        serde_json::json!({
            "ok": false,
            "reason": result.reason,
            "nodes": result.nodes,
        })
        .to_string()
    }
}

#[wasm_bindgen]
pub fn build_fmc_tables_wasm() -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    let fmc = build_fmc_tables(tables);
    let three_cycle_algorithm_count = fmc.three_cycle_algorithms.len();
    let two_corner_two_edge_algorithm_count = fmc.two_corner_two_edge_algorithms.len();
    let multi_relocation_plan_count = fmc.multi_relocation_plan_count();
    let slice_relocation_plan_count = fmc.slice_relocation_plan_count();
    drop(tables_guard);
    let mut fmc_guard = FMC_TABLES.lock().unwrap();
    *fmc_guard = Some(fmc);
    serde_json::json!({
        "ok": true,
        "threeCycleAlgorithmCount": three_cycle_algorithm_count,
        "twoCornerTwoEdgeAlgorithmCount": two_corner_two_edge_algorithm_count,
        "multiRelocationPlanCount": multi_relocation_plan_count,
        "sliceRelocationPlanCount": slice_relocation_plan_count,
    })
    .to_string()
}

#[derive(Deserialize)]
struct FmcOptionsJson {
    #[serde(rename = "maxPremoveSets", default = "default_max_premove_sets")]
    max_premove_sets: usize,
    #[serde(rename = "forceRzp", default)]
    force_rzp: bool,
    #[serde(rename = "enableMultiInsertion", default)]
    enable_multi_insertion: bool,
    #[serde(rename = "enableHtrSkeletons", default)]
    enable_htr_skeletons: bool,
    #[serde(rename = "enableSliceInsertion", default)]
    enable_slice_insertion: bool,
    #[serde(rename = "enableMultiSwitchNiss", default)]
    enable_multi_switch_niss: bool,
    #[serde(rename = "enableDeepMultiSwitchNiss", default)]
    enable_deep_multi_switch_niss: bool,
    #[serde(rename = "searchLevel", default)]
    search_level: u8,
    #[serde(rename = "searchVariant", default)]
    search_variant: u32,
    #[serde(
        rename = "incumbentMoveCount",
        default = "default_fmc_incumbent_move_count"
    )]
    incumbent_move_count: usize,
}
fn default_fmc_incumbent_move_count() -> usize {
    40
}
fn default_max_premove_sets() -> usize {
    120
}

#[wasm_bindgen]
pub fn solve_fmc_wasm(scramble: &str, options_json: &str) -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    let fmc_guard = FMC_TABLES.lock().unwrap();
    let Some(fmc_tables) = fmc_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "FMC_TABLES_NOT_BUILT"}).to_string();
    };
    let options: FmcOptionsJson = match serde_json::from_str(options_json) {
        Ok(o) => o,
        Err(e) => {
            return serde_json::json!({"ok": false, "reason": format!("BAD_OPTIONS: {e}")})
                .to_string()
        }
    };

    let result = solve_fmc(
        scramble,
        tables,
        fmc_tables,
        options.max_premove_sets,
        options.force_rzp,
        options.enable_multi_insertion,
        options.enable_htr_skeletons,
        options.enable_slice_insertion,
        options.enable_multi_switch_niss,
        options.enable_deep_multi_switch_niss,
        options.search_level,
        options.search_variant,
        options.incumbent_move_count,
    );

    if !result.ok {
        return serde_json::json!({
            "ok": false,
            "reason": "FMC_NO_SOLUTION",
            "reverseScrambleRejectedCount": result.reverse_scramble_rejected_count,
        })
        .to_string();
    }

    let candidates_json: Vec<serde_json::Value> = result
        .candidates
        .iter()
        .map(|c| candidate_to_json(c, tables))
        .collect();
    let skeletons_json: Vec<serde_json::Value> = result
        .skeletons
        .iter()
        .map(|s| skeleton_to_json(s, tables))
        .collect();
    let best = &result.candidates[0];
    let best_solution = minmove_core::solution_string_from_path(&best.moves, &tables.move_data);

    serde_json::json!({
        "ok": true,
        "solution": best_solution,
        "moveCount": best.moves.len(),
        "candidates": candidates_json,
        "skeletonCount": skeletons_json.len(),
        "skeletons": skeletons_json,
        "insertionCandidateCount": result.insertion_candidate_count,
        "mixedInsertionCandidateCount": result.mixed_insertion_candidate_count,
        "multiInsertionCandidateCount": result.multi_insertion_candidate_count,
        "multiInsertionTransitionCount": result.multi_insertion_transition_count,
        "multiInsertionPairCount": result.multi_insertion_pair_count,
        "sliceInsertionCandidateCount": result.slice_insertion_candidate_count,
        "multiSwitchNissCandidateCount": result.multi_switch_niss_candidate_count,
        "reverseScrambleRejectedCount": result.reverse_scramble_rejected_count,
        "htrCandidateCount": result.candidates.iter().filter(|candidate| (4..=7).contains(&candidate.source_tag)).count(),
        "htrSkeletonCount": result.skeletons.iter().filter(|skeleton| (4..=7).contains(&skeleton.source_tag)).count(),
    })
    .to_string()
}

#[wasm_bindgen]
pub fn optimize_insertion_wasm(scramble: &str, moves_str: &str, options_json: &str) -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    optimize_insertion_wasm_impl(scramble, moves_str, options_json, tables)
}

/// Verify that `scramble` followed by `solution` returns to the solved state.
/// Returns JSON: `{"ok": true, "solved": bool}` or `{"ok": false, "reason": "..."}`.
#[wasm_bindgen]
pub fn verify_fmc_solution_wasm(scramble: &str, solution: &str) -> String {
    utils::set_panic_hook();
    let tables_guard = TWOPHASE_TABLES.lock().unwrap();
    let Some(tables) = tables_guard.as_ref() else {
        return serde_json::json!({"ok": false, "reason": "TWOPHASE_TABLES_NOT_LOADED"})
            .to_string();
    };
    use fmc_search::is_fmc_solved_up_to_rotation;
    use minmove_core::{parse_scramble as parse_moves_minmove, CubeState};
    let mut combined = scramble.to_string();
    combined.push(' ');
    combined.push_str(solution);
    match parse_moves_minmove(&combined, &tables.move_data) {
        Ok(moves) => {
            let final_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
            let solved = is_fmc_solved_up_to_rotation(&final_state, tables);
            serde_json::json!({"ok": true, "solved": solved}).to_string()
        }
        Err(e) => serde_json::json!({"ok": false, "reason": e}).to_string(),
    }
}

fn solve_2x2(_scramble: String) -> String {
    let prune = unsafe { PRUNE.get_or_insert_with(|| build_prune_tables()) };

    let moves = match parser::parse_scramble(&_scramble) {
        Some(v) => v,
        None => return error_resp("BAD_SCRAMBLE".into()),
    };
    let state = parser::apply_scramble_to_solved(&moves);
    if let Some(path) = ida_solve(state, 11, prune) {
        let moves = path_to_strings(path);
        return serde_json::to_string(&SolveResponse {
            ok: true,
            solution: moves.join(" "),
            move_count: moves.len() as u32,
            reason: None,
        })
        .unwrap();
    }
    error_resp("NO_SOLUTION".into())
}

fn path_to_strings(path: Vec<usize>) -> Vec<String> {
    path.into_iter()
        .map(|m| match m {
            0 => "U".into(),
            1 => "U2".into(),
            2 => "U'".into(),
            3 => "F".into(),
            4 => "F2".into(),
            5 => "F'".into(),
            6 => "R".into(),
            7 => "R2".into(),
            8 => "R'".into(),
            _ => unreachable!(),
        })
        .collect()
}

fn error_resp(reason: String) -> String {
    serde_json::to_string(&SolveResponse {
        ok: false,
        solution: String::new(),
        move_count: 0,
        reason: Some(reason),
    })
    .unwrap()
}
