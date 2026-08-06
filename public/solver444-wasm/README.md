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
- `wasm-bindgen` browser exports and absolute-deadline checks
- lazy worker routing, progress, and readiness reporting

## Boundary contract

The engine solves and independently verifies all centers and all twelve edge pairs. It does not claim a complete 4×4 solution until parity normalization and the virtual 3×3 bridge are implemented. A valid request returns `ok: false`, an empty final `solution`, and two verified partial stages:

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
    { "id": "edges", "name": "Edge Pairing", "solution": "...", "verified": true }
  ]
}
```

Each stage is reapplied to the independent 96-facelet model before exposure. Expired deadlines and invalid notation preserve the empty final-result contract. No stage is promoted to a complete solution or fallback.

## Still to implement

- parity normalization
- virtual 3×3 conversion and existing Two-Phase bridge
- final independent full-solution verification
- user-facing 4×4 solver activation

## Build

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
