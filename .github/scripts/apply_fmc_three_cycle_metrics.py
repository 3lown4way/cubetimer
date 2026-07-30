from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()
text = replace_once(
    text,
    "pub struct FmcResult {\n"
    "    pub ok: bool,\n"
    "    pub candidates: Vec<FmcCandidate>,\n"
    "    pub skeletons: Vec<FmcSkeletonCandidate>,\n"
    "}\n",
    "pub struct FmcResult {\n"
    "    pub ok: bool,\n"
    "    pub candidates: Vec<FmcCandidate>,\n"
    "    pub skeletons: Vec<FmcSkeletonCandidate>,\n"
    "    pub insertion_candidate_count: usize,\n"
    "}\n",
    "FmcResult metric field",
)
text = replace_once(
    text,
    "                candidates: vec![],\n"
    "                skeletons: vec![],\n",
    "                candidates: vec![],\n"
    "                skeletons: vec![],\n"
    "                insertion_candidate_count: 0,\n",
    "error result metric",
)
text = replace_once(
    text,
    "    let inserted_candidates = optimize_skeleton_insertions(\n"
    "        &original_scramble_state,\n"
    "        &skeletons,\n"
    "        tables,\n"
    "        fmc_tables,\n"
    "    );\n"
    "    all_candidates.extend(inserted_candidates);\n",
    "    let inserted_candidates = optimize_skeleton_insertions(\n"
    "        &original_scramble_state,\n"
    "        &skeletons,\n"
    "        tables,\n"
    "        fmc_tables,\n"
    "    );\n"
    "    let insertion_candidate_count = inserted_candidates.len();\n"
    "    all_candidates.extend(inserted_candidates);\n",
    "insertion count capture",
)
text = replace_once(
    text,
    "        candidates: all_candidates,\n"
    "        skeletons,\n"
    "    }\n",
    "        candidates: all_candidates,\n"
    "        skeletons,\n"
    "        insertion_candidate_count,\n"
    "    }\n",
    "final result metric",
)
path.write_text(text)

lib_path = Path("solver-wasm/src/lib.rs")
lib = lib_path.read_text()
lib = replace_once(
    lib,
    "        \"skeletonCount\": skeletons_json.len(),\n"
    "        \"skeletons\": skeletons_json,\n",
    "        \"skeletonCount\": skeletons_json.len(),\n"
    "        \"skeletons\": skeletons_json,\n"
    "        \"insertionCandidateCount\": result.insertion_candidate_count,\n",
    "WASM insertion metric",
)
lib_path.write_text(lib)
