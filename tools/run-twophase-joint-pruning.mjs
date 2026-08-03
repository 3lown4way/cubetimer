import fs from "node:fs";

const patchPath = "tools/apply-twophase-joint-pruning.mjs";
let patchSource = fs.readFileSync(patchPath, "utf8");

const oldNeedle = '    "        slice: slice\\n            .ok_or_else(|| \\\"twophase bundle missing Slice table\\\".to_string())?,\\n        phase2_ep:",';
const newNeedle = '    "        slice: slice.ok_or_else(|| \\\"twophase bundle missing Slice table\\\".to_string())?,\\n        phase2_ep:",';
if (patchSource.includes(oldNeedle)) {
  patchSource = patchSource.replace(oldNeedle, newNeedle);
}
patchSource = patchSource.replace(
  'if (count !== 3) throw new Error(`Expected 3 phase1 heuristic replacements, got ${count}`);',
  'if (count !== 5) throw new Error(`Expected 5 phase1 heuristic replacements, got ${count}`);',
);
fs.writeFileSync(patchPath, patchSource);

await import("./apply-twophase-joint-pruning.mjs");

const searchPath = "solver-wasm/src/twophase_search.rs";
let searchSource = fs.readFileSync(searchPath, "utf8");
searchSource = searchSource.replaceAll(
  "self.phase1_joint_lower_bound(tables,",
  "phase1_joint_lower_bound(self.tables,",
);
if (searchSource.includes("self.phase1_joint_lower_bound(tables,")) {
  throw new Error("Generated joint pruning calls were not repaired");
}
fs.writeFileSync(searchPath, searchSource);
