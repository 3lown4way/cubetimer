import fs from "node:fs";

const path = "solver-wasm/src/fmc_search.rs";
const before = fs.readFileSync(path, "utf8");
let source = before;

const helperMarker = "fn merge_fmc_result_frontier(";
if (!source.includes(helperMarker)) {
  const anchor = `fn fmc_result_best_move_count(result: &FmcResult) -> usize {
    result
        .candidates
        .iter()
        .map(|candidate| candidate.moves.len())
        .min()
        .unwrap_or(usize::MAX)
}
`;
  const helper = `${anchor}
fn merge_fmc_result_frontier(base: &mut FmcResult, mut extra: FmcResult) {
    base.candidates.append(&mut extra.candidates);
    base.candidates.sort_by_key(|candidate| {
        (
            candidate.moves.len(),
            candidate.skeleton_kind.is_none(),
            candidate.source_tag,
            candidate.axis,
        )
    });
    let mut seen = std::collections::HashSet::new();
    base.candidates
        .retain(|candidate| seen.insert(candidate.moves.clone()));
    base.candidates.truncate(32);

    base.skeletons.append(&mut extra.skeletons);
    base.skeletons.truncate(FMC_SKELETON_BEAM_LIMIT * 2);
    base.insertion_candidate_count = base
        .insertion_candidate_count
        .saturating_add(extra.insertion_candidate_count);
    base.mixed_insertion_candidate_count = base
        .mixed_insertion_candidate_count
        .saturating_add(extra.mixed_insertion_candidate_count);
    base.multi_insertion_candidate_count = base
        .multi_insertion_candidate_count
        .saturating_add(extra.multi_insertion_candidate_count);
    base.multi_insertion_transition_count = base
        .multi_insertion_transition_count
        .saturating_add(extra.multi_insertion_transition_count);
    base.multi_insertion_pair_count = base
        .multi_insertion_pair_count
        .saturating_add(extra.multi_insertion_pair_count);
    base.slice_insertion_candidate_count = base
        .slice_insertion_candidate_count
        .saturating_add(extra.slice_insertion_candidate_count);
    base.multi_switch_niss_candidate_count = base
        .multi_switch_niss_candidate_count
        .saturating_add(extra.multi_switch_niss_candidate_count);
    base.reverse_scramble_rejected_count = base
        .reverse_scramble_rejected_count
        .saturating_add(extra.reverse_scramble_rejected_count);
    base.ok = !base.candidates.is_empty();
}
`;
  if (!source.includes(anchor)) throw new Error("Missing FMC best-count helper anchor");
  source = source.replace(anchor, helper);
}

source = source.replace(
  `    if !primary.ok {
        return primary;
    }

    let mut best_result = primary;`,
  `    let mut best_result = primary;`,
);

source = source.replace(
  `    if search_level >= 3 && best_count > FMC_EXTREME_RETRY_TARGET {`,
  `    if search_level >= 3 && (!best_result.ok || best_count > FMC_EXTREME_RETRY_TARGET) {`,
);
source = source.replace(
  `        if secondary_variant.ok && secondary_count < best_count {
            best_result = secondary_variant;
            best_count = secondary_count;
        }`,
  `        if secondary_variant.ok {
            merge_fmc_result_frontier(&mut best_result, secondary_variant);
            best_count = fmc_result_best_move_count(&best_result);
        }`,
);

source = source.replace(
  `    if search_level >= 3 && best_count > FMC_EXTREME_SUB20_TARGET {`,
  `    if search_level >= 3 && (!best_result.ok || best_count > FMC_EXTREME_SUB20_TARGET) {`,
);
source = source.replace(
  `        if sub20_variant.ok && sub20_count < best_count {
            best_result = sub20_variant;
        }`,
  `        if sub20_variant.ok {
            merge_fmc_result_frontier(&mut best_result, sub20_variant);
        }`,
);

if (!source.includes(helperMarker)) throw new Error("FMC variant merge helper was not applied");
if (!source.includes("merge_fmc_result_frontier(&mut best_result, secondary_variant)")) {
  throw new Error("FMC secondary variant merge was not applied");
}
if (!source.includes("merge_fmc_result_frontier(&mut best_result, sub20_variant)")) {
  throw new Error("FMC sub-20 variant merge was not applied");
}

if (source !== before) fs.writeFileSync(path, source);
console.log(source === before ? "FMC variant frontier merge already applied" : "Applied FMC variant frontier merge");
