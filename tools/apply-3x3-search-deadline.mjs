import fs from "node:fs/promises";

function replaceOnce(source, pattern, replacement, label) {
  let count = 0;
  const updated = source.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
  if (count !== 1) throw new Error(`${label}_COUNT_${count}`);
  return updated;
}

async function patchMinmoveSearch() {
  const path = "solver-wasm/src/minmove_search.rs";
  const original = await fs.readFile(path, "utf8");
  if (original.includes("search_bound_with_deadline")) return false;
  let source = original;

  source = replaceOnce(
    source,
    "const MOVE_BITS: u64 = 5;",
    `const MOVE_BITS: u64 = 5;
const DEADLINE_CHECK_INTERVAL: u64 = 2_048;

#[inline(always)]
fn current_time_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs_f64() * 1_000.0)
            .unwrap_or(0.0)
    }
}

#[inline(always)]
fn deadline_reached(nodes: u64, deadline_ms: f64) -> bool {
    if !deadline_ms.is_finite() || deadline_ms <= 0.0 {
        return false;
    }
    if nodes != 1 && nodes % DEADLINE_CHECK_INTERVAL != 0 {
        return false;
    }
    current_time_ms() >= deadline_ms
}`,
    "MINMOVE_CLOCK_MARKER",
  );

  source = replaceOnce(
    source,
    `    pub interrupted: bool,\n    pub bound: u8,`,
    `    pub interrupted: bool,\n    /// True when the search stopped because its absolute deadline elapsed.\n    pub timed_out: bool,\n    pub bound: u8,`,
    "MINMOVE_RESULT_FIELD",
  );

  source = replaceOnce(
    source,
    /    pub fn search_bound\([\s\S]*?\n    fn dfs\(/,
    `    pub fn search_bound(
        &mut self,
        tables: &MinmoveTables,
        bound: u8,
        max_nodes: u64,
    ) -> SearchBoundResult {
        self.search_bound_with_deadline(tables, bound, max_nodes, f64::INFINITY)
    }

    pub fn search_bound_with_deadline(
        &mut self,
        tables: &MinmoveTables,
        bound: u8,
        max_nodes: u64,
        deadline_ms: f64,
    ) -> SearchBoundResult {
        let mut nodes = 0u64;
        let mut path = Vec::with_capacity(bound as usize);
        let mut interrupted = false;
        let mut timed_out = false;
        let initial = self.initial_node;
        let found = self.dfs(
            initial,
            tables,
            0,
            bound,
            LAST_FACE_FREE,
            &mut path,
            &mut nodes,
            max_nodes,
            deadline_ms,
            &mut interrupted,
            &mut timed_out,
        );
        SearchBoundResult {
            found,
            interrupted,
            timed_out,
            bound,
            nodes,
            path,
        }
    }

    fn dfs(`,
    "MINMOVE_SEARCH_BOUND",
  );

  source = replaceOnce(
    source,
    `        max_nodes: u64,\n        interrupted: &mut bool,\n    ) -> bool {\n        *nodes += 1;\n        if *nodes >= max_nodes {\n            *interrupted = true;\n            return false;\n        }`,
    `        max_nodes: u64,\n        deadline_ms: f64,\n        interrupted: &mut bool,\n        timed_out: &mut bool,\n    ) -> bool {\n        *nodes += 1;\n        if deadline_reached(*nodes, deadline_ms) {\n            *interrupted = true;\n            *timed_out = true;\n            return false;\n        }\n        if *nodes >= max_nodes {\n            *interrupted = true;\n            return false;\n        }`,
    "MINMOVE_DFS_DEADLINE",
  );

  source = replaceOnce(
    source,
    `                max_nodes,\n                interrupted,\n            ) {`,
    `                max_nodes,\n                deadline_ms,\n                interrupted,\n                timed_out,\n            ) {`,
    "MINMOVE_RECURSIVE_ARGS",
  );

  source += `

#[cfg(test)]
mod deadline_tests {
    use super::{current_time_ms, deadline_reached, DEADLINE_CHECK_INTERVAL};

    #[test]
    fn disabled_deadline_never_interrupts() {
        assert!(!deadline_reached(1, 0.0));
        assert!(!deadline_reached(DEADLINE_CHECK_INTERVAL, f64::INFINITY));
    }

    #[test]
    fn expired_deadline_is_detected_immediately() {
        assert!(deadline_reached(1, current_time_ms() - 1.0));
    }
}
`;

  await fs.writeFile(path, source, "utf8");
  return true;
}

async function patchLib() {
  const path = "solver-wasm/src/lib.rs";
  const original = await fs.readFile(path, "utf8");
  if (original.includes("pub fn search_minmove_bound_with_deadline")) return false;
  const replacement = `#[wasm_bindgen]
pub fn search_minmove_bound(search_id: u32, bound: u32, max_nodes: u32) -> String {
    search_minmove_bound_impl(search_id, bound, max_nodes, f64::INFINITY)
}

#[wasm_bindgen]
pub fn search_minmove_bound_with_deadline(
    search_id: u32,
    bound: u32,
    max_nodes: u32,
    deadline_ms: f64,
) -> String {
    search_minmove_bound_impl(search_id, bound, max_nodes, deadline_ms)
}

fn search_minmove_bound_impl(
    search_id: u32,
    bound: u32,
    max_nodes: u32,
    deadline_ms: f64,
) -> String {
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

    let node_budget: u64 = if max_nodes == 0 {
        u64::MAX
    } else {
        max_nodes as u64
    };
    let result = session.search_bound_with_deadline(
        tables,
        bound.min(u8::MAX as u32) as u8,
        node_budget,
        deadline_ms,
    );
    let solution = if result.found {
        search_to_string(&result, tables)
    } else {
        String::new()
    };
    let status = if result.found {
        "found"
    } else if result.timed_out {
        "timeout"
    } else if result.interrupted {
        "interrupted"
    } else {
        "exhausted"
    };
    let reason = if result.timed_out {
        Some("MINMOVE_DEADLINE_REACHED".into())
    } else if result.interrupted {
        Some("MINMOVE_NODE_LIMIT_REACHED".into())
    } else {
        None
    };
    serde_json::to_string(&MinmoveSearchResponse {
        ok: true,
        status: status.into(),
        bound: result.bound as u32,
        nodes: result.nodes,
        move_count: result.path.len() as u32,
        solution,
        reason,
    })
    .unwrap()
}

#[wasm_bindgen]
pub fn search_twophase_333`;

  const source = replaceOnce(
    original,
    /#\[wasm_bindgen\]\npub fn search_minmove_bound\([\s\S]*?\n#\[wasm_bindgen\]\npub fn search_twophase_333/,
    replacement,
    "LIB_MINMOVE_EXPORT",
  );
  await fs.writeFile(path, source, "utf8");
  return true;
}

async function patchWasmSolver() {
  const path = "solver/wasmSolver.js";
  const original = await fs.readFile(path, "utf8");
  if (original.includes("search_minmove_bound_with_deadline") && original.includes("deadlineMs = 0")) {
    return false;
  }
  let source = original;
  source = replaceOnce(
    source,
    `    searchMinmoveBound(searchId, bound, maxNodes) {\n      if (typeof mod.search_minmove_bound !== "function") return "";\n      return mod.search_minmove_bound(searchId, bound, maxNodes >>> 0);\n    },`,
    `    searchMinmoveBound(searchId, bound, maxNodes, deadlineMs = 0) {\n      if (typeof mod.search_minmove_bound_with_deadline === "function") {\n        return mod.search_minmove_bound_with_deadline(\n          searchId,\n          bound,\n          maxNodes >>> 0,\n          Number(deadlineMs) || 0,\n        );\n      }\n      if (typeof mod.search_minmove_bound !== "function") return "";\n      return mod.search_minmove_bound(searchId, bound, maxNodes >>> 0);\n    },`,
    "WASM_API_METHOD",
  );
  source = replaceOnce(
    source,
    `export async function searchMinmove333Bound(searchId, bound, maxNodes = 8000000) {`,
    `export async function searchMinmove333Bound(\n  searchId,\n  bound,\n  maxNodes = 8000000,\n  deadlineMs = 0,\n) {`,
    "WASM_EXPORT_SIGNATURE",
  );
  source = replaceOnce(
    source,
    `    rawResponse = api.searchMinmoveBound(searchId, bound, maxNodes);`,
    `    rawResponse = api.searchMinmoveBound(searchId, bound, maxNodes, deadlineMs);`,
    "WASM_EXPORT_CALL",
  );
  await fs.writeFile(path, source, "utf8");
  return true;
}

async function patchWorker() {
  const path = "solver/solverWorker.js";
  const original = await fs.readFile(path, "utf8");
  if (original.includes("MINMOVE_DEADLINE_REACHED") && original.includes("exactSearchDeadlineTs);")) {
    return false;
  }
  let source = original;
  source = replaceOnce(
    source,
    `async function searchMinmove333BoundLazy(searchId, bound, maxNodes) {\n  const { searchMinmove333Bound } = await getWasmSolverModule();\n  return searchMinmove333Bound(searchId, bound, maxNodes);\n}`,
    `async function searchMinmove333BoundLazy(searchId, bound, maxNodes, deadlineTs = 0) {\n  const { searchMinmove333Bound } = await getWasmSolverModule();\n  return searchMinmove333Bound(searchId, bound, maxNodes, deadlineTs);\n}`,
    "WORKER_LAZY_SIGNATURE",
  );
  source = replaceOnce(
    source,
    `        const searchResult = await searchMinmove333BoundLazy(searchId, bound, NODES_PER_BOUND);`,
    `        const searchResult = await searchMinmove333BoundLazy(\n          searchId,\n          bound,\n          NODES_PER_BOUND,\n          exactSearchDeadlineTs,\n        );`,
    "WORKER_DEADLINE_CALL",
  );
  source = replaceOnce(
    source,
    `        if (Number.isFinite(searchResult.nodes)) {\n          totalNodes += searchResult.nodes;\n        }\n        if (searchResult.status === "found" && typeof searchResult.solution === "string") {`,
    `        if (Number.isFinite(searchResult.nodes)) {\n          totalNodes += searchResult.nodes;\n        }\n        if (\n          searchResult.status === "timeout" ||\n          searchResult.reason === "MINMOVE_DEADLINE_REACHED"\n        ) {\n          const fallbackResult = buildIncumbentFallbackResult("MINMOVE_TIMEOUT", { bound });\n          if (typeof onProgress === "function") {\n            try {\n              void onProgress({\n                type: "exact_search_fallback",\n                reason: "timeout",\n                moveCount: incumbentLength,\n              });\n            } catch (_) {}\n          }\n          return fallbackResult;\n        }\n        if (searchResult.status === "found" && typeof searchResult.solution === "string") {`,
    "WORKER_TIMEOUT_HANDLING",
  );
  await fs.writeFile(path, source, "utf8");
  return true;
}

const changed = [
  await patchMinmoveSearch(),
  await patchLib(),
  await patchWasmSolver(),
  await patchWorker(),
].some(Boolean);
console.log(changed ? "Applied 3x3 minmove deadline patch" : "3x3 deadline patch already applied");
