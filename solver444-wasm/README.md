# 4×4 solver engine

This crate is the correctness-first foundation and browser boundary for the cubetimer 4×4 reduction solver.

## Available now

- 96-facelet reference state in `U R F D L B` order
- outer and two-layer wide turns for all six faces
- WCA-style `Rw` notation and lowercase wide aliases
- color, corner, wing, and center inventory validation
- four exact center pruning coordinates with 753,311 total abstract states
- independently verified Centers stage generation
- oriented 24-wing coordinate derived from the 96-facelet geometry
- eight sequential exact edge-pair distance tables
- an exact 40,320-state last-four-edge table, including L2E handling
- independently verified Edge Pairing stage generation
- OLL and PLL parity detection from projected cubie invariants
- two independently verified center- and pairing-preserving parity generators
- legal virtual 3×3 export in `cp/co/ep/eo` cubie coordinates
- `wasm-bindgen` browser exports and absolute-deadline checks
- lazy worker routing, progress, and readiness reporting

## Boundary contract

The engine solves and independently verifies all centers, all twelve edge pairs, parity normalization, and the legal virtual 3×3 projection. It does not claim a complete 4×4 solution until the virtual cubie state is solved through the existing Two-Phase engine and the complete move sequence is independently verified on the original 96-facelet state.

A valid request therefore returns `ok: false`, an empty final `solution`, and three verified partial stages:

```json
{
  "ok": false,
  "status": "partial",
  "reason": "444_REDUCTION_INCOMPLETE",
  "solution": "",
  "moveCount": 0,
  "verified": false,
  "stages": [
    { "id": "centers", "name": "Centers", "solution": "...", "verified": true },
    { "id": "edges", "name": "Edge Pairing", "solution": "...", "verified": true },
    { "id": "parity", "name": "Parity Normalization", "solution": "...", "verified": true }
  ],
  "meta": {
    "apiVersion": "444-reduction-v1",
    "virtual333Ready": true,
    "virtual333": {
      "cp": [0, 1, 2, 3, 4, 5, 6, 7],
      "co": [0, 0, 0, 0, 0, 0, 0, 0],
      "ep": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      "eo": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }
  }
}
```

Each stage is reapplied to the independent 96-facelet model before exposure. The exported cubie state is projected again from that verified state and must satisfy corner orientation, edge orientation, and permutation-parity invariants. Expired deadlines and invalid notation preserve the empty final-result contract. No stage is promoted to a complete solution or fallback.

## Still to implement

- existing Two-Phase search from the exported cubie coordinates
- complete 4×4 move-sequence assembly
- final independent 96-facelet solved-state verification
- user-facing 4×4 solver activation

## Build

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
