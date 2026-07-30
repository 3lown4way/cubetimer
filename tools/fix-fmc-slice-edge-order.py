from pathlib import Path

path = Path(__file__).resolve().parents[1] / "solver-wasm" / "src" / "fmc_search.rs"
text = path.read_text()
old = '''    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 10), (9, 11)], // E2
        1 => [(1, 5), (3, 7)],   // M2
        2 => [(0, 6), (2, 4)],   // S2
        _ => unreachable!(),
    };'''
new = '''    // Repository edge order: UF, UR, UB, UL, DF, DR, DB, DL, FR, FL, BR, BL.
    let swaps: [(usize, usize); 2] = match axis {
        0 => [(8, 11), (9, 10)], // E2: FR↔BL, FL↔BR
        1 => [(0, 6), (2, 4)],   // M2: UF↔DB, UB↔DF
        2 => [(1, 7), (3, 5)],   // S2: UR↔DL, UL↔DR
        _ => unreachable!(),
    };'''
if text.count(old) != 1:
    raise SystemExit(f"slice swap block: expected one match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("Corrected FMC slice edge ordering")
