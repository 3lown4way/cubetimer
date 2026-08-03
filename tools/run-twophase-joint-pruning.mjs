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
let repairedCalls = 0;
searchSource = searchSource.replace(
  /self\s*\.\s*phase1_joint_lower_bound\s*\(\s*tables\s*,/g,
  () => {
    repairedCalls += 1;
    return "phase1_joint_lower_bound(self.tables,";
  },
);
if (repairedCalls !== 2) {
  throw new Error(`Expected to repair 2 generated joint-pruning calls, repaired ${repairedCalls}`);
}
if (/self\s*\.\s*phase1_joint_lower_bound\s*\(\s*tables\s*,/.test(searchSource)) {
  throw new Error("Generated joint pruning calls were not fully repaired");
}
fs.writeFileSync(searchPath, searchSource);
console.log(`repaired ${repairedCalls} generated joint-pruning calls`);
