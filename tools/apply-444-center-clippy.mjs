import fs from "node:fs";

const path = "solver444-wasm/src/centers.rs";
let source = fs.readFileSync(path, "utf8");
const before = "fn descend_single(\n";
const after = "// The phase descriptor is intentionally explicit at this correctness boundary.\n#[allow(clippy::too_many_arguments)]\nfn descend_single(\n";
if (!source.includes(after)) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`descend_single target count: ${count}`);
  source = source.replace(before, after);
  fs.writeFileSync(path, source);
}
console.log("Applied scoped Clippy allowance for center phase descent");
