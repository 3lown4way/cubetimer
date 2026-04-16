// Summer Variation (SV) and Winter Variation (WV) algorithm datasets
// Source: https://speedcubedb.com/a/3x3/SV and https://speedcubedb.com/a/3x3/WV
//
// SV (Summer Variation): Solve the last F2L pair such that all LL edges are
//   already oriented after insertion — enables OLL skip (go directly to PLL).
//   The setup state has an UNORIENTED last F2L edge in the U layer.
//
// WV (Winter Variation): Solve the last F2L pair such that all LL corners are
//   oriented after insertion — enables OLL skip (all top stickers face up).
//   The setup state has the F2L pair connected (corner+edge together) with
//   corner not matching the slot.
//
// Both sets use the FR slot as the reference slot. A "y" rotation maps
// the setup to other F2L slots.
//
// Algorithm format: each entry is the algorithm that SOLVES the case
// (i.e., the inverse of the setup move).

export const SV_FORMULAS = Object.freeze([
  // SV 1  setup: R U R' U2' L U' R U R' L'
  "L R U' R' U L' U2 R U' R'",
  // SV 2  setup: R' U' R U' R' U2' R U' R U' R'
  "R U R' U2 R U R' U R U2 R'",
  // SV 3  setup: R U R D R' U' R D' R' U' R'
  "R U R D R' U R D' R' U' R'",
  // SV 4  setup: L U' R U R' L' U2'
  "U2 L R U' R' U L'",
  // SV 5  setup: L' U' L R U2' L' U' L U R'
  "R U2 R' U' R' F R U R U' R' F'",
  // SV 6  setup: R U R' U R U R'
  "R U' R' U' R U' R'",
  // SV 7  setup: R U' R'
  "R U R'",
  // SV 8  setup: L' R U R' U' L U R U2' R'
  "R U2 R' U' L' U R U' R' L",
  // SV 9  setup: R U R' U L' R U R' U' L R U R'
  "R U' R' L' U R U' R' L U' R U' R'",
  // SV 10 setup: R U2' R' U' R U' R' U R U' R'
  "R U R' U' R U R' U R U2 R'",
  // SV 11 setup: R U2' R' U' R U2' R'
  "L' R U R' U' L",
  // SV 12 setup: R2' U R' U R U' R2' U R U' R U' R2'
  "R2 U R' U R' U' R2 U R' U' R U' R2",
  // SV 13 setup: L' U2' R U R' U' R U' R' L U'
  "U L' R U R' U R U' R' U2 L",
  // SV 14 setup: R' U L U' R2' U R' L' U2'
  "U2 L R U' R2 U L' U' R",
  // SV 15 setup: R U2' R' U' R U R' U' R U2' R'
  "R U2 R' U R U' R' U R U2 R'",
  // SV 16 setup: R2' D R' U2' R D' R' U R'
  "R U' R D R' U2 R D' R2",
  // SV 17 setup: R' U' R U' R' U2' R2' U' R'
  "R U R2 U2 R U R' U R",
  // SV 18 setup: R2' D R' U R D' R' U2' R'
  "R U2 R D R' U' R D' R2",
  // SV 19 setup: L' U' L' U R U' L U L U' R'
  "R U L' U' L' U R' U' L U L",
  // SV 20 setup: R U R' U R U' R' U R U R'
  "R U' R' U' R U R' U' R U' R'",
  // SV 21 setup: R' U2' R2' U R2' U R2' U R'
  "R U' R2 U' R2 U' R2 U2 R",
  // SV 22 setup: R' U2' R U R' U R2' U' R'
  "R U R2 U' R U' R' U2 R",
  // SV 23 setup: R' U2' R U R' U R2' U R' U R U R'
  "R U' R' U' R U' R2 U' R U' R' U2 R",
  // SV 24 setup: R' U2' R U R' U R U' R U' R'
  "R U R' U R' U' R U' R' U2 R",
  // SV 25 setup: R' U' R' D' R U R' D R' U' R'
  "R U R D' R U' R' D R U R",
  // SV 26 setup: R2' D R' U' R D' R' U' R' U
  "U' R U R D R' U R D' R2",
  // SV 27 setup: L R U' R2' U L' U' R
  "R' U L U' R2 U R' L'",
]);

export const WV_FORMULAS = Object.freeze([
  // WV 1  setup: L' U2' R U' R' U2' L U'
  "U L' U2 R U R' U2 L",
  // WV 2  setup: R U R' U'
  "U R U' R'",
  // WV 3  setup: F R U R' U' R' F' R
  "R' F R U R U' R' F'",
  // WV 4  setup: R2' D R' U R D' R2' U'
  "U R2 D R' U' R D' R2",
  // WV 5  setup: R' U2' R U R' U R U' R U R' U'
  "U R U' R' U R' U' R U' R' U2 R",
  // WV 6  setup: R U' R' U2' R U R' U2' R U R'
  "R U' R' U2 R U' R' U2 R U R'",
  // WV 7  setup: R U R' U R U' R' U'
  "U R U R' U' R U' R'",
  // WV 8  setup: R U2' R' U' R U R' U2'
  "U2 R U' R' U R U2 R'",
  // WV 9  setup: R' F' R U2' R U2' R' F U2'
  "U2 F' R U2 R' U2 R' F R",
  // WV 10 setup: F U R U' R' U R U' R2' F' R
  "R' F R2 U' R' U' R U R' U' F'",
  // WV 11 setup: R' U2' R2' U R2' U R U2'
  "U2 R' U' R2 U' R2 U2 R",
  // WV 12 setup: L' U' L U' F2' R' F2' R
  "R' F2 R F2 U L' U L",
  // WV 13 setup: R' U2' R U R' U R2' U2' R' U2'
  "U2 R U2 R2 U' R U' R' U2 R",
  // WV 14 setup: R2' D R' U2' R D' R2' U2'
  "U2 R2 D R' U2 R D' R2",
  // WV 15 setup: L' R U R' U' L
  "L' U R U' R' L",
  // WV 16 setup: R U2' R2' D' R U' R' D R U'
  "U R' D' R U R' D R2 U2 R'",
  // WV 17 setup: F' R U2' R' U2' R' F R
  "R' F' R U2 R U2 R' F",
  // WV 18 setup: R U2' R' U2'
  "U2 R U2 R'",
  // WV 19 setup: F2' R U' R' U R U R2' F2' R
  "R' F2 R2 U' R' U' R U R' F2",
  // WV 20 setup: R U2' R' U' R U R' U' R U R' U2'
  "U2 R U' R' U R U' R' U R U2 R'",
  // WV 21 setup: R' U' R U' R' U2' R2' U R' U'
  "U R U' R2 U2 R U R' U R",
  // WV 22 setup: R2' D R' U2' R D' R' U' R' U'
  "U R U R D R' U2 R D' R2",
  // WV 23 setup: R2' U2' R' U' R' U R U' R U' R2'
  "R2 U R' U R' U' R U R U2 R2",
  // WV 24 setup: R U2' R' U' R U R' U' R U R' U2'
  "U2 R U' R' U R U' R' U R U2 R'",
  // WV 25 setup: R' U' R U' R' U2' R2' U2' R' U2'
  "U2 R U2 R2 U2 R U R' U R",
  // WV 26 setup: R' U2' R U R' U R2' U R' U'
  "U R U' R2 U' R U' R' U2 R",
  // WV 27 setup: R U R' U R U' R' U R U' R' U'
  "U R U R' U' R U R' U' R U' R'",
]);

/**
 * Conjugate a formula string by a y-axis rotation to generate a variant
 * for a different F2L slot. The in-code F2L solver always leaves the BL slot
 * (position 11) as the unsolved 4th pair, while SV/WV formulas are written
 * for the FR slot. A y2 rotation maps FR→BL, so substituting R↔L and F↔B
 * throughout each formula gives algorithms that work in the BL slot.
 *
 * Rotation substitutions:
 *   y:  R→F, F→L, L→B, B→R  (quarter-turn CW from top)
 *   y': R→B, B→L, L→F, F→R  (quarter-turn CCW from top)
 *   y2: R→L, L→R, F→B, B→F  (half-turn — used for BL slot)
 */
function conjugateAlgByY2(alg) {
  // Tokenise: split on whitespace, then map each token
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const suffix = token.endsWith("2") ? "2" : token.endsWith("'") ? "'" : "";
      const face = suffix ? token.slice(0, -suffix.length) : token;
      const map = { R: "L", L: "R", F: "B", B: "F" };
      const newFace = map[face] ?? face;
      return newFace + suffix;
    })
    .join(" ");
}

// BL-slot variants (y2-conjugated): used because the F2L compact solver always
// leaves the BL slot as the unsolved 4th pair (pairs 0=FR, 1=FL, 2=BR solved).
export const SV_BL_FORMULAS = Object.freeze(SV_FORMULAS.map(conjugateAlgByY2));
export const WV_BL_FORMULAS = Object.freeze(WV_FORMULAS.map(conjugateAlgByY2));

export const SV_WV_FORMULA_COUNTS = Object.freeze({
  SV: SV_FORMULAS.length,
  WV: WV_FORMULAS.length,
});
