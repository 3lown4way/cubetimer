# 4×4 solver browser package

This checked-in package is generated from `solver444-wasm` and loaded lazily only for `eventId === "444"`.

The current API version is `444-reduction-v1`. It independently verifies Centers, Edge Pairing, Parity Normalization, and a legal virtual 3×3 `cp/co/ep/eo` projection. The top-level result remains partial with an empty final solution until the Two-Phase cubie bridge and final 96-facelet verification are complete.

Rebuild with:

```bash
wasm-pack build solver444-wasm \
  --target web \
  --out-dir ../public/solver444-wasm \
  --out-name solver444_wasm \
  --release
```
