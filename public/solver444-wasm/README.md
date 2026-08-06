# 4×4 solver browser package

This directory contains the checked-in browser package generated from `solver444-wasm`.

## Available now

- lazy loading only for `eventId === "444"`
- WCA-style 4×4 parsing and 96-facelet physical validation
- exact and independently verified Centers stage
- exact sequential edge pairing with a 40,320-state last-four-edge table
- independently verified Edge Pairing stage, including L2E handling
- absolute deadline, readiness, and progress reporting

## Boundary contract

The package returns two verified partial stages while keeping the final 4×4 result closed:

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

The partial stages are never promoted to a complete solution or fallback. Parity normalization, virtual 3×3 conversion, the Two-Phase bridge, and final full-solution verification remain closed.

## Exports

```js
solve_444_json(requestJson)
solver_444_api_version()
```

## Rebuild

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
