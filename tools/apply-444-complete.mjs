import fs from "node:fs";

function patch(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`${path}: patch made no change`);
  fs.writeFileSync(path, after);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one target, found ${count}`);
  return source.replace(before, after);
}

patch("solver-wasm/src/twophase_search.rs", (source) => {
  const before = `    pub fn prepare(
        scramble: &str,
        tables: &TwophaseTables,
        options: &TwophasePrepareOptions,
    ) -> Result<Self, String> {
        let moves = parse_scramble(scramble, &tables.move_data)?;
        let initial_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
        let phase1_input = build_phase1_input(
            &initial_state,
            options.phase1_max_depth,
            options.phase1_node_limit,
        );`;
  const after = `    pub fn prepare(
        scramble: &str,
        tables: &TwophaseTables,
        options: &TwophasePrepareOptions,
    ) -> Result<Self, String> {
        let moves = parse_scramble(scramble, &tables.move_data)?;
        let initial_state = CubeState::solved().apply_moves(&moves, &tables.move_data);
        Self::prepare_from_state(initial_state, tables, options)
    }

    pub fn prepare_from_state(
        initial_state: CubeState,
        tables: &TwophaseTables,
        options: &TwophasePrepareOptions,
    ) -> Result<Self, String> {
        let phase1_input = build_phase1_input(
            &initial_state,
            options.phase1_max_depth,
            options.phase1_node_limit,
        );`;
  return replaceOnce(source, before, after, "TwophaseSession prepare bridge");
});

patch("solver-wasm/src/lib.rs", (source) => {
  source = replaceOnce(source, "pub mod fmc_insertion;", "mod cubie_bridge;\npub mod fmc_insertion;", "cubie module");
  source = replaceOnce(source, "use flate2::read::GzDecoder;", "use cubie_bridge::parse_cubie_state_json;\nuse flate2::read::GzDecoder;", "cubie import");
  const marker = `#[wasm_bindgen]
pub fn search_minmove_bound(search_id: u32, bound: u32, max_nodes: u32) -> String {`;
  const addition = `#[wasm_bindgen]
pub fn prepare_twophase_333_from_cubie_json(cubie_json: &str, options_json: &str) -> String {
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
    let initial_state = match parse_cubie_state_json(cubie_json) {
        Ok(state) => state,
        Err(reason) => {
            return serde_json::to_string(&TwophasePrepareResponse {
                ok: false,
                search_id: None,
                phase1_depth: None,
                phase1_nodes: None,
                candidate_count: None,
                reason: Some(reason),
            })
            .unwrap();
        }
    };
    let options = serde_json::from_str::<TwophasePrepareOptions>(options_json).unwrap_or(
        TwophasePrepareOptions {
            max_phase1_solutions: 12,
            phase1_max_depth: 13,
            phase1_node_limit: 0,
            deadline_ts: f64::INFINITY,
        },
    );
    let _deadline_guard = activate_twophase_deadline(options.deadline_ts);
    match TwophaseSession::prepare_from_state(initial_state, tables, &options) {
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

${marker}`;
  return replaceOnce(source, marker, addition, "cubie prepare export");
});

patch("solver444-wasm/src/api.rs", (source) => {
  source = replaceOnce(source, 'const API_VERSION: &str = "444-reduction-v1";', 'const API_VERSION: &str = "444-complete-v1";', "444 api version");
  const marker = `#[wasm_bindgen]
pub fn solve_444_json(request_json: &str) -> String {`;
  const addition = `#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Verify444Request {
    #[serde(default)]
    scramble: String,
    #[serde(default)]
    solution: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Verify444Response {
    ok: bool,
    solved: bool,
    reason: Option<String>,
    scramble_move_count: usize,
    solution_move_count: usize,
}

pub fn verify_444_solution_boundary(request_json: &str) -> String {
    let request = match serde_json::from_str::<Verify444Request>(request_json) {
        Ok(request) => request,
        Err(error) => {
            return serde_json::to_string(&Verify444Response {
                ok: false,
                solved: false,
                reason: Some(format!("444_VERIFY_INVALID_REQUEST:{error}")),
                scramble_move_count: 0,
                solution_move_count: 0,
            })
            .unwrap();
        }
    };
    let scramble_moves = match parse_alg444(&request.scramble) {
        Ok(moves) => moves,
        Err(error) => {
            return serde_json::to_string(&Verify444Response {
                ok: false,
                solved: false,
                reason: Some(format!("444_VERIFY_INVALID_SCRAMBLE:{error}")),
                scramble_move_count: 0,
                solution_move_count: 0,
            })
            .unwrap();
        }
    };
    let solution_moves = match parse_alg444(&request.solution) {
        Ok(moves) => moves,
        Err(error) => {
            return serde_json::to_string(&Verify444Response {
                ok: false,
                solved: false,
                reason: Some(format!("444_VERIFY_INVALID_SOLUTION:{error}")),
                scramble_move_count: scramble_moves.len(),
                solution_move_count: 0,
            })
            .unwrap();
        }
    };
    let mut state = Cube444::solved();
    state.apply_moves(&scramble_moves);
    state.apply_moves(&solution_moves);
    let valid = state.validate().is_ok();
    serde_json::to_string(&Verify444Response {
        ok: valid,
        solved: valid && state.is_solved(),
        reason: (!valid).then(|| "444_VERIFY_STATE_INVALID".to_string()),
        scramble_move_count: scramble_moves.len(),
        solution_move_count: solution_moves.len(),
    })
    .unwrap()
}

#[wasm_bindgen]
pub fn verify_444_solution_json(request_json: &str) -> String {
    verify_444_solution_boundary(request_json)
}

${marker}`;
  return replaceOnce(source, marker, addition, "444 verify export");
});

patch("solver444-wasm/src/lib.rs", (source) => replaceOnce(
  source,
  "pub use api::{solve_444_boundary, solve_444_json, solver_444_api_version};",
  "pub use api::{\n    solve_444_boundary, solve_444_json, solver_444_api_version,\n    verify_444_solution_boundary, verify_444_solution_json,\n};",
  "444 verify re-export",
));

patch("solver/wasmSolver.js", (source) => {
  const apiMarker = `    prepareTwophase333(scramble, optionsJson) {
      if (typeof mod.prepare_twophase_333 !== "function") return "";
      return mod.prepare_twophase_333(scramble, optionsJson);
    },`;
  source = replaceOnce(source, apiMarker, `${apiMarker}
    prepareTwophase333FromCubie(cubieJson, optionsJson) {
      if (typeof mod.prepare_twophase_333_from_cubie_json !== "function") return "";
      return mod.prepare_twophase_333_from_cubie_json(cubieJson, optionsJson);
    },`, "wasm cubie method");
  const prepareMarker = `export async function searchTwophase333(searchId, options = {}) {`;
  const prepareAddition = `export async function prepareTwophase333FromCubie(cubieState, options = {}) {
  const api = await ensureTwophase333Ready();
  if (!api || typeof api.prepareTwophase333FromCubie !== "function") return null;
  try {
    return parseJsonResponse(api.prepareTwophase333FromCubie(
      JSON.stringify(cubieState || {}),
      JSON.stringify(options || {}),
    ));
  } catch (_) {
    return null;
  }
}

${prepareMarker}`;
  source = replaceOnce(source, prepareMarker, prepareAddition, "cubie prepare wrapper");
  const adaptiveMarker = `/**
 * Solve Phase 2 directly using WASM with (cpIdx, epIdx, sepIdx) coordinates.`;
  const adaptiveAddition = `export async function solveTwophaseAdaptive333FromCubie(cubieState, options = {}) {
  const frontierLimits = Array.from(new Set(
    (Array.isArray(options.frontierLimits) ? options.frontierLimits : [2, 12])
      .map((value) => Math.max(1, Math.floor(Number(value) || 0)))
      .filter((value) => value > 0),
  ));
  const deadlineTs = Number.isFinite(Number(options.deadlineTs))
    ? Number(options.deadlineTs)
    : null;
  const prepareOptions = {
    ...(options.prepareOptions || {}),
    ...(deadlineTs !== null ? { deadlineTs } : {}),
  };
  const searchOptions = {
    ...(options.searchOptions || {}),
    ...(deadlineTs !== null ? { deadlineTs } : {}),
  };
  let lastResult = { ok: false, reason: "TWOPHASE_NOT_ATTEMPTED" };
  for (let index = 0; index < frontierLimits.length; index += 1) {
    const frontierLimit = frontierLimits[index];
    const prepared = await prepareTwophase333FromCubie(cubieState, {
      ...prepareOptions,
      maxPhase1Solutions: frontierLimit,
    });
    if (!prepared?.ok || !Number.isFinite(prepared.searchId)) {
      lastResult = {
        ...(prepared || {}),
        ok: false,
        reason: prepared?.reason || "TWOPHASE_CUBIE_PREPARE_FAILED",
        frontierLimit,
        frontierExpansionCount: index,
      };
      continue;
    }
    let searched = null;
    try {
      searched = await searchTwophase333(prepared.searchId, searchOptions);
    } finally {
      await dropTwophase333Search(prepared.searchId);
    }
    lastResult = {
      ...(searched || {}),
      ok: searched?.ok === true,
      reason: searched?.reason || null,
      frontierLimit,
      frontierExpansionCount: index,
      preparedCandidateCount: prepared.candidateCount ?? null,
    };
    if (lastResult.ok) return lastResult;
    if (!["TWOPHASE_NO_IMPROVING_SOLUTION", "PHASE2_NOT_FOUND"].includes(lastResult.reason)) break;
  }
  return lastResult;
}

${adaptiveMarker}`;
  return replaceOnce(source, adaptiveMarker, adaptiveAddition, "cubie adaptive solver");
});

patch("solver/solver444.js", (source) => {
  source = replaceOnce(
    source,
    `  if (typeof mod.solve_444_json !== "function") {
    recordFailure("module-api", specifier, new Error("SOLVE_444_JSON_EXPORT_MISSING"));
    return null;
  }`,
    `  if (typeof mod.solve_444_json !== "function" || typeof mod.verify_444_solution_json !== "function") {
    recordFailure("module-api", specifier, new Error("SOLVER_444_EXPORT_MISSING"));
    return null;
  }`,
    "444 required exports",
  );
  source = replaceOnce(
    source,
    `    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
    },`,
    `    solve(request) {
      return mod.solve_444_json(JSON.stringify(request));
    },
    verify(request) {
      return mod.verify_444_solution_json(JSON.stringify(request));
    },`,
    "444 verify adapter",
  );
  const tail = `  emitProgress(onProgress, {
    type: result.ok
      ? "444_stage_done"
      : result.status === "partial"
        ? "444_stage_update"
        : "444_stage_fail",
    eventId: "444",
    stage: "REDUCTION",
    reason: result.reason,
    status: result.status,
  });
  return result;
}`;
  const completion = `  if (
    result.status !== "partial" ||
    result.reason !== "444_REDUCTION_INCOMPLETE" ||
    result.meta?.virtual333Ready !== true ||
    !result.meta?.virtual333
  ) {
    emitProgress(onProgress, {
      type: result.ok ? "444_stage_done" : "444_stage_fail",
      eventId: "444",
      stage: "REDUCTION",
      reason: result.reason,
      status: result.status,
    });
    return result;
  }

  emitProgress(onProgress, {
    type: "444_stage_start",
    eventId: "444",
    stage: "THREE_BY_THREE",
    stageName: "3x3 Two-Phase",
  });

  let twophase;
  try {
    const { solveTwophaseAdaptive333FromCubie } = await import("./wasmSolver.js");
    twophase = await solveTwophaseAdaptive333FromCubie(result.meta.virtual333, {
      deadlineTs,
      frontierLimits: [2, 12],
      prepareOptions: {
        phase1MaxDepth: 13,
        phase1NodeLimit: 0,
      },
      searchOptions: {
        phase2MaxDepth: 20,
        phase2NodeLimit: 0,
        strictIncumbent: false,
      },
    });
  } catch (error) {
    twophase = { ok: false, reason: "TWOPHASE_CUBIE_BRIDGE_FAILED", detail: String(error?.message || error) };
  }

  if (!twophase?.ok || !String(twophase.solution || "").trim()) {
    const timedOut = deadlineReached(deadlineTs) || twophase?.reason === "TWOPHASE_DEADLINE_REACHED";
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "THREE_BY_THREE",
      reason: twophase?.reason || "444_TWOPHASE_FAILED",
    });
    return {
      ...result,
      status: timedOut ? "timeout" : "partial",
      reason: timedOut ? "444_DEADLINE_REACHED" : "444_TWOPHASE_FAILED",
      detail: twophase?.reason || twophase?.detail || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        twophaseReason: twophase?.reason || null,
      },
    };
  }

  const threeByThreeStage = {
    id: "threeByThree",
    name: "3x3 Stage",
    solution: String(twophase.solution).trim(),
    moveCount: Number(twophase.moveCount) || String(twophase.solution).trim().split(/\\s+/).filter(Boolean).length,
    verified: false,
  };
  const completeStages = [...result.stages, threeByThreeStage];
  const completeSolution = completeStages
    .map((stage) => String(stage.solution || "").trim())
    .filter(Boolean)
    .join(" ");

  let verification;
  try {
    verification = JSON.parse(String(api.verify({
      scramble: String(scramble || "").trim(),
      solution: completeSolution,
    }) || ""));
  } catch (error) {
    verification = { ok: false, solved: false, reason: String(error?.message || error) };
  }

  if (verification?.ok !== true || verification?.solved !== true) {
    emitProgress(onProgress, {
      type: "444_stage_fail",
      eventId: "444",
      stage: "VERIFY",
      reason: verification?.reason || "444_FINAL_VERIFICATION_FAILED",
    });
    return {
      ...result,
      status: "error",
      reason: "444_FINAL_VERIFICATION_FAILED",
      detail: verification?.reason || null,
      solution: "",
      moveCount: 0,
      verified: false,
      meta: {
        ...result.meta,
        twophaseMoveCount: threeByThreeStage.moveCount,
        fullVerificationSolved: false,
      },
    };
  }

  threeByThreeStage.verified = true;
  const moveCount = completeSolution ? completeSolution.split(/\\s+/).filter(Boolean).length : 0;
  emitProgress(onProgress, {
    type: "444_stage_done",
    eventId: "444",
    stage: "THREE_BY_THREE",
    stageName: "3x3 Stage",
    moveCount: threeByThreeStage.moveCount,
  });
  emitProgress(onProgress, {
    type: "444_stage_done",
    eventId: "444",
    stage: "VERIFY",
    stageName: "Final 96-facelet verification",
    moveCount,
  });
  return {
    ok: true,
    eventId: "444",
    status: "ok",
    reason: null,
    detail: null,
    solution: completeSolution,
    moveCount,
    verified: true,
    stages: completeStages,
    source: "WASM_444_COMPLETE",
    meta: {
      ...result.meta,
      apiVersion: api.version(),
      twophaseMoveCount: threeByThreeStage.moveCount,
      twophaseNodes: Number(twophase.nodes) || 0,
      twophasePhase1Nodes: Number(twophase.phase1Nodes) || 0,
      twophasePhase2Nodes: Number(twophase.phase2Nodes) || 0,
      fullVerificationSolved: true,
    },
  };
}`;
  return replaceOnce(source, tail, completion, "444 complete orchestration");
});

patch("solver/solverWorker.js", (source) => replaceOnce(
  source,
  "const SOLVER_444_BOUNDARY_TIMEOUT_MS = 30000;",
  "const SOLVER_444_BOUNDARY_TIMEOUT_MS = 60000;",
  "444 complete timeout",
));

console.log("Applied complete 4x4 Two-Phase bridge");
