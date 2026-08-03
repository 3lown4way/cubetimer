import fs from "node:fs";

const path = "solver-wasm/Cargo.toml";
let source = fs.readFileSync(path, "utf8");
const binBlock = `[[bin]]
name = "build_minmove_tables"
path = "src/build_minmove_tables_main.rs"

`;
if (!source.includes('name = "build_minmove_tables"')) {
  const marker = "[profile.release]\n";
  const index = source.indexOf(marker);
  if (index < 0) throw new Error("Cargo profile marker not found");
  source = source.slice(0, index) + binBlock + source.slice(index);
  fs.writeFileSync(path, source);
}
console.log("Registered tracked minmove table builder.");
