from pathlib import Path

path = Path("solver-wasm/src/fmc_search.rs")
text = path.read_text()
old = """            candidate.kind,
            candidate.defect_positions,
            candidate.moves.clone(),
"""
new = """            candidate.kind,
            candidate.defect_positions.clone(),
            candidate.moves.clone(),
"""
count = text.count(old)
if count != 1:
    raise RuntimeError(f"expected one defect-position dedup tuple, found {count}")
path.write_text(text.replace(old, new, 1))
