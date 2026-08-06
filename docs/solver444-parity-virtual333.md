# 4×4 parity, virtual 3×3, and complete-solution bridge

## Scope

This path starts from the original 96-facelet 4×4 state, completes reduction, solves the resulting legal virtual 3×3 through the existing Two-Phase engine, assembles all stages, and independently verifies the complete sequence on the original 4×4 state.

## Cubie projection

The exported arrays follow the repository's cubing.js order:

- corners: `URF UBR UBL UFL DFR DLF DBL DRB`
- edges: `UF UR UB UL DF DR DB DL FR FL BR BL`
- `cp`: corner permutation
- `co`: corner orientation
- `ep`: edge permutation
- `eo`: edge orientation

The 4×4 decoder rejects duplicate or missing pieces and verifies orientation and permutation-parity invariants. The 3×3 WASM validates the same arrays again at its cubie-input boundary before creating a Two-Phase session.

## Parity signatures

- OLL parity is the oddness of the virtual edge-orientation sum.
- PLL parity is a mismatch between corner-permutation parity and edge-permutation parity.

The solver applies only the required center- and pairing-preserving generators. Each generator is independently checked against the solved 96-facelet model and must have its exact expected signature.

## Move-convention bridge

A permanent cross-engine contract compares all 18 outer turns between the 4×4 projection and cubing.js. Under the repository's fixed coordinate conventions:

- physical 4×4 `U`, `R`, `D`, and `L` quarter turns correspond to inverse cubing.js turns;
- `F` and `B` quarter turns use the same direction;
- all half turns are unchanged.

Two-Phase output is translated through this fixed mapping before it becomes the final 4×4 stage.

## Complete assembly

The final solution is assembled in order:

1. Centers
2. Edge Pairing
3. Parity Normalization
4. 3×3 Stage

The 3×3 stage is initially unverified. The complete algorithm is passed back into `solver444-wasm`, which starts from a solved 96-facelet cube, applies the original scramble, applies the complete solution, validates physical inventories, and requires `is_solved()`.

Only after that independent check passes is the 3×3 stage marked verified and the top-level response promoted to:

```json
{
  "ok": true,
  "status": "ok",
  "reason": null,
  "solution": "...",
  "moveCount": 275,
  "verified": true,
  "meta": {
    "apiVersion": "444-complete-v1",
    "fullVerificationSolved": true
  }
}
```

Any invalid input, deadline, Two-Phase failure, or verification failure preserves the strict no-fallback contract: the final `solution` is empty, `moveCount` is zero, and `verified` is false.
