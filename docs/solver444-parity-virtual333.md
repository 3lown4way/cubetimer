# 4×4 parity normalization and virtual 3×3 projection

## Scope

This stage starts from a 96-facelet state with all centers solved and all twelve wing pairs formed. It detects the two reduction-parity invariants, applies only the required normalizers, and exports a legal 3×3 cubie state. It deliberately stops before the existing Two-Phase search is invoked.

## Cubie projection

Corners are decoded in `URF UFL ULB UBR DFR DLF DBL DRB` order. Edges are decoded in `UR UF UL UB DR DF DL DB FR FL BL BR` order. The projection returns:

- `cp`: corner permutation
- `co`: corner orientation
- `ep`: edge permutation
- `eo`: edge orientation

The decoder rejects duplicate or missing pieces and verifies the corner-orientation sum.

## Parity signatures

- OLL parity is the oddness of the virtual edge-orientation sum.
- PLL parity is a mismatch between corner-permutation parity and edge-permutation parity.

The solver uses two center- and pairing-preserving generators. Each generator is applied to the solved 96-facelet model at runtime and must have the exact expected signature before it may be used:

- OLL generator: `(oll=true, pll=false)`
- PLL generator: `(oll=false, pll=true)`

The required generators are concatenated according to the detected two-bit signature.

## Independent verification

After parity moves are produced, they are reapplied to the original edge-paired 96-facelet state. Exposure requires all of the following:

- all 24 centers remain solved;
- all twelve wing pairs remain paired;
- physical color, corner, wing, and center inventories remain valid;
- the independently reprojected cubie state exactly matches the returned state;
- corner orientation, edge orientation, and permutation-parity invariants are legal for a 3×3.

## Boundary contract

The WASM API version is `444-reduction-v1`. A successful reduction returns three verified partial stages: `centers`, `edges`, and `parity`, plus `meta.virtual333`.

The top-level result remains deliberately incomplete: `ok=false`, `solution=""`, `moveCount=0`, and `verified=false`. No reduction stage is used as a fallback or promoted to a complete 4×4 solution.
