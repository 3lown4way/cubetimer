import assert from "node:assert/strict";
import { isTrivialReverseScrambleSolution } from "./solver/fmcSolver.js";

const LONG_SCRAMBLE = "B2 L2 D2 F2 R2 U2 B' L' D' F' R' U'";

const cases = [
  {
    name: "exact inverse",
    scramble: "R U D R'",
    solution: "R D' U' R'",
    expected: true,
  },
  {
    name: "opposite-face commuting inverse",
    scramble: "R U D R'",
    solution: "R U' D' R'",
    expected: true,
  },
  {
    name: "WCA four-move inverse prefix",
    scramble: LONG_SCRAMBLE,
    solution: "U R F D R' F' U'",
    expected: true,
  },
  {
    name: "three-move inverse prefix remains legal",
    scramble: LONG_SCRAMBLE,
    solution: "U R F L B U' R'",
    expected: false,
  },
  {
    name: "six-move internal inverse block",
    scramble: LONG_SCRAMBLE,
    solution: "R2 F2 R F D L B U2 L'",
    expected: true,
  },
  {
    name: "five-move internal overlap remains legal",
    scramble: LONG_SCRAMBLE,
    solution: "R2 F2 R F D L B L'",
    expected: false,
  },
  {
    name: "near-total inverse derivation split into short blocks",
    scramble: LONG_SCRAMBLE,
    solution: "U' R F D L B U' R2 F2 D2 L2 B2",
    expected: true,
  },
  {
    name: "independent NISS-style path",
    scramble: LONG_SCRAMBLE,
    solution: "U' R' F' D' L' B' U R2 F' D2 L' B2",
    expected: false,
  },
]

for (const testCase of cases) {
  assert.equal(
    isTrivialReverseScrambleSolution(testCase.scramble, testCase.solution),
    testCase.expected,
    testCase.name,
  );
}

console.log(`FMC reverse-scramble guard: ${cases.length}/${cases.length} cases passed`);
