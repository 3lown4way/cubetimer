import fs from "node:fs";

const path = "solver/solverWorker.js";
let source = fs.readFileSync(path, "utf8");

const replacement = `    if (normalizedEventId === "333" && mode === "minmove") {
      const { solveMinmoveExactV2 } = await import("./minmoveExactV2.js");
      return solveMinmoveExactV2(scramble, onProgress, {
        timeBudgetMs: MINMOVE_333_TIMEOUT_MS,
      });
    }`;

if (source.includes(replacement)) {
  console.log("minmove exact v2 route already applied");
  process.exit(0);
}

const pattern = /    if \(normalizedEventId === "333" && mode === "minmove"\) \{[\s\S]*?\n      return minmoveResult;\n    \}/;
const match = source.match(pattern);
if (!match) {
  throw new Error("Could not locate minmove route in solver/solverWorker.js");
}

source = source.replace(pattern, replacement);
fs.writeFileSync(path, source);
console.log("routed minmove to exact two-phase v2");
