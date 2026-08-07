import assert from "node:assert/strict";

import { puzzles } from "../vendor/cubing/puzzles/index.js";
import { solveLlDeferred444 } from "../solver/llParity444.js";

const OLL_PARITY = "Rw' U2 Rw U2 Rw' F2 Rw2 U2 Rw U2 Rw' U2 F2 Rw2 F2";
const PLL_PARITY = "Rw2 R2 U2 Rw2 R2 Uw2 Rw2 R2 Uw2";
const cases = [
  { name: "OLL", scramble: OLL_PARITY, oll: true, pll: false },
  { name: "PLL", scramble: PLL_PARITY, oll: false, pll: true },
  { name: "OLL+PLL", scramble: `${OLL_PARITY} ${PLL_PARITY}`, oll: true, pll: true },
];
const crossColors = ["D", "F", "R"];
const kp444 = await puzzles["4x4x4"].kpuzzle();

for (const parityCase of cases) {
  for (const crossColor of crossColors) {
    const result = await solveLlDeferred444({
      scramble: parityCase.scramble,
      crossColor,
      deadlineTs: Date.now() + 30_000,
    });
    assert.equal(
      result.ok,
      true,
      `${parityCase.name}/${crossColor} failed: ${result.reason || "unknown"}`,
    );
    const names = result.segments.map((stage) => stage.name);
    const ollIndex = names.indexOf("OLL");
    const pllIndex = names.indexOf("PLL");
    const ollParityIndex = names.indexOf("OLL Parity");
    const pllParityIndex = names.indexOf("PLL Parity");
    assert.ok(ollIndex >= 0, `${parityCase.name}/${crossColor} missing OLL`);
    assert.ok(pllIndex > ollIndex, `${parityCase.name}/${crossColor} missing PLL after OLL`);
    assert.equal(ollParityIndex >= 0, parityCase.oll, `${parityCase.name}/${crossColor} OLL parity mismatch`);
    assert.equal(pllParityIndex >= 0, parityCase.pll, `${parityCase.name}/${crossColor} PLL parity mismatch`);
    if (ollParityIndex >= 0) assert.ok(ollParityIndex < ollIndex, "OLL parity must be handled before OLL");
    if (pllParityIndex >= 0) {
      assert.ok(pllParityIndex > ollIndex, "PLL parity must be judged after OLL");
      assert.ok(pllParityIndex < pllIndex, "PLL parity must be handled before PLL");
    }
    assert.equal(result.ollParityDetected, parityCase.oll);
    assert.equal(result.pllParityDetected, parityCase.pll);

    const solved = kp444.defaultPattern().applyAlg(parityCase.scramble).applyAlg(result.solution);
    assert.equal(
      solved.experimentalIsSolved({ ignorePuzzleOrientation: false }),
      true,
      `${parityCase.name}/${crossColor} public sequence did not solve`,
    );
  }
}

console.log("4x4 LL-time OLL/PLL parity regression passed");
