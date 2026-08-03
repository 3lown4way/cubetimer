import fs from "node:fs";

const path = "tools/apply-twophase-joint-pruning.mjs";
let source = fs.readFileSync(path, "utf8");
const oldNeedle = '    "        slice: slice\\n            .ok_or_else(|| \\\"twophase bundle missing Slice table\\\".to_string())?,\\n        phase2_ep:",';
const newNeedle = '    "        slice: slice.ok_or_else(|| \\\"twophase bundle missing Slice table\\\".to_string())?,\\n        phase2_ep:",';
if (source.includes(oldNeedle)) {
  source = source.replace(oldNeedle, newNeedle);
  fs.writeFileSync(path, source);
}
await import("./apply-twophase-joint-pruning.mjs");
