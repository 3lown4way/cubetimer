import assert from "node:assert/strict";
import { buildFmcWasmQualityStages } from "./solver/fmcSolver.js";

const common = {
  extremeVariantCount: 24,
  extremeReservedCompressionPremoves: 24,
  enableCoverageFallback: false,
};
const round0 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 0 }, 180, false);
const round1 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 1 }, 180, false);
const round2 = buildFmcWasmQualityStages("extreme", { ...common, extremeRound: 2 }, 180, false);

assert.equal(round0.length, 24);
assert.equal(round0[0].name, "human-L3-V7-reserved");
assert.equal(round0[0].options.maxPremoveSets, 24);
assert.equal(round1.length, 24);
assert.equal(round2.length, 24);
assert.ok(round1.every((stage) => stage.options.searchLevel === 3));
assert.ok(round1.every((stage) => stage.options.maxPremoveSets === 180));
assert.ok(round1.every((stage) => stage.options.rawExplorationLimit === 36));
assert.ok(round1.every((stage) => stage.options.reservedCompression === false));
assert.ok(round2.every((stage) => stage.options.searchLevel === 3));
assert.ok(round2.every((stage) => stage.options.maxPremoveSets === 180));
assert.ok(round2.every((stage) => stage.options.rawExplorationLimit === 36));
assert.ok(round2.every((stage) => stage.options.reservedCompression === false));
assert.ok(round1.every((stage) => stage.name.includes("-R1-")));
assert.ok(round2.every((stage) => stage.name.includes("-R2-")));

const variants0 = new Set(round0.map((stage) => stage.options.searchVariant));
const variants1 = new Set(round1.map((stage) => stage.options.searchVariant));
const variants2 = new Set(round2.map((stage) => stage.options.searchVariant));
assert.equal(variants0.size, 24);
assert.equal(variants1.size, 24);
assert.equal(variants2.size, 24);
assert.equal([...variants0].some((variant) => variants1.has(variant)), false);
assert.equal([...variants1].some((variant) => variants2.has(variant)), false);
assert.equal(new Set(round1.map((stage) => stage.options.bucketName)).size, 24);
assert.deepEqual(
  new Set(round1.map((stage) => stage.options.bucketName)),
  new Set(round2.map((stage) => stage.options.bucketName)),
);

console.log(JSON.stringify({
  round0First: round0[0].name,
  round1First: round1[0].name,
  round2First: round2[0].name,
  round1VariantRange: [Math.min(...variants1), Math.max(...variants1)],
  round2VariantRange: [Math.min(...variants2), Math.max(...variants2)],
}));
