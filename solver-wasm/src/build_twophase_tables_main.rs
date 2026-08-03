use std::fs;
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
        BundleInput::Dist {
            kind: TableKind::Co,
            values: &tables.co,
        },
        BundleInput::Dist {
            kind: TableKind::Eo,
            values: &tables.eo,
        },
        BundleInput::Dist {
            kind: TableKind::Slice,
            values: &tables.slice,
        },
        BundleInput::Dist {
            kind: TableKind::Phase2Ep,
            values: &tables.phase2_ep,
        },
        BundleInput::Move {
            kind: TableKind::CoMove,
            values: &tables.co_move,
        },
        BundleInput::Move {
            kind: TableKind::EoMove,
            values: &tables.eo_move,
        },
        BundleInput::Move {
            kind: TableKind::SliceMove,
            values: &tables.slice_move,
        },
        BundleInput::Dist {
            kind: TableKind::Phase2CpSepJoint,
            values: &tables.phase2_cp_sep_joint,
        },
        BundleInput::Move {
            kind: TableKind::Phase2CpMove,
            values: &tables.phase2_cp_move,
        },
        BundleInput::Move {
            kind: TableKind::Phase2EpMove,
            values: &tables.phase2_ep_move,
        },
        BundleInput::Move {
            kind: TableKind::Phase2SepMove,
            values: &tables.phase2_sep_move,
        },
        BundleInput::Dist {
            kind: TableKind::CoSliceJoint,
            values: &tables.co_slice_joint,
        },
        BundleInput::Dist {
            kind: TableKind::EoSliceJoint,
            values: &tables.eo_slice_joint,
        },
    ];
    let bundle = build_bundle_bytes(&move_data_file, &inputs)?;
    let output_dir = manifest_dir.join("../public/solver-wasm/twophase");
    fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("twophase-333-v2.bin");
    fs::write(&output_path, &bundle)?;
    eprintln!(
        "[twophase] wrote {} bytes to {}",
        bundle.len(),
        output_path.display()
    );
    Ok(())
}
