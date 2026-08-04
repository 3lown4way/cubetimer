import fs from "node:fs";

const rustPath = "solver-wasm/src/fmc_search.rs";
const before = fs.readFileSync(rustPath, "utf8");
let source = before;

const indexMarker = "let premove_index = if candidate.premove_moves.is_empty()";
if (!source.includes(indexMarker)) {
  const anchor = `    let base_source = match candidate.source_tag {`;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error("Missing FMC candidate source anchor");
  const insertion = `    let premove_index = if candidate.premove_moves.is_empty() {
        None
    } else {
        FMC_PREMOVE_SETS
            .iter()
            .position(|premove| premove.moves == candidate.premove_moves)
    };
`;
  source = source.slice(0, index) + insertion + source.slice(index);
}

const jsonMarker = `        "premoveIndex": premove_index,`;
if (!source.includes(jsonMarker)) {
  const anchor = `        "premoves": premove_str,`;
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error("Missing FMC premove JSON anchor");
  source = source.slice(0, index + anchor.length) + `\n${jsonMarker}` + source.slice(index + anchor.length);
}

if (source !== before) fs.writeFileSync(rustPath, source);
console.log(source === before ? "FMC premove index diagnostic already applied" : "Applied FMC premove index diagnostic");
