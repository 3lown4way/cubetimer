import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function update(path, transform) {
  const before = fs.readFileSync(path, "utf8");
  const after = transform(before);
  if (after !== before) fs.writeFileSync(path, after);
}

update("solver-wasm/src/twophase_builder.rs", (source) => {
  if (source.includes("pub co_eo_joint: Vec<u8>")) return source;
  source = replaceOnce(
    source,
    "    pub slice: Vec<u8>,\n    pub co_slice_joint: Vec<u8>,",
    "    pub slice: Vec<u8>,\n    pub co_eo_joint: Vec<u8>,\n    pub co_slice_joint: Vec<u8>,",
    "generated COxEO field",
  );
  source = replaceOnce(
    source,
    "    let co_slice_joint =\n        build_joint_dist(&co_move, CO_SIZE, &slice_move, SLICE_SIZE, 0, solved_slice);",
    "    let co_eo_joint = build_joint_dist(&co_move, CO_SIZE, &eo_move, EO_SIZE, 0, 0);\n    let co_slice_joint =\n        build_joint_dist(&co_move, CO_SIZE, &slice_move, SLICE_SIZE, 0, solved_slice);",
    "COxEO generation",
  );
  source = replaceOnce(
    source,
    "        slice: bfs_from_move_table_u16(&slice_move, SLICE_SIZE, solved_slice, MOVE_COUNT),\n        co_slice_joint,",
    "        slice: bfs_from_move_table_u16(&slice_move, SLICE_SIZE, solved_slice, MOVE_COUNT),\n        co_eo_joint,\n        co_slice_joint,",
    "COxEO generated output",
  );
  return source;
});

update("solver-wasm/src/twophase_bundle.rs", (source) => {
  if (source.includes("CoEoJoint = 14")) return source;
  source = replaceOnce(source, "const BUNDLE_VERSION: u32 = 2;", "const BUNDLE_VERSION: u32 = 3;", "bundle version");
  source = replaceOnce(
    source,
    "    EoSliceJoint = 13,\n}",
    "    EoSliceJoint = 13,\n    CoEoJoint = 14,\n}",
    "COxEO table kind",
  );
  source = replaceOnce(
    source,
    "            13 => Some(Self::EoSliceJoint),\n            _ => None,",
    "            13 => Some(Self::EoSliceJoint),\n            14 => Some(Self::CoEoJoint),\n            _ => None,",
    "COxEO table kind parser",
  );
  source = replaceOnce(
    source,
    "    pub slice: PackedTable,\n    pub co_slice_joint: PackedTable,",
    "    pub slice: PackedTable,\n    pub co_eo_joint: PackedTable,\n    pub co_slice_joint: PackedTable,",
    "loaded COxEO field",
  );
  source = replaceOnce(
    source,
    "    let mut slice: Option<PackedTable> = None;\n    let mut co_slice_joint: Option<PackedTable> = None;",
    "    let mut slice: Option<PackedTable> = None;\n    let mut co_eo_joint: Option<PackedTable> = None;\n    let mut co_slice_joint: Option<PackedTable> = None;",
    "COxEO loader slot",
  );
  source = replaceOnce(
    source,
    "                Some(TableKind::EoSliceJoint) => eo_slice_joint = Some(table),\n                _ => {}",
    "                Some(TableKind::EoSliceJoint) => eo_slice_joint = Some(table),\n                Some(TableKind::CoEoJoint) => co_eo_joint = Some(table),\n                _ => {}",
    "COxEO loader match",
  );
  source = replaceOnce(
    source,
    "        slice: slice.ok_or_else(|| \"twophase bundle missing Slice table\".to_string())?,\n        co_slice_joint:",
    "        slice: slice.ok_or_else(|| \"twophase bundle missing Slice table\".to_string())?,\n        co_eo_joint: co_eo_joint\n            .ok_or_else(|| \"twophase bundle missing COxEO table\".to_string())?,\n        co_slice_joint:",
    "COxEO required loader field",
  );
  return source;
});

update("solver-wasm/src/build_twophase_tables_main.rs", (source) => {
  if (source.includes("TableKind::CoEoJoint")) return source;
  source = source.replace("generating v2 joint pruning tables", "generating v3 joint pruning tables");
  source = replaceOnce(
    source,
    "        BundleInput::Dist {\n            kind: TableKind::CoSliceJoint,",
    "        BundleInput::Dist {\n            kind: TableKind::CoEoJoint,\n            values: &tables.co_eo_joint,\n        },\n        BundleInput::Dist {\n            kind: TableKind::CoSliceJoint,",
    "COxEO bundle input",
  );
  source = source.replace("twophase-333-v2.bin", "twophase-333-v3.bin");
  return source;
});

update("solver-wasm/src/twophase_search.rs", (source) => {
  if (source.includes("co_eo_joint")) return source;
  return replaceOnce(
    source,
    "    tables\n        .co_slice_joint\n        .get(co * crate::minmove_core::SLICE_SIZE + slice)\n        .max(\n            tables\n                .eo_slice_joint\n                .get(eo * crate::minmove_core::SLICE_SIZE + slice),\n        )",
    "    tables\n        .co_eo_joint\n        .get(co * crate::minmove_core::EO_SIZE + eo)\n        .max(\n            tables\n                .co_slice_joint\n                .get(co * crate::minmove_core::SLICE_SIZE + slice),\n        )\n        .max(\n            tables\n                .eo_slice_joint\n                .get(eo * crate::minmove_core::SLICE_SIZE + slice),\n        )",
    "three-way phase-one lower bound",
  );
});

update("solver/wasmSolver.js", (source) => {
  if (source.includes("twophase-333-v3.bin")) return source;
  return replaceOnce(
    source,
    "const TWOPHASE_333_BUNDLE_CANDIDATES = [\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v2.bin\", import.meta.url).href,",
    "const TWOPHASE_333_BUNDLE_CANDIDATES = [\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v3.bin\", import.meta.url).href,\n  new URL(\"../solver-wasm/twophase/twophase-333-v3.bin\", import.meta.url).href,\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v2.bin\", import.meta.url).href,",
    "v3 bundle candidates",
  );
});

console.log("Applied COxEO phase-one pruning and twophase bundle v3");
