import fs from "node:fs";

const path = "solver/cfop3x3.js";
const source = fs.readFileSync(path, "utf8");
const before = `    if (performanceCollector) {
      performanceCollector.attempts = attempts;
    }
    // Library is comprehensive — state not in map means no formula applies
    return null;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {`;
const after = `    if (performanceCollector) {
      performanceCollector.attempts = attempts;
    }
    // Runtime-built libraries are exhaustive for their exact key function.
    // The precompiled ZB index is an acceleration layer, not a correctness
    // boundary: a missing or stale key must fall through to formula validation.
    if (!library.staticIndex) return null;
  }

  for (let r = 0; r < FORMULA_ROTATIONS.length; r++) {`;

if (source.includes(after)) {
  console.log("ZBLL static-index fallback is already applied.");
  process.exit(0);
}
if (!source.includes(before)) {
  throw new Error("Expected single-stage library early-return block was not found.");
}
const next = source.replace(before, after);
fs.writeFileSync(path, next);
console.log("Applied static ZBLL index fallback to exhaustive formula validation.");
