import fs from "node:fs/promises";

function replaceOnce(source, pattern, replacement, label) {
  let count = 0;
  const updated = source.replace(pattern, (...args) => {
    count += 1;
    return typeof replacement === "function" ? replacement(...args) : replacement;
  });
  if (count !== 1) {
    throw new Error(`${label}: expected one replacement, got ${count}`);
  }
  return updated;
}

async function patchRust() {
  const path = "solver-wasm/src/twophase_search.rs";
  let source = await fs.readFile(path, "utf8");

  source = replaceOnce(
    source,
    "use std::collections::{HashMap, HashSet};\nuse std::sync::Mutex;",
    `use std::cell::Cell;\nuse std::collections::{HashMap, HashSet};\nuse std::sync::Mutex;\n#[cfg(not(target_arch = "wasm32"))]\nuse std::time::{SystemTime, UNIX_EPOCH};`,
    "Rust imports",
  );

  source = replaceOnce(
    source,
    "const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];",
    `const FACTORIAL_4: [usize; 5] = [1, 1, 2, 6, 24];\nconst DEADLINE_CHECK_MASK: u64 = 2_047;\nconst TWOPHASE_DEADLINE_REASON: &str = "TWOPHASE_DEADLINE_REACHED";\n\nthread_local! {\n    static ACTIVE_TWOPHASE_DEADLINE_TS: Cell<f64> = Cell::new(f64::INFINITY);\n}\n\npub struct TwophaseDeadlineGuard {\n    previous: f64,\n}\n\nimpl Drop for TwophaseDeadlineGuard {\n    fn drop(&mut self) {\n        ACTIVE_TWOPHASE_DEADLINE_TS.with(|deadline| deadline.set(self.previous));\n    }\n}\n\npub fn activate_twophase_deadline(deadline_ts: f64) -> TwophaseDeadlineGuard {\n    let normalized = if deadline_ts.is_finite() && deadline_ts > 0.0 {\n        deadline_ts\n    } else {\n        f64::INFINITY\n    };\n    let previous = ACTIVE_TWOPHASE_DEADLINE_TS.with(|deadline| {\n        let previous = deadline.get();\n        deadline.set(normalized);\n        previous\n    });\n    TwophaseDeadlineGuard { previous }\n}\n\n#[cfg(target_arch = "wasm32")]\nfn wall_clock_ms() -> f64 {\n    js_sys::Date::now()\n}\n\n#[cfg(not(target_arch = "wasm32"))]\nfn wall_clock_ms() -> f64 {\n    SystemTime::now()\n        .duration_since(UNIX_EPOCH)\n        .map(|duration| duration.as_secs_f64() * 1_000.0)\n        .unwrap_or(0.0)\n}\n\n#[inline(always)]\nfn twophase_deadline_reached() -> bool {\n    ACTIVE_TWOPHASE_DEADLINE_TS.with(|deadline| {\n        let deadline_ts = deadline.get();\n        deadline_ts.is_finite() && wall_clock_ms() >= deadline_ts\n    })\n}`,
    "Rust deadline infrastructure",
  );

  source = replaceOnce(
    source,
    `fn default_phase2_max_depth() -> u8 {\n    20\n}`,
    `fn default_phase2_max_depth() -> u8 {\n    20\n}\n\nfn default_deadline_ts() -> f64 {\n    f64::INFINITY\n}`,
    "Rust deadline default",
  );

  source = replaceOnce(
    source,
    `    #[serde(rename = "phase1NodeLimit", default)]\n    pub phase1_node_limit: u64,\n}`,
    `    #[serde(rename = "phase1NodeLimit", default)]\n    pub phase1_node_limit: u64,\n    #[serde(rename = "deadlineTs", default = "default_deadline_ts")]\n    pub deadline_ts: f64,\n}`,
    "Prepare deadline option",
  );

  source = replaceOnce(
    source,
    `    #[serde(rename = "phase2NodeLimit", default)]\n    pub phase2_node_limit: u64,\n}`,
    `    #[serde(rename = "phase2NodeLimit", default)]\n    pub phase2_node_limit: u64,\n    #[serde(rename = "deadlineTs", default = "default_deadline_ts")]\n    pub deadline_ts: f64,\n}`,
    "Search deadline option",
  );

  source = replaceOnce(
    source,
    `pub struct TwophaseExactOptions {\n    #[serde(rename = "maxTotalDepth")]\n    pub max_total_depth: u8,\n    #[serde(rename = "excludedSolution", default)]\n    pub excluded_solution: Option<String>,\n    #[serde(rename = "phase1NodeLimit", default)]\n    pub phase1_node_limit: u64,\n    #[serde(rename = "phase2NodeLimit", default)]\n    pub phase2_node_limit: u64,\n}`,
    `pub struct TwophaseExactOptions {\n    #[serde(rename = "maxTotalDepth")]\n    pub max_total_depth: u8,\n    #[serde(rename = "excludedSolution", default)]\n    pub excluded_solution: Option<String>,\n    #[serde(rename = "phase1NodeLimit", default)]\n    pub phase1_node_limit: u64,\n    #[serde(rename = "phase2NodeLimit", default)]\n    pub phase2_node_limit: u64,\n    #[serde(rename = "deadlineTs", default = "default_deadline_ts")]\n    pub deadline_ts: f64,\n}`,
    "Exact deadline option",
  );

  source = replaceOnce(
    source,
    `    node_limit: u64,\n    node_limit_hit: bool,\n    fail_cache: &'b mut FixedFailTable,`,
    `    node_limit: u64,\n    node_limit_hit: bool,\n    timed_out: bool,\n    fail_cache: &'b mut FixedFailTable,`,
    "Phase1 context timeout field",
  );

  source = replaceOnce(
    source,
    `        if self.node_limit_hit {\n            return STOP_SENTINEL;\n        }\n        let h = phase1_joint_lower_bound`,
    `        if self.node_limit_hit || self.timed_out {\n            return STOP_SENTINEL;\n        }\n        if twophase_deadline_reached() {\n            self.timed_out = true;\n            return STOP_SENTINEL;\n        }\n        let h = phase1_joint_lower_bound`,
    "Phase1 entry deadline",
  );

  source = replaceOnce(
    source,
    `            self.nodes += 1;\n            if self.node_limit > 0 && self.nodes >= self.node_limit {`,
    `            self.nodes += 1;\n            if (self.nodes & DEADLINE_CHECK_MASK) == 0 && twophase_deadline_reached() {\n                self.timed_out = true;\n                return STOP_SENTINEL;\n            }\n            if self.node_limit > 0 && self.nodes >= self.node_limit {`,
    "Phase1 periodic deadline",
  );

  source = replaceOnce(
    source,
    `        node_limit: input.node_limit,\n        node_limit_hit: false,\n        fail_cache: &mut fail_cache,`,
    `        node_limit: input.node_limit,\n        node_limit_hit: false,\n        timed_out: false,\n        fail_cache: &mut fail_cache,`,
    "Phase1 context init",
  );

  source = replaceOnce(
    source,
    `        reason: if ctx.node_limit_hit {\n            "PHASE1_SEARCH_LIMIT".into()\n        } else {`,
    `        reason: if ctx.timed_out {\n            TWOPHASE_DEADLINE_REASON.into()\n        } else if ctx.node_limit_hit {\n            "PHASE1_SEARCH_LIMIT".into()\n        } else {`,
    "Phase1 timeout result",
  );

  source = replaceOnce(
    source,
    `        max_count: usize,\n        nodes: &mut u64,\n    ) {\n        if solutions.len() >= max_count {`,
    `        max_count: usize,\n        nodes: &mut u64,\n        timed_out: &mut bool,\n    ) {\n        if *timed_out || solutions.len() >= max_count {\n            return;\n        }\n        if twophase_deadline_reached() {\n            *timed_out = true;`,
    "Phase1 enumeration deadline signature",
  );

  source = replaceOnce(
    source,
    `            *nodes += 1;\n            let next_co = tables.co_move.get(co, move_index as usize) as usize;`,
    `            *nodes += 1;\n            if (*nodes & DEADLINE_CHECK_MASK) == 0 && twophase_deadline_reached() {\n                *timed_out = true;\n                return;\n            }\n            let next_co = tables.co_move.get(co, move_index as usize) as usize;`,
    "Phase1 enumeration periodic deadline",
  );

  source = replaceOnce(
    source,
    `                max_count,\n                nodes,\n            );`,
    `                max_count,\n                nodes,\n                timed_out,\n            );`,
    "Phase1 enumeration recursive args",
  );

  source = replaceOnce(
    source,
    `    let mut target = first.depth;\n    while solutions.len() < max_count && target <= input.max_depth {`,
    `    let mut target = first.depth;\n    let mut timed_out = false;\n    while !timed_out && solutions.len() < max_count && target <= input.max_depth {`,
    "Phase1 enumeration timeout state",
  );

  source = replaceOnce(
    source,
    `            max_count,\n            &mut enum_nodes,\n        );\n        target += 1;\n    }\n\n    Phase1MultiResult {`,
    `            max_count,\n            &mut enum_nodes,\n            &mut timed_out,\n        );\n        target += 1;\n    }\n\n    if timed_out {\n        return Phase1MultiResult {\n            solutions: Vec::new(),\n            min_depth: first.depth,\n            nodes: first.nodes + enum_nodes,\n            reason: TWOPHASE_DEADLINE_REASON.into(),\n        };\n    }\n\n    Phase1MultiResult {`,
    "Phase1 enumeration timeout result",
  );

  source = replaceOnce(
    source,
    `    node_limit: u64,\n    node_limit_hit: bool,\n    excluded_global_path: Option<Vec<u8>>,`,
    `    node_limit: u64,\n    node_limit_hit: bool,\n    timed_out: bool,\n    excluded_global_path: Option<Vec<u8>>,`,
    "Phase2 context timeout field",
  );

  source = replaceOnce(
    source,
    `        if self.node_limit_hit {\n            return STOP_SENTINEL;\n        }\n        let h = self`,
    `        if self.node_limit_hit || self.timed_out {\n            return STOP_SENTINEL;\n        }\n        if twophase_deadline_reached() {\n            self.timed_out = true;\n            return STOP_SENTINEL;\n        }\n        let h = self`,
    "Phase2 entry deadline",
  );

  source = replaceOnce(
    source,
    `            self.nodes += 1;\n            if self.node_limit > 0 && self.nodes >= self.node_limit {`,
    `            self.nodes += 1;\n            if (self.nodes & DEADLINE_CHECK_MASK) == 0 && twophase_deadline_reached() {\n                self.timed_out = true;\n                return STOP_SENTINEL;\n            }\n            if self.node_limit > 0 && self.nodes >= self.node_limit {`,
    "Phase2 periodic deadline",
  );

  source = replaceOnce(
    source,
    `fn solve_phase2_excluding(\n    input: &Phase2Input,\n    tables: &TwophaseTables,\n    max_depth: u8,\n    node_limit: u64,\n    excluded_global_path: Option<&[u8]>,\n) -> Phase2SolveResult {\n    if input.cp_idx == 0`,
    `fn solve_phase2_excluding(\n    input: &Phase2Input,\n    tables: &TwophaseTables,\n    max_depth: u8,\n    node_limit: u64,\n    excluded_global_path: Option<&[u8]>,\n) -> Phase2SolveResult {\n    if twophase_deadline_reached() {\n        return Phase2SolveResult {\n            ok: false,\n            moves: Vec::new(),\n            depth: 0,\n            nodes: 0,\n            reason: TWOPHASE_DEADLINE_REASON.into(),\n        };\n    }\n    if input.cp_idx == 0`,
    "Phase2 immediate deadline",
  );

  source = replaceOnce(
    source,
    `        node_limit,\n        node_limit_hit: false,\n        excluded_global_path: excluded_global_path.map(|path| path.to_vec()),`,
    `        node_limit,\n        node_limit_hit: false,\n        timed_out: false,\n        excluded_global_path: excluded_global_path.map(|path| path.to_vec()),`,
    "Phase2 context init",
  );

  source = replaceOnce(
    source,
    `        reason: if ctx.node_limit_hit {\n            "PHASE2_SEARCH_LIMIT".into()\n        } else {`,
    `        reason: if ctx.timed_out {\n            TWOPHASE_DEADLINE_REASON.into()\n        } else if ctx.node_limit_hit {\n            "PHASE2_SEARCH_LIMIT".into()\n        } else {`,
    "Phase2 timeout result",
  );

  source = replaceOnce(
    source,
    `    excluded_path: Option<&[u8]>,\n) {\n    for candidate in candidates {`,
    `    excluded_path: Option<&[u8]>,\n) -> bool {\n    for candidate in candidates {\n        if twophase_deadline_reached() {\n            return true;\n        }`,
    "Phase2 pass deadline return",
  );

  source = replaceOnce(
    source,
    `        *phase2_nodes += phase2.nodes;\n        if !phase2.ok {\n            continue;\n        }`,
    `        *phase2_nodes += phase2.nodes;\n        if phase2.reason == TWOPHASE_DEADLINE_REASON {\n            return true;\n        }\n        if !phase2.ok {\n            continue;\n        }`,
    "Phase2 pass timeout propagation",
  );

  source = replaceOnce(
    source,
    `            *best_path = Some(full_path);\n        }\n    }\n}\n\nstruct ExactPhase1SearchCtx`,
    `            *best_path = Some(full_path);\n        }\n    }\n    false\n}\n\nstruct ExactPhase1SearchCtx`,
    "Phase2 pass completion",
  );

  source = replaceOnce(
    source,
    `        if self.interrupted || self.found_path.is_some() {\n            return self.found_path.is_some();\n        }`,
    `        if self.interrupted || self.found_path.is_some() {\n            return self.found_path.is_some();\n        }\n        if twophase_deadline_reached() {\n            self.interrupted = true;\n            self.interrupt_reason = TWOPHASE_DEADLINE_REASON.into();\n            return false;\n        }`,
    "Exact Phase1 entry deadline",
  );

  source = replaceOnce(
    source,
    `            if phase2.reason == "PHASE2_SEARCH_LIMIT" {\n                self.interrupted = true;\n                self.interrupt_reason = phase2.reason;`,
    `            if phase2.reason == "PHASE2_SEARCH_LIMIT"\n                || phase2.reason == TWOPHASE_DEADLINE_REASON\n            {\n                self.interrupted = true;\n                self.interrupt_reason = phase2.reason;`,
    "Exact Phase2 timeout propagation",
  );

  source = replaceOnce(
    source,
    `            self.phase1_nodes += 1;\n            if self.phase1_node_limit > 0 && self.phase1_nodes >= self.phase1_node_limit {`,
    `            self.phase1_nodes += 1;\n            if (self.phase1_nodes & DEADLINE_CHECK_MASK) == 0 && twophase_deadline_reached() {\n                self.interrupted = true;\n                self.interrupt_reason = TWOPHASE_DEADLINE_REASON.into();\n                return false;\n            }\n            if self.phase1_node_limit > 0 && self.phase1_nodes >= self.phase1_node_limit {`,
    "Exact Phase1 periodic deadline",
  );

  source = replaceOnce(
    source,
    `        let phase1_input = build_phase1_input(\n            &initial_state,\n            options.phase1_max_depth,\n            options.phase1_node_limit,\n        );`,
    `        let phase1_input = build_phase1_input(\n            &initial_state,\n            options.phase1_max_depth,\n            options.phase1_node_limit,\n        );`,
    "Prepare input anchor",
  );

  source = replaceOnce(
    source,
    `        run_phase2_pass(\n            &self.candidates,`,
    `        let mut timed_out = run_phase2_pass(\n            &self.candidates,`,
    "Session first pass timeout",
  );

  source = replaceOnce(
    source,
    `        );\n        if best_found_total.is_none() && !options.strict_incumbent {\n            run_phase2_pass(`,
    `        );\n        if !timed_out && best_found_total.is_none() && !options.strict_incumbent {\n            timed_out = run_phase2_pass(`,
    "Session second pass timeout",
  );

  source = replaceOnce(
    source,
    `        }\n\n        if let Some(path) = best_path {`,
    `        }\n\n        if timed_out {\n            return TwophaseSearchResult {\n                ok: false,\n                solution: String::new(),\n                move_count: 0,\n                nodes: self.phase1_nodes + phase2_nodes,\n                phase1_nodes: self.phase1_nodes,\n                phase2_nodes,\n                phase1_depth: self.phase1_min_depth,\n                phase2_depth: 0,\n                candidate_count: self.candidates.len(),\n                reason: TWOPHASE_DEADLINE_REASON.into(),\n            };\n        }\n\n        if let Some(path) = best_path {`,
    "Session timeout result",
  );

  source += `\n\n#[cfg(test)]\nmod deadline_tests {\n    use super::*;\n\n    #[test]\n    fn disabled_deadline_never_expires() {\n        let _guard = activate_twophase_deadline(f64::INFINITY);\n        assert!(!twophase_deadline_reached());\n    }\n\n    #[test]\n    fn expired_deadline_is_detected() {\n        let _guard = activate_twophase_deadline(1.0);\n        assert!(twophase_deadline_reached());\n    }\n\n    #[test]\n    fn future_deadline_remains_active() {\n        let _guard = activate_twophase_deadline(wall_clock_ms() + 60_000.0);\n        assert!(!twophase_deadline_reached());\n    }\n}\n`;

  await fs.writeFile(path, source);
}

async function patchLib() {
  const path = "solver-wasm/src/lib.rs";
  let source = await fs.readFile(path, "utf8");

  source = replaceOnce(
    source,
    `use twophase_search::{\n    search_twophase_exact_bound, solve_phase2, Phase2Input, TwophaseExactOptions,\n    TwophasePrepareOptions, TwophaseSearchOptions, TwophaseSession,\n};`,
    `use twophase_search::{\n    activate_twophase_deadline, search_twophase_exact_bound, solve_phase2, Phase2Input,\n    TwophaseExactOptions, TwophasePrepareOptions, TwophaseSearchOptions, TwophaseSession,\n};`,
    "Lib deadline import",
  );

  source = replaceOnce(
    source,
    `            phase1_node_limit: 0,\n        },`,
    `            phase1_node_limit: 0,\n            deadline_ts: f64::INFINITY,\n        },`,
    "Prepare default deadline",
  );

  source = replaceOnce(
    source,
    `    match TwophaseSession::prepare(scramble, tables, &options) {`,
    `    let _deadline_guard = activate_twophase_deadline(options.deadline_ts);\n    match TwophaseSession::prepare(scramble, tables, &options) {`,
    "Prepare deadline guard",
  );

  source = replaceOnce(
    source,
    `            phase2_node_limit: 0,\n        },`,
    `            phase2_node_limit: 0,\n            deadline_ts: f64::INFINITY,\n        },`,
    "Search default deadline",
  );

  source = replaceOnce(
    source,
    `    let result = session.search(tables, &options);`,
    `    let _deadline_guard = activate_twophase_deadline(options.deadline_ts);\n    let result = session.search(tables, &options);`,
    "Search deadline guard",
  );

  source = replaceOnce(
    source,
    `    let result = search_twophase_exact_bound(scramble, tables, &options);\n    let status = if !result.ok {`,
    `    let _deadline_guard = activate_twophase_deadline(options.deadline_ts);\n    let result = search_twophase_exact_bound(scramble, tables, &options);\n    let status = if !result.ok {`,
    "Exact deadline guard",
  );

  source = replaceOnce(
    source,
    `    } else if result.found {\n        "found"\n    } else if result.interrupted {\n        "interrupted"`,
    `    } else if result.found {\n        "found"\n    } else if result.reason == "TWOPHASE_DEADLINE_REACHED" {\n        "timeout"\n    } else if result.interrupted {\n        "interrupted"`,
    "Exact timeout status",
  );

  await fs.writeFile(path, source);
}

async function patchWasmSolver() {
  const path = "solver/wasmSolver.js";
  let source = await fs.readFile(path, "utf8");

  source = replaceOnce(
    source,
    `  return parseJsonResponse(rawResponse);\n}\n\nexport async function dropTwophase333Search`,
    `  const parsed = parseJsonResponse(rawResponse);\n  if (!parsed) return null;\n  const status = String(parsed.status || "");\n  return {\n    ...parsed,\n    found: parsed.found === true || status === "found",\n    interrupted: parsed.interrupted === true || status === "interrupted" || status === "timeout",\n    timedOut: parsed.timedOut === true || status === "timeout" || parsed.reason === "TWOPHASE_DEADLINE_REACHED",\n  };\n}\n\nexport async function dropTwophase333Search`,
    "Exact response normalization",
  );

  source = replaceOnce(
    source,
    `  const prepareOptions = options.prepareOptions || {};\n  const searchOptions = options.searchOptions || {};`,
    `  const deadlineTs = Number.isFinite(Number(options.deadlineTs))\n    ? Number(options.deadlineTs)\n    : null;\n  const prepareOptions = {\n    ...(options.prepareOptions || {}),\n    ...(deadlineTs !== null ? { deadlineTs } : {}),\n  };\n  const searchOptions = {\n    ...(options.searchOptions || {}),\n    ...(deadlineTs !== null ? { deadlineTs } : {}),\n  };`,
    "Adaptive deadline propagation",
  );

  await fs.writeFile(path, source);
}

async function patchMinmoveExact() {
  const path = "solver/minmoveExactV2.js";
  let source = await fs.readFile(path, "utf8");

  source = replaceOnce(
    source,
    `async function findTwoPhaseSeed(scramble, incumbentLength, seedConfigs, excludedSolution = "") {`,
    `async function findTwoPhaseSeed(\n  scramble,\n  incumbentLength,\n  seedConfigs,\n  excludedSolution = "",\n  deadlineTs = null,\n) {`,
    "Seed deadline signature",
  );

  source = replaceOnce(
    source,
    `        phase1NodeLimit: config.phase1NodeLimit,\n      });`,
    `        phase1NodeLimit: config.phase1NodeLimit,\n        ...(Number.isFinite(deadlineTs) ? { deadlineTs } : {}),\n      });`,
    "Seed prepare deadline",
  );

  source = replaceOnce(
    source,
    `        phase2NodeLimit: config.phase2NodeLimit,\n      });`,
    `        phase2NodeLimit: config.phase2NodeLimit,\n        ...(Number.isFinite(deadlineTs) ? { deadlineTs } : {}),\n      });`,
    "Seed search deadline",
  );

  source = replaceOnce(
    source,
    `      direction.excludedSolution,\n    );`,
    `      direction.excludedSolution,\n      deadlineTs,\n    );`,
    "Seed caller deadline",
  );

  source = replaceOnce(
    source,
    `        phase2NodeLimit: profile.phase2NodeLimit,\n      }).catch(() => null);`,
    `        phase2NodeLimit: profile.phase2NodeLimit,\n        deadlineTs,\n      }).catch(() => null);`,
    "Exact search deadline",
  );

  await fs.writeFile(path, source);
}

await patchRust();
await patchLib();
await patchWasmSolver();
await patchMinmoveExact();
console.log("Applied 3x3 Two-Phase deadline patch");
