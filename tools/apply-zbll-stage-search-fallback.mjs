import fs from "node:fs";

const path = "solver/cfop3x3.js";
const source = fs.readFileSync(path, "utf8");
const before = `      searchMaxDepth: normalizeDepth(
        options.zbllSearchMaxDepth,
        useZbLL ? 10 : profile.pllMaxDepth,
      ),
      nodeLimit: normalizeDepth(options.zbllNodeLimit, useZbLL ? 180000 : 0),
      // Pure ZB: ZBLL must match the case library; missing case fails fast.
      disableSearchFallback: useZbLL,`;
const after = `      searchMaxDepth: normalizeDepth(
        options.zbllSearchMaxDepth,
        useZbLL ? 14 : profile.pllMaxDepth,
      ),
      nodeLimit: normalizeDepth(options.zbllNodeLimit, useZbLL ? 2500000 : 0),
      // Pure ZB keeps the formula database as the primary path. If both the
      // precompiled index and exhaustive formula validation miss, finish the
      // already-oriented last layer with the stage-local face-turn search.
      disableSearchFallback: false,`;

if (source.includes(after)) {
  console.log("ZBLL stage-search fallback is already applied.");
  process.exit(0);
}
if (!source.includes(before)) {
  throw new Error("Expected Pure ZB stage-4 fallback block was not found.");
}
fs.writeFileSync(path, source.replace(before, after));
console.log("Enabled stage-local ZBLL search fallback.");
