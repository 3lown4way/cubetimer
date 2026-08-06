# 4×4 solver engine

This directory contains the checked-in browser package generated from `solver444-wasm`.

The current runtime boundary:

- lazily loads only for `eventId === "444"`
- parses WCA-style 4×4 notation
- applies the scramble to the 96-facelet reference model
- validates corner, wing, center, and color inventories
- checks an absolute deadline
- reports readiness and progress events

Search is intentionally not exposed yet. A valid request returns `444_NOT_IMPLEMENTED` with an empty `solution`, `moveCount: 0`, no stages, and no fallback candidate. Expired deadlines return `444_DEADLINE_REACHED` with the same empty-result contract.

The package exports:

```js
solve_444_json(requestJson)
solver_444_api_version()
```

Rebuild from the repository root with:

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
