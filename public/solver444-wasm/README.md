# 4×4 solver browser package

This checked-in package is generated from `solver444-wasm` and loaded lazily only for `eventId === "444"`.

The current API version is `444-complete-v1`. The 4×4 WASM independently verifies Centers, Edge Pairing, Parity Normalization, virtual 3×3 projection, and the final assembled solution against the original 96-facelet state. The existing 3×3 WASM is loaded only after reduction and solves the exported `cp/co/ep/eo` state through Two-Phase.

A top-level solution is exposed only when final 96-facelet verification reports solved. Invalid, timed-out, incomplete, or verification-failed requests retain an empty final solution and `verified: false`.

Rebuild with:

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
