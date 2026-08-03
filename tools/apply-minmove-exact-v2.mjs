import fs from "node:fs";

const path = "solver/solverWorker.js";
let source = fs.readFileSync(path, "utf8");

const replacement = `    if (normalizedEventId === "333" && mode === "minmove") {
      const { solveMinmoveExactV2 } = await import("./minmoveExactV2.js");
      return solveMinmoveExactV2(scramble, onProgress, {
        timeBudgetMs: 60_000,
      });
    }`;

if (source.includes(replacement)) {
  console.log("minmove exact v2 route already applied");
  process.exit(0);
}

const previousV2Route = `    if (normalizedEventId === "333" && mode === "minmove") {
      const { solveMinmoveExactV2 } = await import("./minmoveExactV2.js");
      return solveMinmoveExactV2(scramble, onProgress, {
        timeBudgetMs: MINMOVE_333_TIMEOUT_MS,
      });
    }`;

if (source.includes(previousV2Route)) {
  source = source.replace(previousV2Route, replacement);
  fs.writeFileSync(path, source);
  console.log("capped minmove exact v2 route at 60 seconds");
  process.exit(0);
}

const legacyPattern = /    if \(normalizedEventId === "333" && mode === "minmove"\) \{[\s\S]*?\n      return minmoveResult;\n    \}/;
const match = source.match(legacyPattern);
if (!match) {
  throw new Error("Could not locate minmove route in solver/solverWorker.js");
}

source = source.replace(legacyPattern, replacement);
fs.writeFileSync(path, source);
console.log("routed minmove to exact two-phase v2");
