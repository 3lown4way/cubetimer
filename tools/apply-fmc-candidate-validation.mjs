import fs from "node:fs";

const path = "solver-wasm/src/fmc_search.rs";
const before = fs.readFileSync(path, "utf8");
let source = before;

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

if (!source.includes("fn fmc_candidate_solves_scramble")) {
  replaceOnce(
    `fn relative_cube_state(from: &CubeState, to: &CubeState) -> CubeState {
    compose_cube_states(&invert_cube_state(from), to)
}
`,
    `fn relative_cube_state(from: &CubeState, to: &CubeState) -> CubeState {
    compose_cube_states(&invert_cube_state(from), to)
}

fn fmc_candidate_solves_scramble(
    scramble_state: &CubeState,
    moves: &[u8],
    tables: &TwophaseTables,
) -> bool {
    !moves.is_empty()
        && scramble_state
            .apply_moves(moves, &tables.move_data)
            .is_solved()
}
`,
    "FMC candidate validation helper",
  );

  replaceOnce(
    `                    // NISS premove: solution = inv(pipeline) + inv(premoves)
                    let mut full = invert_moves(&original);
                    full.extend_from_slice(&invert_moves(pm_set));
                    let simplified = simplify_moves(&full);
                    if !simplified.is_empty() && simplified.len() <= raw_exploration_limit {
                        all_candidates.push(FmcCandidate {`,
    `                    // A premove on the inverse scramble changes which side of the
                    // flattened NISS sequence receives the inverse premove. Prefer the
                    // algebraic order, but verify against the original scramble and use
                    // the alternate flattening only when it is the exact valid one.
                    let inverse_pipeline = invert_moves(&original);
                    let inverse_premoves = invert_moves(pm_set);
                    let mut full = inverse_pipeline.clone();
                    full.extend_from_slice(&inverse_premoves);
                    let mut simplified = simplify_moves(&full);
                    if !fmc_candidate_solves_scramble(
                        &original_scramble_state,
                        &simplified,
                        tables,
                    ) {
                        let mut alternate = inverse_premoves;
                        alternate.extend_from_slice(&inverse_pipeline);
                        let alternate = simplify_moves(&alternate);
                        if !fmc_candidate_solves_scramble(
                            &original_scramble_state,
                            &alternate,
                            tables,
                        ) {
                            continue;
                        }
                        simplified = alternate;
                    }
                    if simplified.len() <= raw_exploration_limit {
                        all_candidates.push(FmcCandidate {`,
    "premove NISS flattening validation",
  );

  replaceOnce(
    `    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    let multi_switch_niss_candidate_count = all_candidates`,
    `    // Premove and NISS flattening are composition-sensitive. Reject any
    // completed candidate before it can seed relocation skeletons or insertion.
    all_candidates.retain(|candidate| {
        fmc_candidate_solves_scramble(&original_scramble_state, &candidate.moves, tables)
    });

    reverse_scramble_rejected_count +=
        retain_nontrivial_reverse_candidates(&mut all_candidates, &reverse_scramble_canonical);

    let multi_switch_niss_candidate_count = all_candidates`,
    "post-premove candidate validation",
  );

  replaceOnce(
    `    all_candidates.extend(inserted_candidates);
    all_candidates.extend(multi_inserted_candidates);

    // Sort by final move count, preferring an insertion result on exact ties.`,
    `    all_candidates.extend(inserted_candidates);
    all_candidates.extend(multi_inserted_candidates);

    // Final integrity boundary: no candidate reaches the UI unless applying it
    // after the original scramble produces the solved state exactly.
    all_candidates.retain(|candidate| {
        fmc_candidate_solves_scramble(&original_scramble_state, &candidate.moves, tables)
    });

    // Sort by final move count, preferring an insertion result on exact ties.`,
    "final candidate validation",
  );
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before ? "FMC candidate validation already applied" : "Applied exact FMC candidate validation");
