import fs from "node:fs";

function replaceOnce(source, oldText, newText, label) {
  const index = source.indexOf(oldText);
  if (index < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(oldText, index + oldText.length) >= 0) {
    throw new Error(`Ambiguous ${label}`);
  }
  return source.slice(0, index) + newText + source.slice(index + oldText.length);
}

const cargoPath = "solver-wasm/Cargo.toml";
let cargo = fs.readFileSync(cargoPath, "utf8");
if (!cargo.includes('name = "build_twophase_tables"')) {
  cargo = cargo.replace(
    '[[bin]]\nname = "build_minmove_tables"\npath = "src/build_minmove_tables_main.rs"\n',
    '[[bin]]\nname = "build_minmove_tables"\npath = "src/build_minmove_tables_main.rs"\n\n[[bin]]\nname = "build_twophase_tables"\npath = "src/build_twophase_tables_main.rs"\n',
  );
  fs.writeFileSync(cargoPath, cargo);
}

fs.writeFileSync(
  "solver-wasm/src/build_twophase_tables_main.rs",
  `use std::fs;
use std::path::PathBuf;

use solver_wasm::minmove_core::{MoveData, MoveDataFile};
use solver_wasm::twophase_builder::build_all_tables;
use solver_wasm::twophase_bundle::{build_bundle_bytes, BundleInput, TableKind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let move_data_path = manifest_dir.join("assets/minmove_move_data.json");
    let move_data_file: MoveDataFile = serde_json::from_slice(&fs::read(&move_data_path)?)?;
    let move_data = MoveData::try_from(move_data_file.clone())?;

    eprintln!("[twophase] generating v2 joint pruning tables...");
    let tables = build_all_tables(&move_data)?;
    let inputs = vec![
        BundleInput::Dist { kind: TableKind::Co, values: &tables.co },
        BundleInput::Dist { kind: TableKind::Eo, values: &tables.eo },
        BundleInput::Dist { kind: TableKind::Slice, values: &tables.slice },
        BundleInput::Dist { kind: TableKind::Phase2Ep, values: &tables.phase2_ep },
        BundleInput::Move { kind: TableKind::CoMove, values: &tables.co_move },
        BundleInput::Move { kind: TableKind::EoMove, values: &tables.eo_move },
        BundleInput::Move { kind: TableKind::SliceMove, values: &tables.slice_move },
        BundleInput::Dist { kind: TableKind::Phase2CpSepJoint, values: &tables.phase2_cp_sep_joint },
        BundleInput::Move { kind: TableKind::Phase2CpMove, values: &tables.phase2_cp_move },
        BundleInput::Move { kind: TableKind::Phase2EpMove, values: &tables.phase2_ep_move },
        BundleInput::Move { kind: TableKind::Phase2SepMove, values: &tables.phase2_sep_move },
        BundleInput::Dist { kind: TableKind::CoSliceJoint, values: &tables.co_slice_joint },
        BundleInput::Dist { kind: TableKind::EoSliceJoint, values: &tables.eo_slice_joint },
    ];
    let bundle = build_bundle_bytes(&move_data_file, &inputs)?;
    let output_dir = manifest_dir.join("../public/solver-wasm/twophase");
    fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("twophase-333-v2.bin");
    fs::write(&output_path, &bundle)?;
    eprintln!("[twophase] wrote {} bytes to {}", bundle.len(), output_path.display());
    Ok(())
}
`,
);

const builderPath = "solver-wasm/src/twophase_builder.rs";
let builder = fs.readFileSync(builderPath, "utf8");
if (!builder.includes("co_slice_joint: Vec<u8>")) {
  builder = replaceOnce(
    builder,
    "    pub slice: Vec<u8>,\n    pub phase2_ep: Vec<u8>,",
    "    pub slice: Vec<u8>,\n    pub co_slice_joint: Vec<u8>,\n    pub eo_slice_joint: Vec<u8>,\n    pub phase2_ep: Vec<u8>,",
    "generated joint fields",
  );

  const marker = "fn resolve_phase2_move_indices";
  const jointFn = `fn build_joint_dist(
    first_move: &[u16],
    first_size: usize,
    second_move: &[u16],
    second_size: usize,
    first_start: usize,
    second_start: usize,
) -> Vec<u8> {
    let size = first_size * second_size;
    let mut dist = vec![NOT_SET; size];
    let mut queue = vec![0u32; size];
    let start = first_start * second_size + second_start;
    let mut head = 0usize;
    let mut tail = 0usize;
    dist[start] = 0;
    queue[tail] = start as u32;
    tail += 1;
    while head < tail {
        let index = queue[head] as usize;
        head += 1;
        let first = index / second_size;
        let second = index % second_size;
        let next_depth = dist[index] + 1;
        let first_base = first * MOVE_COUNT;
        let second_base = second * MOVE_COUNT;
        for move_index in 0..MOVE_COUNT {
            let next_first = first_move[first_base + move_index] as usize;
            let next_second = second_move[second_base + move_index] as usize;
            let next_index = next_first * second_size + next_second;
            if dist[next_index] != NOT_SET {
                continue;
            }
            dist[next_index] = next_depth;
            queue[tail] = next_index as u32;
            tail += 1;
        }
    }
    dist
}

`;
  builder = builder.replace(marker, jointFn + marker);

  builder = replaceOnce(
    builder,
    "    let phase2_move_indices = resolve_phase2_move_indices(move_data)?;",
    "    let co_slice_joint = build_joint_dist(\n        &co_move, CO_SIZE, &slice_move, SLICE_SIZE, 0, solved_slice,\n    );\n    let eo_slice_joint = build_joint_dist(\n        &eo_move, EO_SIZE, &slice_move, SLICE_SIZE, 0, solved_slice,\n    );\n\n    let phase2_move_indices = resolve_phase2_move_indices(move_data)?;",
    "joint table build",
  );
  builder = replaceOnce(
    builder,
    "        slice: bfs_from_move_table_u16(&slice_move, SLICE_SIZE, solved_slice, MOVE_COUNT),\n        phase2_ep:",
    "        slice: bfs_from_move_table_u16(&slice_move, SLICE_SIZE, solved_slice, MOVE_COUNT),\n        co_slice_joint,\n        eo_slice_joint,\n        phase2_ep:",
    "joint table return",
  );
  fs.writeFileSync(builderPath, builder);
}

const bundlePath = "solver-wasm/src/twophase_bundle.rs";
let bundle = fs.readFileSync(bundlePath, "utf8");
if (!bundle.includes("CoSliceJoint = 12")) {
  bundle = bundle.replace("const BUNDLE_VERSION: u32 = 1;", "const BUNDLE_VERSION: u32 = 2;");
  bundle = replaceOnce(
    bundle,
    "    Phase2SepMove = 11,\n}",
    "    Phase2SepMove = 11,\n    CoSliceJoint = 12,\n    EoSliceJoint = 13,\n}",
    "table kind variants",
  );
  bundle = replaceOnce(
    bundle,
    "            11 => Some(Self::Phase2SepMove),\n            _ => None,",
    "            11 => Some(Self::Phase2SepMove),\n            12 => Some(Self::CoSliceJoint),\n            13 => Some(Self::EoSliceJoint),\n            _ => None,",
    "table kind parsing",
  );
  bundle = replaceOnce(
    bundle,
    "    pub slice: PackedTable,\n    pub phase2_ep: PackedTable,",
    "    pub slice: PackedTable,\n    pub co_slice_joint: PackedTable,\n    pub eo_slice_joint: PackedTable,\n    pub phase2_ep: PackedTable,",
    "table struct fields",
  );
  bundle = replaceOnce(
    bundle,
    "    let mut slice: Option<PackedTable> = None;\n    let mut phase2_ep:",
    "    let mut slice: Option<PackedTable> = None;\n    let mut co_slice_joint: Option<PackedTable> = None;\n    let mut eo_slice_joint: Option<PackedTable> = None;\n    let mut phase2_ep:",
    "loader option fields",
  );
  bundle = replaceOnce(
    bundle,
    "                Some(TableKind::Phase2CpSepJoint) => phase2_cp_sep_joint = Some(table),\n                _ => {}",
    "                Some(TableKind::Phase2CpSepJoint) => phase2_cp_sep_joint = Some(table),\n                Some(TableKind::CoSliceJoint) => co_slice_joint = Some(table),\n                Some(TableKind::EoSliceJoint) => eo_slice_joint = Some(table),\n                _ => {}",
    "loader dist match",
  );
  bundle = replaceOnce(
    bundle,
    "        slice: slice\n            .ok_or_else(|| \"twophase bundle missing Slice table\".to_string())?,\n        phase2_ep:",
    "        slice: slice\n            .ok_or_else(|| \"twophase bundle missing Slice table\".to_string())?,\n        co_slice_joint: co_slice_joint\n            .ok_or_else(|| \"twophase bundle missing COxSlice table\".to_string())?,\n        eo_slice_joint: eo_slice_joint\n            .ok_or_else(|| \"twophase bundle missing EOxSlice table\".to_string())?,\n        phase2_ep:",
    "loader constructor fields",
  );
  fs.writeFileSync(bundlePath, bundle);
}

const searchPath = "solver-wasm/src/twophase_search.rs";
let search = fs.readFileSync(searchPath, "utf8");
if (!search.includes("fn phase1_joint_lower_bound")) {
  const marker = "fn build_phase1_input";
  const helper = `#[inline(always)]
fn phase1_joint_lower_bound(
    tables: &TwophaseTables,
    co: usize,
    eo: usize,
    slice: usize,
) -> u8 {
    tables
        .co_slice_joint
        .get(co * crate::minmove_core::SLICE_SIZE + slice)
        .max(
            tables
                .eo_slice_joint
                .get(eo * crate::minmove_core::SLICE_SIZE + slice),
        )
}

`;
  search = search.replace(marker, helper + marker);

  const heuristicRegex = /(?:self\.)?tables\n\s*\.co\n\s*\.get\(([^)]+)\)\n\s*\.max\((?:self\.)?tables\.eo\.get\(([^)]+)\)\)\n\s*\.max\((?:self\.)?tables\.slice\.get\(([^)]+)\)\)/g;
  let count = 0;
  search = search.replace(heuristicRegex, (_match, co, eo, slice) => {
    count += 1;
    const receiver = _match.trimStart().startsWith("self.") ? "self.tables" : "tables";
    return `phase1_joint_lower_bound(${receiver}, ${co}, ${eo}, ${slice})`;
  });
  if (count !== 3) throw new Error(`Expected 3 phase1 heuristic replacements, got ${count}`);
  fs.writeFileSync(searchPath, search);
}

const wasmPath = "solver/wasmSolver.js";
let wasm = fs.readFileSync(wasmPath, "utf8");
if (!wasm.includes("twophase-333-v2.bin")) {
  wasm = replaceOnce(
    wasm,
    "const TWOPHASE_333_BUNDLE_CANDIDATES = [\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v1.bin\", import.meta.url).href,",
    "const TWOPHASE_333_BUNDLE_CANDIDATES = [\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v2.bin\", import.meta.url).href,\n  new URL(\"../public/solver-wasm/twophase/twophase-333-v1.bin\", import.meta.url).href,",
    "twophase v2 loader candidate",
  );
  fs.writeFileSync(wasmPath, wasm);
}

console.log("applied twophase v2 joint phase-one pruning");
