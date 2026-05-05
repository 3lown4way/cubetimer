use crate::htr_classifier::classify_htr_subset;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn create_htr_subset_json(cp_idx: u32, ep_idx: u32, sep_idx: u32) -> String {
    let subset = classify_htr_subset(cp_idx, ep_idx, sep_idx);
    let quality_name = match subset.quality {
        2 => "good",
        1 => "medium",
        _ => "bad",
    };

    serde_json::json!({
        "cxe_type": subset.cxe_type,
        "qt_estimate": subset.qt_estimate,
        "quality": quality_name,
    })
    .to_string()
}