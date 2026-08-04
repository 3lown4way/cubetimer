import fs from "node:fs";

for (const path of ["solver-wasm/src/fmc_search.rs", "solver-wasm/src/fmc_insertion.rs"]) {
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  console.log(`FMC_MOVE_ORDER_AUDIT_BEGIN:${path}`);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      /MOVE_INVERSE|TURN_AMOUNTS|HALF_TURN|DR_EO_MOVE|slice_outer_pair|is_half_turn|%\s*3|vec!\[\s*\d|\[\s*\d+(?:\s*,\s*\d+){2,}/.test(line)
    ) {
      console.log(`${index + 1}:${line}`);
    }
  }
  console.log(`FMC_MOVE_ORDER_AUDIT_END:${path}`);
}
