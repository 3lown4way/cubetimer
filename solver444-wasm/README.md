# 4×4 solver engine

This crate is the correctness-first foundation and browser boundary for the cubetimer 4×4 reduction solver.

## Available now

- 96-facelet reference state in `U R F D L B` order
- outer and two-layer wide turns for all six faces
- normal, prime, and half-turn amounts
- WCA-style `Rw` notation and lowercase wide aliases
- move permutations generated from fixed 3D sticker coordinates
- color, corner, wing, and center inventory validation
- deterministic long-sequence inverse and invariant tests
- `wasm-bindgen` browser exports
- absolute-deadline checks around parsing and state validation
- lazy worker routing for `eventId === "444"`
- progress and readiness reporting
- four exact center pruning coordinates with 753,311 total abstract states
- independently verified Centers stage generation

## Boundary contract

The current engine solves and verifies all 24 centers, but it does not claim to solve the full 4×4 yet. A valid request returns `ok: false`, an empty final `solution`, and one verified partial stage:

```json
{
  "ok": false,
  "status": "partial",
  "reason": "444_REDUCTION_INCOMPLETE",
  "solution": "",
  "moveCount": 0,
  "verified": false,
  "stages": [
    {
      "id": "centers",
      "name": "Centers",
      "solution": "...",
      "moveCount": 24,
      "verified": true
    }
  ]
}
```

Expired deadlines return `444_DEADLINE_REACHED`; invalid notation returns `444_INVALID_SCRAMBLE`. The verified center stage is never promoted to a complete solution or fallback.

## Still to implement

- center search
- edge pairing
- parity normalization
- virtual 3×3 conversion and existing Two-Phase bridge
- final independent solution verification
- user-facing 4×4 solver activation

The reference facelet model remains the independent verifier when later search code introduces compact center, wing, and corner coordinates.

## Build

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
