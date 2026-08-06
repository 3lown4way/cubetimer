import fs from "node:fs";

const path = "solver/solverWorker.js";
let source = fs.readFileSync(path, "utf8");
const before = `    startBackgroundWarmups();\n    if (normalizedEventId === "444") {`;
const after = `    if (normalizedEventId === "444") {`;
const count = source.split(before).length - 1;
if (count !== 1) {
  throw new Error(`expected one pre-4x4 warmup, found ${count}`);
}
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Removed pre-4x4 background warmup");
