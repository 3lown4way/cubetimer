# 4×4 state engine

This crate is the correctness-first foundation for the cubetimer 4×4 reduction solver.

## Included in this slice

- 96-facelet state in `U R F D L B` order
- outer and two-layer wide turns for all six faces
- normal, prime, and half-turn amounts
- WCA-style `Rw` notation and lowercase wide aliases
- move permutation generation from fixed 3D sticker coordinates
- color, corner, wing, and center inventory validation
- deterministic long-sequence inverse and invariant tests

## Deliberately not included yet

- worker routing for `eventId === "444"`
- browser WASM bindings or generated artifacts
- center search
- edge pairing
- parity normalization
- virtual 3×3 conversion
- UI exposure

The reference facelet model remains the independent verifier when later search code introduces compact center, wing, and corner coordinates.
