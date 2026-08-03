use std::fs;
use std::path::PathBuf;

use solver_wasm::minmove_builder::build_all_tables;
use solver_wasm::minmove_bundle::{build_bundle_bytes, BundleInput, TableKind};
use solver_wasm::minmove_core::{MoveData, MoveDataFile};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let move_data_path = manifest_dir.join("assets/minmove_move_data.json");
    let move_data_file: MoveDataFile = serde_json::from_slice(&fs::read(&move_data_path)?)?;
    let move_data = MoveData::try_from(move_data_file.clone())?;

    eprintln!("[minmove] generating HTM pruning and move tables...");
    let tables = build_all_tables(&move_data);
    let inputs = vec![
        BundleInput::Dist { kind: TableKind::Co, values: &tables.co },
        BundleInput::Dist { kind: TableKind::Eo, values: &tables.eo },
        BundleInput::Dist { kind: TableKind::Slice, values: &tables.slice },
        BundleInput::Dist { kind: TableKind::Cp, values: &tables.cp },
        BundleInput::Dist { kind: TableKind::EdgeSubsetA, values: &tables.edge_subset_a },
        BundleInput::Dist { kind: TableKind::EdgeSubsetB, values: &tables.edge_subset_b },
        BundleInput::Move { kind: TableKind::CoMove, values: &tables.co_move },
        BundleInput::Move { kind: TableKind::EoMove, values: &tables.eo_move },
        BundleInput::Move { kind: TableKind::CpMove, values: &tables.cp_move },
        BundleInput::Move { kind: TableKind::SliceMove, values: &tables.slice_move },
        BundleInput::Dist { kind: TableKind::CoEoJoint, values: &tables.co_eo_joint },
        BundleInput::Dist { kind: TableKind::CpSliceJoint, values: &tables.cp_slice_joint },
        BundleInput::Dist { kind: TableKind::CoSliceJoint, values: &tables.co_slice_joint },
        BundleInput::Dist { kind: TableKind::CpEoJoint, values: &tables.cp_eo_joint },
        BundleInput::Dist { kind: TableKind::EdgePermSubsetA, values: &tables.edge_perm_subset_a },
        BundleInput::Dist { kind: TableKind::EdgePermSubsetB, values: &tables.edge_perm_subset_b },
        BundleInput::Dist { kind: TableKind::CornerFullJoint, values: &tables.corner_full },
        BundleInput::Dist { kind: TableKind::EdgeSubsetC, values: &tables.edge_subset_c },
        BundleInput::Dist { kind: TableKind::EdgeSubsetD, values: &tables.edge_subset_d },
    ];
    let bundle = build_bundle_bytes(&move_data_file, &inputs)?;

    let output_dir = manifest_dir.join("../public/solver-wasm/minmove");
    fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join("minmove-333-v8.bin");
    fs::write(&output_path, &bundle)?;
    eprintln!(
        "[minmove] wrote {} bytes to {}",
        bundle.len(),
        output_path.display()
    );
    Ok(())
}
