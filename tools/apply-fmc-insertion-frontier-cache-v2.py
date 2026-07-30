from pathlib import Path

path = Path("solver-wasm/src/fmc_insertion.rs")
text = path.read_text(encoding="utf-8")

replacements = [
    (
        "type InsertionCache = HashMap<(StateKey, StateKey, u8, u8), Option<Vec<u8>>>;\n\nfn find_shorter_segment(",
        "type InsertionCache = HashMap<(StateKey, StateKey, u8, u8), Option<Vec<u8>>>;\n"
        "type FrontierCache = HashMap<(StateKey, u8, bool), HashMap<StateKey, Vec<u8>>>;\n\n"
        "fn find_shorter_segment(",
    ),
    (
        "    cache: &mut InsertionCache,\n    move_face_table: &[u8],",
        "    cache: &mut InsertionCache,\n"
        "    frontier_cache: &mut FrontierCache,\n"
        "    move_face_table: &[u8],",
    ),
    (
        "    let fwd_map = bfs_frontier(start, fwd_depth, false, move_face_table, move_data);\n"
        "    let bwd_map = bfs_frontier(target, bwd_depth, true, move_face_table, move_data);\n\n"
        "    let mut best: Option<Vec<u8>> = None;\n"
        "    for (key, left) in &fwd_map {\n"
        "        if let Some(right) = bwd_map.get(key) {",
        "    let fwd_cache_key = (sk, fwd_depth, false);\n"
        "    if let Entry::Vacant(entry) = frontier_cache.entry(fwd_cache_key) {\n"
        "        entry.insert(bfs_frontier(\n"
        "            start,\n"
        "            fwd_depth,\n"
        "            false,\n"
        "            move_face_table,\n"
        "            move_data,\n"
        "        ));\n"
        "    }\n\n"
        "    let bwd_cache_key = (tk, bwd_depth, true);\n"
        "    if let Entry::Vacant(entry) = frontier_cache.entry(bwd_cache_key) {\n"
        "        entry.insert(bfs_frontier(\n"
        "            target,\n"
        "            bwd_depth,\n"
        "            true,\n"
        "            move_face_table,\n"
        "            move_data,\n"
        "        ));\n"
        "    }\n\n"
        "    let fwd_map = frontier_cache\n"
        "        .get(&fwd_cache_key)\n"
        "        .expect(\"forward frontier inserted\");\n"
        "    let bwd_map = frontier_cache\n"
        "        .get(&bwd_cache_key)\n"
        "        .expect(\"backward frontier inserted\");\n\n"
        "    let mut best: Option<Vec<u8>> = None;\n"
        "    for (key, left) in fwd_map {\n"
        "        if let Some(right) = bwd_map.get(key) {",
    ),
    (
        "    // Per-call MITM cache to avoid recomputing identical (start, target) pairs across passes\n"
        "    let mut cache: InsertionCache = HashMap::new();",
        "    // Per-call caches preserve exact path ordering while reusing repeated half-frontiers.\n"
        "    let mut cache: InsertionCache = HashMap::new();\n"
        "    let mut frontier_cache: FrontierCache = HashMap::new();",
    ),
    (
        "                &mut cache,\n                move_face_table,",
        "                &mut cache,\n"
        "                &mut frontier_cache,\n"
        "                move_face_table,",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match, found {count}: {old[:80]!r}")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print(f"patched {path}")
