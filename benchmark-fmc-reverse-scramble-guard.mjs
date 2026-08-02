import assert from "node:assert/strict";
import { isTrivialReverseScrambleSolution } from "./solver/fmcSolver.js";

const cases = [
  {
    name: "exact inverse",
    scramble: "R U D R'",
    solution: "R D' U' R'",
    expected: true,
  },
  {
    name: "opposite-face commuting notation",
    scramble: "R U D R'",
    solution: "R U' D' R'",
    expected: true,
  },
  {
    name: "same-face cancellation across commuting opposite face",
    scramble: "D' R",
    solution: "R' U D U'",
    expected: true,
  },
  {
    name: "genuine different solution",
    scramble: "R U D R'",
    solution: "R U' D2 R'",
    expected: false,
  },
];

for (const testCase of cases) {
  assert.equal(
    isTrivialReverseScrambleSolution(testCase.scramble, testCase.solution),
    testCase.expected,
    testCase.name,
  );
}

console.log(`FMC reverse-scramble guard: ${cases.length}/${cases.length} cases passed`);
