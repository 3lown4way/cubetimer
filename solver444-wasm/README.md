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

## Boundary contract

The current engine validates the request and scrambled 4×4 state, but it does not claim to solve it yet. A valid request returns:

```json
{
  "ok": false,
  "status": "not_implemented",
  "reason": "444_NOT_IMPLEMENTED",
  "solution": "",
  "moveCount": 0,
  "verified": false,
  "stages": []
}
```

Expired deadlines return `444_DEADLINE_REACHED`; invalid notation returns `444_INVALID_SCRAMBLE`. No candidate or fallback solution is exposed.

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
