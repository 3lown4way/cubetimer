import fs from "node:fs";

const wasmPath = "solver/wasmSolver.js";
const rustPath = "solver-wasm/src/fmc_search.rs";

function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

let wasmSource = fs.readFileSync(wasmPath, "utf8");
const wasmBefore = wasmSource;

const helperMarker = "function buildVerifiedPremoveNissAlternates(candidate)";
if (!wasmSource.includes(helperMarker)) {
  const helperAnchor = `/**
 * Run the full FMC pipeline (EO→DR→P2, 3 axes, NISS, premove sweep) entirely in WASM.`;
  const helpers = `function normalizeFmcMoveTokens(value) {
  if (Array.isArray(value)) return value.map((move) => String(move || "").trim()).filter(Boolean);
  return String(value || "").trim().split(/\\s+/).filter(Boolean);
}

function invertFmcMoveToken(token) {
  const value = String(token || "").trim();
  if (!value || value.endsWith("2")) return value;
  return value.endsWith("'") ? value.slice(0, -1) : value + "'";
}

function invertFmcMoveSequence(tokens) {
  return normalizeFmcMoveTokens(tokens).reverse().map(invertFmcMoveToken);
}

function simplifyFmcMoveSequence(tokens) {
  const output = [];
  for (const rawToken of normalizeFmcMoveTokens(tokens)) {
    const match = /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(rawToken);
    if (!match) {
      output.push(rawToken);
      continue;
    }
    const face = match[1];
    const amount = match[2] === "2" ? 2 : match[2] === "'" ? 3 : 1;
    const previous = output[output.length - 1];
    const previousMatch = previous ? /^([URFDLBMESxyzurfdlb])(2|')?$/.exec(previous) : null;
    if (!previousMatch || previousMatch[1] !== face) {
      output.push(rawToken);
      continue;
    }
    const previousAmount = previousMatch[2] === "2" ? 2 : previousMatch[2] === "'" ? 3 : 1;
    const combined = (previousAmount + amount) % 4;
    output.pop();
    if (combined === 1) output.push(face);
    else if (combined === 2) output.push(face + "2");
    else if (combined === 3) output.push(face + "'");
  }
  return output;
}

function buildVerifiedPremoveNissAlternates(candidate) {
  const source = String(candidate?.source || "");
  if (!/^FMC_(?:HTR_)?PREMOVE_NISS_/.test(source)) return [];

  const pipeline = [
    ...normalizeFmcMoveTokens(candidate?.eoMoves),
    ...normalizeFmcMoveTokens(candidate?.drMoves),
    ...normalizeFmcMoveTokens(candidate?.finishMoves),
  ];
  const premoves = normalizeFmcMoveTokens(candidate?.premoves);
  if (pipeline.length === 0 || premoves.length === 0) return [];

  const inversePipeline = invertFmcMoveSequence(pipeline);
  const inversePremoves = invertFmcMoveSequence(premoves);
  const current = String(candidate?.solution || "").trim();
  const seen = new Set(current ? [current] : []);
  const alternatives = [];
  for (const tokens of [
    [...inversePremoves, ...inversePipeline],
    [...inversePipeline, ...inversePremoves],
  ]) {
    const simplified = simplifyFmcMoveSequence(tokens);
    const solution = simplified.join(" ");
    if (!solution || seen.has(solution)) continue;
    seen.add(solution);
    alternatives.push({ solution, moves: simplified, moveCount: simplified.length });
  }
  return alternatives;
}

`;
  const anchorIndex = wasmSource.indexOf(helperAnchor);
  if (anchorIndex < 0) throw new Error("Missing solveFmcWasm helper anchor");
  wasmSource = wasmSource.slice(0, anchorIndex) + helpers + wasmSource.slice(anchorIndex);
}

const enhancedMarker = "repairedPremoveNissCandidateCount";
if (!wasmSource.includes(enhancedMarker)) {
  const validationStart = wasmSource.indexOf(
    "    // The public FMC verifier is the source of truth for the exact solution",
  );
  const validationEndMarker = `  } catch (err) {
    console.warn("[solveFmcWasm] error:", err);`;
  const validationEnd = wasmSource.indexOf(validationEndMarker, validationStart);
  if (validationStart < 0 || validationEnd < 0) {
    throw new Error("Missing existing FMC candidate validation boundary");
  }

  const validationBlock = `    // The public FMC verifier is the source of truth for the exact solution
    // string returned to callers. Rust now validates candidates before ranking,
    // while this boundary remains a final defence and can repair legacy raw
    // premove-NISS candidates from their stage metadata.
    if (
      typeof api.verifyFmcSolutionWasm !== "function" ||
      !Array.isArray(parsed.candidates)
    ) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_CANDIDATE_VERIFIER_UNAVAILABLE",
        solution: "",
        moveCount: 0,
        candidates: [],
      };
    }

    const verifyCandidateSolution = (solution) => {
      if (!solution) return false;
      try {
        const verifyRaw = api.verifyFmcSolutionWasm(String(scramble), String(solution));
        const verification = typeof verifyRaw === "string" ? JSON.parse(verifyRaw) : verifyRaw;
        return verification?.ok === true && verification.solved === true;
      } catch (_) {
        return false;
      }
    };

    const validCandidates = [];
    const seenSolutions = new Set();
    let invalidCandidateCount = 0;
    let repairedPremoveNissCandidateCount = 0;
    for (const candidate of parsed.candidates) {
      const originalSolution = String(candidate?.solution || "").trim();
      let accepted = null;
      if (verifyCandidateSolution(originalSolution)) {
        accepted = candidate;
      } else {
        invalidCandidateCount += 1;
        for (const alternate of buildVerifiedPremoveNissAlternates(candidate)) {
          if (!verifyCandidateSolution(alternate.solution)) continue;
          accepted = {
            ...candidate,
            solution: alternate.solution,
            moves: alternate.moves,
            moveCount: alternate.moveCount,
            repairedPremoveNissOrder: true,
          };
          repairedPremoveNissCandidateCount += 1;
          break;
        }
      }
      if (!accepted) continue;
      const solution = String(accepted.solution || "").trim();
      if (!solution || seenSolutions.has(solution)) continue;
      seenSolutions.add(solution);
      validCandidates.push(accepted);
    }

    validCandidates.sort((left, right) =>
      Number(left?.moveCount || 0) - Number(right?.moveCount || 0),
    );
    if (validCandidates.length === 0) {
      return {
        ...parsed,
        ok: false,
        reason: "FMC_NO_VERIFIED_SOLUTION",
        solution: "",
        moveCount: 0,
        candidates: [],
        invalidCandidateCount,
        repairedPremoveNissCandidateCount,
      };
    }

    const best = validCandidates[0];
    return {
      ...parsed,
      solution: String(best.solution),
      moveCount: Number(best.moveCount || 0),
      candidates: validCandidates,
      invalidCandidateCount,
      repairedPremoveNissCandidateCount,
    };
`;
  wasmSource =
    wasmSource.slice(0, validationStart) +
    validationBlock +
    wasmSource.slice(validationEnd);
}

if (wasmSource !== wasmBefore) fs.writeFileSync(wasmPath, wasmSource);

let rustSource = fs.readFileSync(rustPath, "utf8");
const rustBefore = rustSource;

const rustRepairMarker = "Premove-NISS composition is verified in both plausible orders";
if (!rustSource.includes(rustRepairMarker)) {
  const oldComposition = `                    // NISS premove: solution = inv(pipeline) + inv(premoves)
                    let mut full = invert_moves(&original);
                    full.extend_from_slice(&invert_moves(pm_set));
                    let simplified = simplify_moves(&full);
                    if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
                        all_candidates.push(FmcCandidate {`;
  const newComposition = `                    // Premove-NISS composition is verified in both plausible orders.
                    // Axis conjugation and the state multiplication convention make a
                    // comment-only algebraic assumption too fragile here; use the same
                    // solved-up-to-rotation contract as the public verifier instead.
                    let inverse_pipeline = invert_moves(&original);
                    let inverse_premoves = invert_moves(pm_set);
                    let mut full = inverse_pipeline.clone();
                    full.extend_from_slice(&inverse_premoves);
                    let mut simplified = simplify_moves(&full);
                    let mut premove_first = false;
                    let mut valid_solution = !simplified.is_empty()
                        && is_fmc_solved_up_to_rotation(
                            &original_scramble_state.apply_moves(&simplified, &tables.move_data),
                            tables,
                        );
                    if !valid_solution {
                        let mut alternate = inverse_premoves.clone();
                        alternate.extend_from_slice(&inverse_pipeline);
                        let alternate = simplify_moves(&alternate);
                        if !alternate.is_empty()
                            && is_fmc_solved_up_to_rotation(
                                &original_scramble_state
                                    .apply_moves(&alternate, &tables.move_data),
                                tables,
                            )
                        {
                            simplified = alternate;
                            premove_first = true;
                            valid_solution = true;
                        }
                    }
                    if !valid_solution {
                        continue;
                    }
                    if simplified.len() <= raw_exploration_limit {
                        all_candidates.push(FmcCandidate {`;
  rustSource = replaceOnce(
    rustSource,
    oldComposition,
    newComposition,
    "premove-NISS candidate composition",
  );

  const oldSkeleton = `                    for prefix in skeleton_prefixes {
                        let mut full_prefix = invert_moves(&cvt(&prefix.moves));
                        full_prefix.extend_from_slice(&invert_moves(pm_set));
                        if let Some(candidate) = build_skeleton_candidate(`;
  const newSkeleton = `                    for prefix in skeleton_prefixes {
                        let inverse_prefix = invert_moves(&cvt(&prefix.moves));
                        let mut full_prefix = if premove_first {
                            inverse_premoves.clone()
                        } else {
                            inverse_prefix.clone()
                        };
                        if premove_first {
                            full_prefix.extend_from_slice(&inverse_prefix);
                        } else {
                            full_prefix.extend_from_slice(&inverse_premoves);
                        }
                        if let Some(candidate) = build_skeleton_candidate(`;
  rustSource = replaceOnce(
    rustSource,
    oldSkeleton,
    newSkeleton,
    "premove-NISS skeleton composition",
  );
}

const rustFilterMarker = "Final candidate validity must be established before the top-10 cut";
if (!rustSource.includes(rustFilterMarker)) {
  const sortAnchor = `    // Sort by final move count, preferring an insertion result on exact ties.`;
  const validityFilter = `    // Final candidate validity must be established before the top-10 cut.
    // Otherwise several short malformed NISS candidates can crowd a valid
    // slightly longer human solution out of the returned frontier.
    all_candidates.retain(|candidate| {
        !candidate.moves.is_empty()
            && is_fmc_solved_up_to_rotation(
                &original_scramble_state.apply_moves(&candidate.moves, &tables.move_data),
                tables,
            )
    });

`;
  const sortIndex = rustSource.indexOf(sortAnchor);
  if (sortIndex < 0) throw new Error("Missing FMC final sort anchor");
  rustSource = rustSource.slice(0, sortIndex) + validityFilter + rustSource.slice(sortIndex);
}

if (rustSource !== rustBefore) fs.writeFileSync(rustPath, rustSource);

const changed = wasmSource !== wasmBefore || rustSource !== rustBefore;
console.log(changed ? "Applied FMC candidate repair and validation" : "FMC candidate repair and validation already applied");
