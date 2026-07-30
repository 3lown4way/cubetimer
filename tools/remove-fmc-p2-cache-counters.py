from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
source = path.read_text(encoding="utf-8")
replacements = {
    "    lookups: u64,\n    hits: u64,\n    searches: u64,\n": "",
    "        self.lookups += 1;\n": "",
    "                self.hits += 1;\n": "",
    "            self.hits += 1;\n": "",
    "        self.searches += 1;\n": "",
    "\n    let _p2_cache_stats = (p2_cache.lookups, p2_cache.hits, p2_cache.searches);\n": "",
}
for old, new in replacements.items():
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"unexpected count for {old!r}: {count}")
    source = source.replace(old, new, 1)
path.write_text(source, encoding="utf-8")
