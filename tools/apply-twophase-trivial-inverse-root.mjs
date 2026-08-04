import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceRange(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Missing ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const rustPath = "solver-wasm/src/twophase_search.rs";
let rust = fs.readFileSync(rustPath, "utf8");
rust = replaceOnce(
  rust,
  `pub struct TwophaseSearchOptions {
    #[serde(rename = "incumbentLength")]
    pub incumbent_length: Option<u8>,
    #[serde(rename = "phase2MaxDepth", default = "default_phase2_max_depth")]
    pub phase2_max_depth: u8,
    #[serde(rename = "phase2NodeLimit", default)]
    pub phase2_node_limit: u64,
}`,
  `pub struct TwophaseSearchOptions {
    #[serde(rename = "incumbentLength")]
    pub incumbent_length: Option<u8>,
    #[serde(rename = "excludedSolution", default)]
    pub excluded_solution: Option<String>,
    #[serde(rename = "strictIncumbent", default)]
    pub strict_incumbent: bool,
    #[serde(rename = "phase2MaxDepth", default = "default_phase2_max_depth")]
    pub phase2_max_depth: u8,
    #[serde(rename = "phase2NodeLimit", default)]
    pub phase2_node_limit: u64,
}`,
  "TwophaseSearchOptions",
);

rust = replaceOnce(
  rust,
  `    phase2_nodes: &mut u64,
) {`,
  `    phase2_nodes: &mut u64,
    excluded_path: Option<&[u8]>,
) {`,
  "phase2 pass signature",
);

rust = replaceOnce(
  rust,
  `        let total = full_path.len();
        if best_found_total.map_or(true, |best_total| total < best_total) {`,
  `        let total = full_path.len();
        if excluded_path.map_or(false, |excluded| full_path.as_slice() == excluded) {
            continue;
        }
        if best_found_total.map_or(true, |best_total| total < best_total) {`,
  "excluded path filter",
);

rust = replaceOnce(
  rust,
  `        let mut best_found_total: Option<usize> = None;
        let mut phase2_nodes = 0u64;

        run_phase2_pass(`,
  `        let mut best_found_total: Option<usize> = None;
        let mut phase2_nodes = 0u64;
        let excluded_path = options
            .excluded_solution
            .as_deref()
            .and_then(|solution| parse_scramble(solution, &tables.move_data).ok());

        run_phase2_pass(`,
  "excluded path parsing",
);

rust = replaceOnce(
  rust,
  `            &mut best_phase2_depth,
            &mut phase2_nodes,
        );
        if best_found_total.is_none() {
            run_phase2_pass(`,
  `            &mut best_phase2_depth,
            &mut phase2_nodes,
            excluded_path.as_deref(),
        );
        if best_found_total.is_none() && !options.strict_incumbent {
            run_phase2_pass(`,
  "strict first pass",
);

rust = replaceOnce(
  rust,
  `                &mut best_phase2_depth,
                &mut phase2_nodes,
            );
        }

        if let Some(path) = best_path {`,
  `                &mut best_phase2_depth,
                &mut phase2_nodes,
                excluded_path.as_deref(),
            );
        }

        if let Some(path) = best_path {`,
  "unconstrained pass exclusion",
);

rust = replaceOnce(
  rust,
  `            reason: "PHASE2_NOT_FOUND".into(),`,
  `            reason: if options.strict_incumbent && options.incumbent_length.is_some() {
                "TWOPHASE_NO_IMPROVING_SOLUTION".into()
            } else {
                "PHASE2_NOT_FOUND".into()
            },`,
  "strict search reason",
);
fs.writeFileSync(rustPath, rust);

const libPath = "solver-wasm/src/lib.rs";
let lib = fs.readFileSync(libPath, "utf8");
lib = replaceOnce(
  lib,
  `        TwophaseSearchOptions {
            incumbent_length: None,
            phase2_max_depth: 20,
            phase2_node_limit: 0,
        },`,
  `        TwophaseSearchOptions {
            incumbent_length: None,
            excluded_solution: None,
            strict_incumbent: false,
            phase2_max_depth: 20,
            phase2_node_limit: 0,
        },`,
  "TwophaseSearchOptions fallback",
);
fs.writeFileSync(libPath, lib);

const wasmPath = "solver/wasmSolver.js";
let wasm = fs.readFileSync(wasmPath, "utf8");
const adaptiveMarker = "export async function solveTwophaseAdaptive333";
if (!wasm.includes(adaptiveMarker)) {
  const insertionPoint = wasm.indexOf("/**\n * Solve Phase 2 directly using WASM", wasm.indexOf("export async function dropTwophase333Search"));
  if (insertionPoint < 0) throw new Error("Missing adaptive insertion point");
  const adaptive = `export async function solveTwophaseAdaptive333(scramble, options = {}) {
  const frontierLimits = Array.from(new Set(
    (Array.isArray(options.frontierLimits) ? options.frontierLimits : [2])
      .map((value) => Math.max(1, Math.floor(Number(value) || 0)))
      .filter((value) => value > 0),
  ));
  const prepareOptions = options.prepareOptions || {};
  const searchOptions = options.searchOptions || {};
  let lastResult = { ok: false, reason: "TWOPHASE_NOT_ATTEMPTED" };

  for (let index = 0; index < frontierLimits.length; index += 1) {
    const frontierLimit = frontierLimits[index];
    const prepared = await prepareTwophase333(scramble, {
      ...prepareOptions,
      maxPhase1Solutions: frontierLimit,
    });
    if (!prepared?.ok || !Number.isFinite(prepared.searchId)) {
      lastResult = {
        ...(prepared || {}),
        ok: false,
        reason: prepared?.reason || "TWOPHASE_PREPARE_FAILED",
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
    if (lastResult.reason !== "TWOPHASE_NO_IMPROVING_SOLUTION") break;
  }

  return lastResult;
}

`;
  wasm = wasm.slice(0, insertionPoint) + adaptive + wasm.slice(insertionPoint);
}
fs.writeFileSync(wasmPath, wasm);

const workerPath = "solver/solverWorker.js";
let worker = fs.readFileSync(workerPath, "utf8");
worker = replaceOnce(
  worker,
  `const TWOPHASE_333_V2_MAX_FRONTIERS = 2;`,
  `const TWOPHASE_333_V2_MAX_FRONTIERS = 2;
const TWOPHASE_333_V2_EXPANDED_FRONTIERS = 12;
const TWOPHASE_333_V2_MAX_FRONTIERS_HARD = 48;`,
  "adaptive frontier constants",
);
worker = replaceOnce(
  worker,
  `async function searchTwophaseExact333Lazy(scramble, options) {
  const { searchTwophaseExact333 } = await getWasmSolverModule();
  return searchTwophaseExact333(scramble, options);
}
`,
  `async function searchTwophaseExact333Lazy(scramble, options) {
  const { searchTwophaseExact333 } = await getWasmSolverModule();
  return searchTwophaseExact333(scramble, options);
}

async function solveTwophaseAdaptive333Lazy(scramble, options) {
  const { solveTwophaseAdaptive333 } = await getWasmSolverModule();
  return solveTwophaseAdaptive333(scramble, options);
}
`,
  "adaptive lazy loader",
);

const blockStart = `  let twophaseSearchId = null;
  try {`;
const blockEnd = `

  if (!phaseResult?.ok && noFallback) {`;
const adaptiveWorkerBlock = `  try {
    const wasmReady = await ensureTwophase333ReadyLazy().catch(() => null);
    if (wasmReady) {
      const v2Strict = noFallback && normalizeSolverVersion(solverVersion) === "v2";
      const frontierLimits = v2Strict
        ? [
            TWOPHASE_333_V2_MAX_FRONTIERS,
            TWOPHASE_333_V2_EXPANDED_FRONTIERS,
            TWOPHASE_333_V2_MAX_FRONTIERS_HARD,
          ]
        : [maxFrontiers];
      const searched = await withTimeout(
        solveTwophaseAdaptive333Lazy(scramble, {
          frontierLimits,
          prepareOptions: {
            phase1MaxDepth: INTERNAL_PHASE_FALLBACK_OPTIONS.phase1MaxDepth,
            phase1NodeLimit: INTERNAL_PHASE_FALLBACK_OPTIONS.phase1NodeLimit,
          },
          searchOptions: {
            incumbentLength:
              inverseLength > 0 ? inverseLength + (noFallback ? 1 : 0) : undefined,
            excludedSolution: noFallback ? inverseSolution : undefined,
            strictIncumbent: noFallback,
            phase2MaxDepth: INTERNAL_PHASE_FALLBACK_OPTIONS.phase2MaxDepth,
            phase2NodeLimit: INTERNAL_PHASE_FALLBACK_OPTIONS.phase2NodeLimit,
          },
        }),
        TWOPHASE_333_TIMEOUT_MS,
      ).catch(() => null);
      if (searched) {
        phaseResult = searched;
        if (searched.ok) phaseSource = "WASM_3X3_TWOPHASE";
      }
    }
  } catch (_) {}`;
worker = replaceRange(worker, blockStart, blockEnd, adaptiveWorkerBlock, "worker two-phase WASM block");
worker = replaceOnce(
  worker,
  `  if (!phaseResult?.ok && noFallback) {
    phaseResult = { ok: false, reason: "TWOPHASE_WASM_FAILED_NO_FALLBACK" };
  }`,
  `  if (!phaseResult?.ok && noFallback) {
    phaseResult = {
      ...(phaseResult || {}),
      ok: false,
      reason: phaseResult?.reason || "TWOPHASE_WASM_FAILED_NO_FALLBACK",
    };
  }`,
  "preserve strict failure reason",
);
worker = replaceOnce(
  worker,
  `  if (noFallback && inverseSolution && solution === inverseSolution) {
    return { ok: false, reason: "TWOPHASE_TRIVIAL_INVERSE_REJECTED", source: phaseSource };
  }`,
  `  if (noFallback && inverseSolution && solution === inverseSolution) {
    return { ok: false, reason: "TWOPHASE_STRICT_EXCLUSION_VIOLATION", source: phaseSource };
  }`,
  "strict exclusion invariant",
);
fs.writeFileSync(workerPath, worker);

const benchmarkFixedPath = "benchmark/benchmark-fixed.js";
let benchmarkFixed = fs.readFileSync(benchmarkFixedPath, "utf8");
benchmarkFixed = benchmarkFixed.replace(
  `import "./benchmark-twophase-reliability.js?v=20260803-0834";\n`,
  "",
);
fs.writeFileSync(benchmarkFixedPath, benchmarkFixed);

console.log("Applied adaptive nontrivial two-phase search at the solver boundary");
