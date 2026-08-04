import fs from "node:fs";

const path = "solver-wasm/src/fmc_search.rs";
const before = fs.readFileSync(path, "utf8");
const marker = `fn build_p2_input(state: &CubeState) -> Option<Phase2Input> {
    // Phase 2 coordinates do not encode corner or edge orientation. Never
    // admit an oriented state, otherwise P2 can solve only the permutations
    // and return a false completed FMC pipeline.
    if state.co.iter().any(|&orientation| orientation != 0)
        || state.eo.iter().any(|&orientation| orientation != 0)
    {
        return None;
    }
`;

let source = before;
if (!source.includes(marker)) {
  const anchor = `fn build_p2_input(state: &CubeState) -> Option<Phase2Input> {
`;
  if (!source.includes(anchor)) {
    throw new Error("Missing build_p2_input anchor");
  }
  source = source.replace(anchor, marker);
}

if (!source.includes(marker)) {
  throw new Error("FMC phase2 orientation guard was not applied");
}
if (source !== before) fs.writeFileSync(path, source);
console.log(source === before
  ? "FMC phase2 orientation guard already applied"
  : "Applied FMC phase2 orientation guard");
