import fs from "node:fs/promises";

async function patchFile(path, transform) {
  const original = await fs.readFile(path, "utf8");
  const updated = transform(original);
  if (updated === original) {
    console.log(`${path}: no changes`);
    return false;
  }
  await fs.writeFile(path, updated, "utf8");
  console.log(`${path}: patched`);
  return true;
}

function insert2x2Verifier(source) {
  if (source.includes("async function verify2x2Solution(")) return source;
  const marker = "async function verify3x3Solution(scramble, solution) {";
  if (!source.includes(marker)) {
    throw new Error("SOLVER_WORKER_VERIFY_MARKER_NOT_FOUND");
  }
  const verifier = `async function verify2x2Solution(scramble, solution) {
  try {
    const { getDefaultPattern } = await import("./context.js");
    const solvedPattern = await getDefaultPattern("222");
    const scrambledPattern = scramble ? solvedPattern.applyAlg(scramble) : solvedPattern;
    const afterSolution = solution ? scrambledPattern.applyAlg(solution) : scrambledPattern;
    return typeof afterSolution.experimentalIsSolved === "function"
      ? !!afterSolution.experimentalIsSolved({ ignorePuzzleOrientation: false })
      : JSON.stringify(afterSolution.patternData) === JSON.stringify(solvedPattern.patternData);
  } catch (_) {
    return false;
  }
}

`;
  return source.replace(marker, verifier + marker);
}

function replace2x2Orchestrator(source) {
  const pattern = /async function solveWithInternal2x2\(scramble\) \{[\s\S]*?\n\}\n\nasync function solveWithInternal3x3StrictCfop/;
  if (!pattern.test(source)) {
    if (source.includes('source: "JS_2X2_FALLBACK"')) return source;
    throw new Error("SOLVER_WORKER_2X2_BLOCK_NOT_FOUND");
  }
  const replacement = `async function solveWithInternal2x2(scramble) {
  const wasmResult = await solveWithWasmIfAvailableLazy(scramble, "222");
  if (wasmResult?.ok && (await verify2x2Solution(scramble, wasmResult.solution))) {
    return {
      ok: true,
      solution: wasmResult.solution,
      moveCount: wasmResult.moveCount,
      nodes: wasmResult.nodes ?? 0,
      bound: wasmResult.bound ?? 0,
      source: "WASM_2X2",
    };
  }

  const fallbackReason = wasmResult?.ok
    ? "WASM_2X2_INVALID_SOLUTION"
    : String(wasmResult?.reason || "WASM_2X2_UNAVAILABLE");

  if (!solver2x2ModulesPromise) {
    solver2x2ModulesPromise = import("./solver2x2.js");
  }
  const { solve2x2Scramble } = await solver2x2ModulesPromise;
  const result = await solve2x2Scramble(scramble);
  if (!result) {
    return { ok: false, reason: "NO_SOLUTION", fallbackReason };
  }
  if (!(await verify2x2Solution(scramble, result.solution))) {
    return { ok: false, reason: "JS_2X2_INVALID_SOLUTION", fallbackReason };
  }
  return {
    ok: true,
    solution: result.solution,
    moveCount: result.moveCount,
    nodes: result.nodes ?? 0,
    bound: result.bound ?? 0,
    source: "JS_2X2_FALLBACK",
    fallbackReason,
  };
}

async function solveWithInternal3x3StrictCfop`;
  return source.replace(pattern, replacement);
}

function patchRustLibrary(source) {
  let updated = source;
  updated = updated.replace(
    "static mut PRUNE: Option<ida::PruneTables> = None;",
    "static PRUNE: Lazy<ida::PruneTables> = Lazy::new(build_prune_tables);",
  );
  updated = updated.replace(
    "    let prune = unsafe { PRUNE.get_or_insert_with(|| build_prune_tables()) };",
    "    let prune = &*PRUNE;",
  );

  const solvePattern = /fn solve_2x2\(_scramble: String\) -> String \{[\s\S]*?\n\}\n\nfn path_to_strings/;
  if (!solvePattern.test(updated)) {
    if (updated.includes("INTERNAL_2X2_INVALID_SOLUTION")) return updated;
    throw new Error("RUST_SOLVE_2X2_BLOCK_NOT_FOUND");
  }
  const solveReplacement = `fn solve_2x2(scramble: String) -> String {
    let prune = &*PRUNE;

    let moves = match parser::parse_scramble(&scramble) {
        Some(value) => value,
        None => return error_resp("BAD_SCRAMBLE_OR_UNSUPPORTED_2X2_MOVE".into()),
    };
    let state = parser::apply_scramble_to_solved(&moves);
    if let Some(path) = ida_solve(state, 11, prune) {
        let final_state = path
            .iter()
            .fold(state, |current, &move_index| current.apply_move(move_index));
        if final_state != state::State::solved() {
            return error_resp("INTERNAL_2X2_INVALID_SOLUTION".into());
        }
        let solution_moves = path_to_strings(path);
        return serde_json::to_string(&SolveResponse {
            ok: true,
            solution: solution_moves.join(" "),
            move_count: solution_moves.len() as u32,
            reason: None,
        })
        .unwrap();
    }
    error_resp("NO_SOLUTION".into())
}

fn path_to_strings`;
  return updated.replace(solvePattern, solveReplacement);
}

let changed = false;
changed = (await patchFile("solver/solverWorker.js", (source) => replace2x2Orchestrator(insert2x2Verifier(source)))) || changed;
changed = (await patchFile("solver-wasm/src/lib.rs", patchRustLibrary)) || changed;
console.log(changed ? "2x2 safety patch applied" : "2x2 safety patch already applied");
