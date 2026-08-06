# 4×4 solver browser package

This directory contains the checked-in browser package generated from `solver444-wasm`.

## Available now

- lazy loading only for `eventId === "444"`
- WCA-style 4×4 scramble parsing
- 96-facelet state application and physical inventory validation
- four exact center pruning coordinates with 753,311 total abstract states
- independently verified Centers stage generation
- a deterministic center-stage upper bound of 31 HTM moves
- absolute deadline, readiness, and progress reporting

## Boundary contract

The current package solves and verifies all 24 centers, but it does not claim to solve the full 4×4 yet. A valid request returns `ok: false`, an empty final `solution`, and one verified partial stage:

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

- edge pairing and last-two-edge handling
- parity normalization
- virtual 3×3 conversion and existing Two-Phase bridge
- final independent full-solution verification
- user-facing 4×4 solver activation

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
