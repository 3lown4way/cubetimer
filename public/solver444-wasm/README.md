# 4×4 solver engine

This crate is the correctness-first 96-facelet foundation and browser verification boundary for the cubetimer 4×4 solver.

## Available now

- 96-facelet reference state in `U R F D L B` order
- outer and two-layer wide turns for all six faces
- WCA-style `Rw` notation and lowercase wide aliases
- color, corner, wing, and center inventory validation
- four exact center pruning coordinates with 753,311 total abstract states
- independently verified Centers stage generation
- oriented 24-wing coordinate derived from the 96-facelet geometry
- eight sequential exact edge-pair distance tables
- exact 40,320-state last-four-edge handling
- independently verified Edge Pairing stage generation
- zero-move return when all twelve dedges are already paired
- OLL and PLL reduction-parity detection and normalization
- virtual 3×3 export in cubing.js-compatible `cp/co/ep/eo` order
- complete-solution verification against the original 96-facelet state
- `wasm-bindgen` browser exports and absolute-deadline checks

## Complete solver architecture

The full browser solver uses two lazy WASM modules:

1. `solver444-wasm` produces and independently verifies Centers, Edge Pairing, Parity Normalization, and the virtual 3×3 cubie state.
2. The existing `solver-wasm` Two-Phase engine accepts that validated cubie state directly and solves the virtual 3×3.
3. JavaScript translates the fixed move-convention difference, assembles all four stages, and asks `solver444-wasm` to reapply the original scramble and complete solution.
4. `ok: true` is returned only when all 96 facelets are solved.

The public API version is `444-complete-v1`.

A successful result has four verified stages:

```json
{
  "ok": true,
  "status": "ok",
  "reason": null,
  "solution": "...",
  "moveCount": 275,
  "verified": true,
  "stages": [
    { "id": "centers", "name": "Centers", "verified": true },
    { "id": "edges", "name": "Edge Pairing", "verified": true },
    { "id": "parity", "name": "Parity Normalization", "verified": true },
    { "id": "threeByThree", "name": "3x3 Stage", "verified": true }
  ],
  "meta": {
    "apiVersion": "444-complete-v1",
    "virtual333Ready": true,
    "fullVerificationSolved": true
  }
}
```

Invalid notation, expired deadlines, Two-Phase failure, or final verification failure preserve the strict contract: no unverified final solution is exposed. The top-level `solution` remains empty and `verified` remains false.

## Convention contract

The virtual cubie arrays use the repository's cubing.js order:

- corners: `URF UBR UBL UFL DFR DLF DBL DRB`
- edges: `UF UR UB UL DF DR DB DL FR FL BR BL`

The permanent cross-engine test checks all 18 outer turns. Physical 4×4 quarter turns on `U`, `R`, `D`, and `L` correspond to the inverse cubing.js turn; `F` and `B` use the same direction; half turns are unchanged. Two-Phase output is translated by this fixed mapping before final 96-facelet verification.

## Still to implement

- user-facing 4×4 solver activation
- stage-oriented 4×4 solver UI and 3D playback polish
- shorter center/edge reduction algorithms
- broader performance and random-scramble benchmarking

## Build

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
